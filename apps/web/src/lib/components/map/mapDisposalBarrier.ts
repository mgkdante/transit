import type { Map as MapLibreMap } from 'maplibre-gl';

export interface MapDisposalBarrier {
	readonly map: MapLibreMap;
	readonly disposed: boolean;
	dispose(): void;
}

const UNDEFINED_FALLBACKS = new Set(['getSource', 'getLayer', 'getStyle']);
const EMPTY_ARRAY_FALLBACKS = new Set([
	'queryRenderedFeatures',
	'querySourceFeatures',
	'listImages',
]);
const FALSE_FALLBACKS = new Set([
	'hasImage',
	'loaded',
	'isStyleLoaded',
	'areTilesLoaded',
	'isMoving',
	'isZooming',
	'isRotating',
]);
const NUMERIC_FALLBACKS = new Set([
	'getZoom',
	'getBearing',
	'getPitch',
	'getMinZoom',
	'getMaxZoom',
]);
const ELEMENT_FALLBACKS = new Set(['getCanvas', 'getCanvasContainer', 'getContainer']);
const OWNED_OBJECT_PROPERTIES = new Set([
	'dragPan',
	'scrollZoom',
	'boxZoom',
	'dragRotate',
	'keyboard',
	'doubleClickZoom',
	'touchZoomRotate',
	'touchPitch',
	'cooperativeGestures',
]);

type AnyFunction = (...args: unknown[]) => unknown;

function methodPropertiesOf(value: object): Set<PropertyKey> {
	const properties = new Set<PropertyKey>();
	let cursor: object | null = value;
	while (cursor && cursor !== Object.prototype) {
		for (const property of Reflect.ownKeys(cursor)) {
			const descriptor = Reflect.getOwnPropertyDescriptor(cursor, property);
			if (typeof descriptor?.value === 'function') properties.add(property);
		}
		cursor = Reflect.getPrototypeOf(cursor);
	}
	return properties;
}

export function createMapDisposalBarrier(rawMap: MapLibreMap): MapDisposalBarrier {
	let disposed = false;
	const methodWrappers = new Map<PropertyKey, AnyFunction>();
	const methodProperties = methodPropertiesOf(rawMap);
	const numericResults = new Map<PropertyKey, number>();
	const elementResults = new Map<PropertyKey, unknown>();
	const handlerWrappers = new WeakMap<AnyFunction, AnyFunction>();
	const eventProxies = new WeakMap<object, object>();
	const ownedObjectProxies = new WeakMap<object, object>();
	const ownedPropertyProxies = new Map<PropertyKey, object>();
	const inertSubscription = Object.freeze({ unsubscribe() {} });
	let proxy: MapLibreMap;

	const disposedFallback = (property: PropertyKey, args: unknown[]): unknown => {
		if (property === 'on') return inertSubscription;
		if (property === 'once') {
			return args.some((argument) => typeof argument === 'function')
				? proxy
				: Promise.resolve(undefined);
		}
		if (typeof property !== 'string') return undefined;
		if (UNDEFINED_FALLBACKS.has(property)) return undefined;
		if (EMPTY_ARRAY_FALLBACKS.has(property)) return [];
		if (FALSE_FALLBACKS.has(property)) return false;
		if (NUMERIC_FALLBACKS.has(property)) return numericResults.get(property) ?? 0;
		if (ELEMENT_FALLBACKS.has(property)) return elementResults.get(property);
		return undefined;
	};

	const guardEvent = (event: object): object => {
		const existing = eventProxies.get(event);
		if (existing) return existing;
		const guarded = new Proxy(Object.create(null) as object, {
			get(_target, property) {
				const value = Reflect.get(event, property, event);
				if (value === rawMap) return proxy;
				if (typeof value === 'function') return value.bind(event);
				return value;
			},
			set(_target, property, value) {
				return Reflect.set(event, property, value, event);
			},
		});
		eventProxies.set(event, guarded);
		return guarded;
	};

	const guardHandler = (handler: AnyFunction): AnyFunction => {
		const existing = handlerWrappers.get(handler);
		if (existing) return existing;
		const guarded = function (this: unknown, ...args: unknown[]): unknown {
			if (disposed) return undefined;
			const guardedArgs = args.map((argument) =>
				argument !== null && typeof argument === 'object' ? guardEvent(argument) : argument,
			);
			return Reflect.apply(handler, this === rawMap ? proxy : this, guardedArgs);
		};
		handlerWrappers.set(handler, guarded);
		return guarded;
	};

	const guardOwnedObject = (owned: object): object => {
		const existing = ownedObjectProxies.get(owned);
		if (existing) return existing;
		const wrappers = new Map<PropertyKey, AnyFunction>();
		const properties = methodPropertiesOf(owned);
		let guarded: object;
		const wrapperFor = (property: PropertyKey): AnyFunction => {
			const existingWrapper = wrappers.get(property);
			if (existingWrapper) return existingWrapper;
			const wrapper = (...args: unknown[]): unknown => {
				if (disposed) return undefined;
				const method = Reflect.get(owned, property, owned);
				if (typeof method !== 'function') return undefined;
				const result = Reflect.apply(method, owned, args);
				if (result === owned) return guarded;
				if (result === rawMap) return proxy;
				return result;
			};
			wrappers.set(property, wrapper);
			return wrapper;
		};
		guarded = new Proxy(Object.create(null) as object, {
			get(_target, property) {
				if (wrappers.has(property) || properties.has(property)) return wrapperFor(property);
				if (disposed) return undefined;
				const value = Reflect.get(owned, property, owned);
				if (value === owned) return guarded;
				if (value === rawMap) return proxy;
				if (typeof value === 'function') {
					properties.add(property);
					return wrapperFor(property);
				}
				return value;
			},
			set(_target, property, value) {
				if (disposed) return true;
				return Reflect.set(owned, property, value, owned);
			},
		});
		ownedObjectProxies.set(owned, guarded);
		return guarded;
	};

	const wrapperFor = (property: PropertyKey): AnyFunction => {
		const existing = methodWrappers.get(property);
		if (existing) return existing;
		const wrapper = (...args: unknown[]): unknown => {
			if (disposed) return disposedFallback(property, args);
			const method = Reflect.get(rawMap, property, rawMap);
			if (typeof method !== 'function') return undefined;
			let forwardedArgs = args;
			if (property === 'on' || property === 'once') {
				forwardedArgs = args.map((argument) =>
					typeof argument === 'function' ? guardHandler(argument as AnyFunction) : argument,
				);
			} else if (property === 'off') {
				forwardedArgs = args.map((argument) =>
					typeof argument === 'function'
						? (handlerWrappers.get(argument as AnyFunction) ?? argument)
						: argument,
				);
			}
			const result = Reflect.apply(method, rawMap, forwardedArgs);
			if (
				typeof property === 'string' &&
				NUMERIC_FALLBACKS.has(property) &&
				typeof result === 'number'
			) {
				numericResults.set(property, result);
			}
			if (typeof property === 'string' && ELEMENT_FALLBACKS.has(property)) {
				elementResults.set(property, result);
			}
			if (result === rawMap) return proxy;
			if (
				property === 'once' &&
				!args.some((argument) => typeof argument === 'function') &&
				result !== null &&
				typeof result === 'object' &&
				typeof Reflect.get(result, 'then', result) === 'function'
			) {
				return Promise.resolve(result).then((event) => {
					if (event === rawMap) return proxy;
					return event !== null && typeof event === 'object' ? guardEvent(event) : event;
				});
			}
			if (property === 'getSource' && result !== null && typeof result === 'object') {
				return guardOwnedObject(result);
			}
			if (
				(property === 'on' || property === 'once') &&
				result !== null &&
				typeof result === 'object' &&
				typeof Reflect.get(result, 'unsubscribe', result) === 'function'
			) {
				return guardOwnedObject(result);
			}
			return result;
		};
		methodWrappers.set(property, wrapper);
		return wrapper;
	};

	proxy = new Proxy(Object.create(null) as object, {
		get(_target, property) {
			if (methodWrappers.has(property) || methodProperties.has(property))
				return wrapperFor(property);
			const ownedProperty = ownedPropertyProxies.get(property);
			if (ownedProperty) return ownedProperty;
			if (disposed) return undefined;
			const value = Reflect.get(rawMap, property, rawMap);
			if (value === rawMap) return proxy;
			if (
				typeof property === 'string' &&
				OWNED_OBJECT_PROPERTIES.has(property) &&
				value !== null &&
				typeof value === 'object'
			) {
				const guarded = guardOwnedObject(value);
				ownedPropertyProxies.set(property, guarded);
				return guarded;
			}
			if (typeof value === 'function') {
				methodProperties.add(property);
				return wrapperFor(property);
			}
			return value;
		},
		set(_target, property, value) {
			if (disposed) return true;
			return Reflect.set(rawMap, property, value, rawMap);
		},
	}) as MapLibreMap;
	for (const property of OWNED_OBJECT_PROPERTIES) {
		const value = Reflect.get(rawMap, property, rawMap);
		if (value !== null && typeof value === 'object') {
			ownedPropertyProxies.set(property, guardOwnedObject(value));
		}
	}

	return {
		map: proxy,
		get disposed() {
			return disposed;
		},
		dispose() {
			disposed = true;
		},
	};
}

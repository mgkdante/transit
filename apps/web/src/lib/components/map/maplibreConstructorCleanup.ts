import type { Map as MapLibreMap } from 'maplibre-gl';
import { createMapDisposalRegistry, type MapDisposalRegistry } from './mapOwnerBoundary';

type MapConstructor = typeof import('maplibre-gl').Map;
type MapOptions = ConstructorParameters<MapConstructor>[0];
type GlCleanup = Pick<WebGLRenderingContext, 'getExtension'>;

const appDisposals = new WeakMap<MapLibreMap, MapDisposalRegistry>();

function captureFlag(options?: boolean | AddEventListenerOptions | EventListenerOptions): boolean {
	return typeof options === 'boolean' ? options : (options?.capture ?? false);
}

function restoreProperty(
	target: object,
	property: PropertyKey,
	descriptor?: PropertyDescriptor,
): void {
	if (descriptor) Object.defineProperty(target, property, descriptor);
	else Reflect.deleteProperty(target, property);
}

function captureGlobalListeners(target: EventTarget, registry: MapDisposalRegistry): () => void {
	type CapturedListener = {
		active: boolean;
		readonly type: string;
		readonly listener: EventListenerOrEventListenerObject;
		readonly options?: boolean | AddEventListenerOptions;
		releaseOwned: () => void;
	};
	const addDescriptor = Object.getOwnPropertyDescriptor(target, 'addEventListener');
	const removeDescriptor = Object.getOwnPropertyDescriptor(target, 'removeEventListener');
	const originalAdd = target.addEventListener;
	const originalRemove = target.removeEventListener;
	const captured: CapturedListener[] = [];

	Object.defineProperties(target, {
		addEventListener: {
			configurable: true,
			writable: true,
			value: function (
				this: EventTarget,
				type: string,
				listener: EventListenerOrEventListenerObject | null,
				options?: boolean | AddEventListenerOptions,
			): void {
				if (!listener) {
					originalAdd.call(this, type, listener, options);
					return;
				}
				const receipt: CapturedListener = {
					active: true,
					type,
					listener,
					options,
					releaseOwned: () => {},
				};
				receipt.releaseOwned = registry.own(() => {
					if (!receipt.active) return;
					originalRemove.call(target, receipt.type, receipt.listener, receipt.options);
					receipt.active = false;
				});
				captured.push(receipt);
				originalAdd.call(this, type, listener, options);
			},
		},
		removeEventListener: {
			configurable: true,
			writable: true,
			value: function (
				this: EventTarget,
				type: string,
				listener: EventListenerOrEventListenerObject | null,
				options?: boolean | EventListenerOptions,
			): void {
				const receipt = [...captured]
					.reverse()
					.find(
						(candidate) =>
							candidate.active &&
							candidate.type === type &&
							candidate.listener === listener &&
							captureFlag(candidate.options) === captureFlag(options),
					);
				originalRemove.call(this, type, listener, options);
				if (!receipt) return;
				receipt.active = false;
				receipt.releaseOwned();
			},
		},
	});

	return () => {
		restoreProperty(target, 'addEventListener', addDescriptor);
		restoreProperty(target, 'removeEventListener', removeDescriptor);
	};
}

function resolveContainer(options: MapOptions): HTMLElement | null {
	const candidate = options.container;
	if (typeof candidate !== 'string') return candidate;
	return globalThis.document?.getElementById(candidate) ?? null;
}

function createAppDisposals(
	options: MapOptions,
	reportCleanupFailure: (error: unknown) => void,
): { readonly registry: MapDisposalRegistry; restoreCapture(): void } {
	const registry = createMapDisposalRegistry('MapLibre app resources', reportCleanupFailure);
	const container = resolveContainer(options);
	if (!container) return { registry, restoreCapture: () => {} };

	const originalChildren = new Set(container.childNodes);
	const originallyMapContainer = container.classList.contains('maplibregl-map');
	registry.own(() => {
		for (const child of [...container.childNodes]) {
			if (!originalChildren.has(child)) child.remove();
		}
		if (!originallyMapContainer) container.classList.remove('maplibregl-map');
	});

	const ownerDocument = container.ownerDocument;
	const ownerWindow = ownerDocument.defaultView;
	const restores = [captureGlobalListeners(ownerDocument, registry)];
	if (ownerWindow) restores.push(captureGlobalListeners(ownerWindow, registry));
	return {
		registry,
		restoreCapture() {
			for (const restore of restores.reverse()) restore();
		},
	};
}

export function disposeMapAppResources(map: MapLibreMap): void {
	appDisposals.get(map)?.dispose();
}

export function mapAppDisposalSize(map: MapLibreMap): number {
	return appDisposals.get(map)?.size ?? 0;
}

export function constructRecoverableMap(
	MapConstructor: MapConstructor,
	options: MapOptions,
	reportCleanupFailure: (error: unknown) => void,
): MapLibreMap {
	let constructing = true;
	const appOwner = createAppDisposals(options, reportCleanupFailure);
	class RecoverableMap extends MapConstructor {
		override remove(): void {
			disposeMapAppResources(this);
			const painter = this.painter;
			const destroyPainter = painter.destroy;
			const destroyDescriptor = Object.getOwnPropertyDescriptor(painter, 'destroy');
			let painterFailed = false;
			let painterFailure: unknown;
			let removalFailed = false;
			let removalFailure: unknown;

			painter.destroy = () => {
				try {
					destroyPainter.call(painter);
				} catch (error) {
					painterFailed = true;
					painterFailure = error;
				}
			};
			try {
				super.remove();
			} catch (error) {
				removalFailed = true;
				removalFailure = error;
			} finally {
				if (destroyDescriptor) Object.defineProperty(painter, 'destroy', destroyDescriptor);
				else Reflect.deleteProperty(painter, 'destroy');
			}

			if (painterFailed && removalFailed) {
				throw new AggregateError(
					[painterFailure, removalFailure],
					'MapLibre removal failed after Painter teardown failed',
				);
			}
			if (painterFailed) throw painterFailure;
			if (removalFailed) throw removalFailure;
		}

		override _setupPainter(): void {
			if (!constructing) {
				super._setupPainter();
				return;
			}
			try {
				super._setupPainter();
				return;
			} catch (constructionError) {
				const cleanupErrors: unknown[] = [];
				try {
					// MapLibre's anonymous creation-error listener is once-only but remove()
					// does not unregister it. Consume it while the partial canvas is reachable.
					const EventConstructor = this._canvas.ownerDocument.defaultView?.Event ?? Event;
					this._canvas.dispatchEvent(new EventConstructor('webglcontextcreationerror'));
				} catch (error) {
					cleanupErrors.push(error);
				}
				let gl = { getExtension: () => null } as GlCleanup;
				try {
					const configured = this._canvasContextAttributes.contextType;
					const context = configured
						? this._canvas.getContext(configured)
						: (this._canvas.getContext('webgl2') ?? this._canvas.getContext('webgl'));
					if (context && 'getExtension' in context) gl = context as GlCleanup;
				} catch (error) {
					cleanupErrors.push(error);
				}

				// remove() needs these two fields before the base constructor initializes
				// them. Supplying the recovered GL lets it lose the actual context after it
				// deletes this exact map's private ImageRequest throttle callback.
				this.painter = {
					destroy: () => {},
					context: { gl },
				} as unknown as MapLibreMap['painter'];
				this.handlers = { destroy: () => {} } as unknown as MapLibreMap['handlers'];

				try {
					super.remove();
				} catch (error) {
					cleanupErrors.push(error);
				}
				if (cleanupErrors.length > 0) {
					reportCleanupFailure(
						new AggregateError(
							[constructionError, ...cleanupErrors],
							'MapLibre constructor rollback failed',
						),
					);
				}
				throw constructionError;
			}
		}
	}

	try {
		const map = new RecoverableMap(options);
		const resizeObserver = (map as unknown as { _resizeObserver?: ResizeObserver })._resizeObserver;
		if (resizeObserver) appOwner.registry.own(() => resizeObserver.disconnect());
		appDisposals.set(map, appOwner.registry);
		return map;
	} catch (error) {
		appOwner.registry.dispose();
		throw error;
	} finally {
		constructing = false;
		appOwner.restoreCapture();
	}
}

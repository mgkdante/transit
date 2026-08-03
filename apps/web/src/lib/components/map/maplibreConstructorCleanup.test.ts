// @vitest-environment happy-dom
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import maplibrePackage from 'maplibre-gl/package.json';
import { afterEach, expect, it, vi } from 'vitest';
import { constructRecoverableMap, mapAppDisposalSize } from './maplibreConstructorCleanup';

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

function runThreeFailures(MapConstructor: typeof maplibregl.Map): HTMLElement[] {
	const containers: HTMLElement[] = [];
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const container = document.createElement('div');
		document.body.append(container);
		containers.push(container);
		expect(() =>
			constructRecoverableMap(
				MapConstructor,
				{
					container,
					attributionControl: false,
					interactive: false,
				},
				vi.fn(),
			),
		).toThrow();
	}
	return containers;
}

function flushImageThrottleCallbacks(): void {
	const noop = () => {};
	const map = Object.create(maplibregl.Map.prototype) as InstanceType<typeof maplibregl.Map>;
	Object.assign(map, {
		_controls: [],
		_frameRequest: null,
		_renderTaskQueue: { clear: noop },
		_diffStyleRequest: null,
		painter: { destroy: noop, context: { gl: { getExtension: () => null } } },
		handlers: { destroy: noop },
		setStyle: () => map,
		_imageQueueHandle: Number.MAX_SAFE_INTEGER,
		_resizeObserver: null,
		_canvas: { removeEventListener: noop },
		_canvasContainer: { remove: noop },
		_controlContainer: { remove: noop },
		_container: { removeEventListener: noop, classList: { remove: noop } },
		fire: () => map,
	});
	map.remove();
}

function trackCreationErrorListeners(): () => number {
	const addEventListener = HTMLCanvasElement.prototype.addEventListener;
	let active = 0;
	vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener').mockImplementation(function (
		this: HTMLCanvasElement,
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) {
		if (type !== 'webglcontextcreationerror') {
			return addEventListener.call(this, type, listener, options);
		}
		active += 1;
		let live = true;
		const trackedListener = (event: Event) => {
			if (live) {
				live = false;
				active -= 1;
			}
			if (typeof listener === 'function') listener.call(this, event);
			else listener.handleEvent(event);
		};
		return addEventListener.call(this, type, trackedListener, options);
	});
	return () => active;
}

it('deletes every real MapLibre callback and DOM receipt when WebGL acquisition fails', () => {
	expect(maplibrePackage.version).toBe('5.24.0');
	const activeCreationErrorListeners = trackCreationErrorListeners();
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
	let staleCallbackCalls = 0;
	class ProbeMap extends maplibregl.Map {
		override isMoving(): boolean {
			staleCallbackCalls += 1;
			return false;
		}
	}

	const containers = runThreeFailures(ProbeMap);
	flushImageThrottleCallbacks();

	expect(staleCallbackCalls).toBe(0);
	expect(activeCreationErrorListeners()).toBe(0);
	for (const container of containers) {
		expect(container.childElementCount).toBe(0);
		expect(container.className).toBe('');
	}
});

it('loses every acquired GL context when Painter construction fails', () => {
	let staleCallbackCalls = 0;
	let loseContextCalls = 0;
	const activeCreationErrorListeners = trackCreationErrorListeners();
	const gl = {
		getExtension: (name: string) =>
			name === 'WEBGL_lose_context' ? { loseContext: () => (loseContextCalls += 1) } : null,
	} as unknown as WebGLRenderingContext;
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl);
	class ProbeMap extends maplibregl.Map {
		override isMoving(): boolean {
			staleCallbackCalls += 1;
			return false;
		}
	}

	const containers = runThreeFailures(ProbeMap);
	flushImageThrottleCallbacks();

	expect(staleCallbackCalls).toBe(0);
	expect(loseContextCalls).toBe(3);
	expect(activeCreationErrorListeners()).toBe(0);
	for (const container of containers) {
		expect(container.childElementCount).toBe(0);
		expect(container.className).toBe('');
	}
});

it('keeps real Map removal global receipts flat at zero across repeated painter faults', () => {
	expect(maplibrePackage.version).toBe('5.24.0');
	const painterError = new Error('painter destroy failed before mutation');
	const handlers: Array<{ destroy: () => void }> = [];
	const onlineOwners: Array<{ destroy: () => void }> = [];
	const resizeOwners: Array<{ disconnect: () => void }> = [];
	let activeHandlers = 0;
	let activeOnlineListeners = 0;
	let activeResizeObservers = 0;
	let retainedHandlerDispatches = 0;
	let retainedOnlineDispatches = 0;
	let loseContextCalls = 0;
	let removeEvents = 0;

	class HandlerManagerProbe {
		private active = true;
		private readonly onMouseMove = () => {
			retainedHandlerDispatches += 1;
		};

		constructor() {
			activeHandlers += 1;
			document.addEventListener('mousemove', this.onMouseMove);
		}

		destroy = () => {
			if (!this.active) return;
			this.active = false;
			activeHandlers -= 1;
			document.removeEventListener('mousemove', this.onMouseMove);
		};
	}

	class RemovalProbeMap {
		_controls: unknown[] = [];
		_frameRequest = null;
		_renderTaskQueue = { clear: vi.fn() };
		_diffStyleRequest = null;
		painter = {
			destroy: () => {
				throw painterError;
			},
			context: {
				gl: {
					getExtension: (name: string) =>
						name === 'WEBGL_lose_context' ? { loseContext: () => (loseContextCalls += 1) } : null,
				},
			},
		};
		handlers: HandlerManagerProbe;
		_imageQueueHandle = Number.MAX_SAFE_INTEGER;
		_resizeObserver: { disconnect: () => void };
		_canvas = document.createElement('canvas');
		_canvasContainer = document.createElement('div');
		_controlContainer = document.createElement('div');
		_container: HTMLElement;
		_ownerWindow: { removeEventListener: typeof window.removeEventListener };
		_onWindowOnline: () => void;
		_contextRestored = () => {};
		_contextLost = () => {};
		_onMapScroll = () => {};
		_removed = false;

		constructor(options: { container: HTMLElement }) {
			this._container = options.container;
			this._container.classList.add('maplibregl-map');
			this._canvasContainer.append(this._canvas);
			this._container.append(this._canvasContainer, this._controlContainer);
			this._container.addEventListener('scroll', this._onMapScroll);
			this.handlers = new HandlerManagerProbe();
			handlers.push(this.handlers);

			let online = true;
			this._onWindowOnline = () => {
				retainedOnlineDispatches += 1;
			};
			activeOnlineListeners += 1;
			window.addEventListener('online', this._onWindowOnline);
			const destroyOnline = () => {
				if (!online) return;
				online = false;
				activeOnlineListeners -= 1;
				window.removeEventListener('online', this._onWindowOnline);
			};
			onlineOwners.push({ destroy: destroyOnline });
			this._ownerWindow = {
				removeEventListener: ((_type: string, listener: EventListenerOrEventListenerObject) => {
					if (listener === this._onWindowOnline) destroyOnline();
				}) as typeof window.removeEventListener,
			};

			let observing = true;
			activeResizeObservers += 1;
			this._resizeObserver = {
				disconnect: () => {
					if (!observing) return;
					observing = false;
					activeResizeObservers -= 1;
				},
			};
			resizeOwners.push(this._resizeObserver);
			this._setupPainter();
		}

		_setupPainter(): void {}

		setStyle(_style: null): this {
			return this;
		}

		fire(): this {
			removeEvents += 1;
			return this;
		}
	}

	Object.defineProperty(RemovalProbeMap.prototype, 'remove', {
		configurable: true,
		writable: true,
		value: maplibregl.Map.prototype.remove,
	});

	const activeHandlerSeries: number[] = [];
	const activeOnlineSeries: number[] = [];
	const activeResizeSeries: number[] = [];
	const retainedHandlerDispatchSeries: number[] = [];
	const retainedOnlineDispatchSeries: number[] = [];
	const removedSeries: boolean[] = [];
	const containers: HTMLElement[] = [];

	try {
		for (let round = 0; round < 3; round += 1) {
			const container = document.createElement('div');
			document.body.append(container);
			containers.push(container);
			const map = constructRecoverableMap(
				RemovalProbeMap as unknown as typeof maplibregl.Map,
				{ container },
				vi.fn(),
			) as unknown as RemovalProbeMap & { remove: () => void };

			expect(() => map.remove()).toThrow(painterError);
			document.dispatchEvent(new MouseEvent('mousemove'));
			window.dispatchEvent(new Event('online'));
			activeHandlerSeries.push(activeHandlers);
			activeOnlineSeries.push(activeOnlineListeners);
			activeResizeSeries.push(activeResizeObservers);
			retainedHandlerDispatchSeries.push(retainedHandlerDispatches);
			retainedOnlineDispatchSeries.push(retainedOnlineDispatches);
			removedSeries.push(map._removed);
		}

		expect(activeHandlerSeries).toEqual([0, 0, 0]);
		expect(activeOnlineSeries).toEqual([0, 0, 0]);
		expect(activeResizeSeries).toEqual([0, 0, 0]);
		expect(retainedHandlerDispatchSeries).toEqual([0, 0, 0]);
		expect(retainedOnlineDispatchSeries).toEqual([0, 0, 0]);
		expect(removedSeries).toEqual([true, true, true]);
		expect(loseContextCalls).toBe(3);
		expect(removeEvents).toBe(3);
		for (const container of containers) {
			expect(container.childElementCount).toBe(0);
			expect(container.className).toBe('');
		}
	} finally {
		for (const handler of handlers) handler.destroy();
		for (const owner of onlineOwners) owner.destroy();
		for (const owner of resizeOwners) owner.disconnect();
	}
});

it('keeps app-owned globals and DOM flat at zero across persistent custom-source faults', async () => {
	expect(maplibrePackage.version).toBe('5.24.0');
	const sourceType = `m6h-cure10-source-${Date.now()}`;
	const sourceError = new Error('custom source onRemove failed before mutation');
	let sourceOnRemoveCalls = 0;

	class ThrowingSource extends maplibregl.Evented {
		id: string;
		type = sourceType;
		minzoom = 0;
		maxzoom = 22;
		tileSize = 512;

		constructor(
			id: string,
			_options: unknown,
			_dispatcher: unknown,
			eventedParent: InstanceType<typeof maplibregl.Evented>,
		) {
			super();
			this.id = id;
			this.setEventedParent(eventedParent);
		}

		loaded(): boolean {
			return true;
		}
		onAdd(): void {
			this.fire(new maplibregl.Event('data', { dataType: 'source', sourceDataType: 'metadata' }));
		}
		onRemove(): void {
			sourceOnRemoveCalls += 1;
			throw sourceError;
		}
		loadTile(): Promise<void> {
			return Promise.resolve();
		}
		abortTile(): Promise<void> {
			return Promise.resolve();
		}
		unloadTile(): Promise<void> {
			return Promise.resolve();
		}
		hasTile(): boolean {
			return true;
		}
		hasTransition(): boolean {
			return false;
		}
		serialize(): { type: string } {
			return { type: sourceType };
		}
	}

	await maplibregl.addSourceType(sourceType, ThrowingSource as never);
	const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
	class FakeWorker extends EventTarget {
		postMessage(message: { id: string; sourceMapId?: string | number | null }): void {
			queueMicrotask(() => {
				this.dispatchEvent(
					new MessageEvent('message', {
						data: {
							id: message.id,
							type: '<response>',
							origin: location.origin,
							sourceMapId: null,
							targetMapId: message.sourceMapId,
							error: null,
							data: undefined,
						},
					}),
				);
			});
		}
		terminate(): void {}
	}
	Object.defineProperty(globalThis, 'Worker', {
		configurable: true,
		writable: true,
		value: FakeWorker,
	});

	type GlobalReceipt = {
		readonly target: EventTarget;
		readonly type: string;
		readonly listener: EventListenerOrEventListenerObject;
		readonly wrapped: EventListener;
		readonly options?: boolean | AddEventListenerOptions;
		active: boolean;
	};
	const receipts: GlobalReceipt[] = [];
	let dispatches = 0;

	function instrument(target: EventTarget): () => void {
		const add = target.addEventListener.bind(target);
		const remove = target.removeEventListener.bind(target);
		target.addEventListener = ((
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | AddEventListenerOptions,
		) => {
			if (!listener) return;
			const receipt: GlobalReceipt = {
				target,
				type,
				listener,
				options,
				active: true,
				wrapped: (event) => {
					dispatches += 1;
					if (typeof listener === 'function') listener.call(target, event);
					else listener.handleEvent(event);
				},
			};
			receipts.push(receipt);
			add(type, receipt.wrapped, options);
		}) as typeof target.addEventListener;
		target.removeEventListener = ((
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | EventListenerOptions,
		) => {
			const receipt = [...receipts]
				.reverse()
				.find(
					(candidate) =>
						candidate.active &&
						candidate.target === target &&
						candidate.type === type &&
						candidate.listener === listener,
				);
			if (receipt) {
				receipt.active = false;
				remove(type, receipt.wrapped, options);
				return;
			}
			if (listener) remove(type, listener, options);
		}) as typeof target.removeEventListener;
		return () => {
			target.addEventListener = add as typeof target.addEventListener;
			target.removeEventListener = remove as typeof target.removeEventListener;
		};
	}

	const restoreDocument = instrument(document);
	const restoreWindow = instrument(window);
	const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
	const NativeResizeObserver = window.ResizeObserver;
	let activeResizeObservers = 0;
	class TrackingResizeObserver extends NativeResizeObserver {
		private active = true;

		constructor(callback: ResizeObserverCallback) {
			super(callback);
			activeResizeObservers += 1;
		}

		override disconnect(): void {
			if (this.active) {
				this.active = false;
				activeResizeObservers -= 1;
			}
			super.disconnect();
		}
	}
	Object.defineProperty(window, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: TrackingResizeObserver,
	});
	let loseContextCalls = 0;
	class ProbeMap extends maplibregl.Map {
		override _setupPainter(): void {
			this.painter = {
				destroy: () => {},
				context: {
					gl: {
						getExtension: (name: string) =>
							name === 'WEBGL_lose_context' ? { loseContext: () => (loseContextCalls += 1) } : null,
					},
				},
			} as unknown as MapLibreMap['painter'];
		}

		override resize(): this {
			return this;
		}

		override triggerRepaint(): void {}
	}

	const activeDocumentSeries: number[] = [];
	const activeWindowSeries: number[] = [];
	const staleDispatchSeries: number[] = [];
	const activeResizeSeries: number[] = [];
	const registrySizeSeries: number[] = [];
	const containerChildrenSeries: number[] = [];
	const containerClassSeries: string[] = [];

	try {
		for (let round = 0; round < 3; round += 1) {
			const container = document.createElement('div');
			document.body.append(container);
			const map = constructRecoverableMap(
				ProbeMap,
				{
					container,
					attributionControl: false,
					interactive: false,
					validateStyle: false,
					style: {
						version: 8,
						sources: { application: { type: sourceType } as never },
						layers: [],
					},
				},
				vi.fn(),
			) as ProbeMap;
			for (let checkpoint = 0; checkpoint < 20; checkpoint += 1) await Promise.resolve();
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(
				(map as unknown as { style?: { tileManagers?: Record<string, unknown> } }).style
					?.tileManagers?.application,
			).toBeTruthy();

			expect(() => map.setStyle(null)).toThrow(sourceError);
			expect(() => map.remove()).toThrow(sourceError);
			const beforeDispatch = dispatches;
			document.dispatchEvent(new MouseEvent('mousemove'));
			document.dispatchEvent(new MouseEvent('mouseup'));
			window.dispatchEvent(new Event('blur'));
			window.dispatchEvent(new Event('online'));
			activeDocumentSeries.push(
				receipts.filter((receipt) => receipt.active && receipt.target === document).length,
			);
			activeWindowSeries.push(
				receipts.filter((receipt) => receipt.active && receipt.target === window).length,
			);
			staleDispatchSeries.push(dispatches - beforeDispatch);
			activeResizeSeries.push(activeResizeObservers);
			registrySizeSeries.push(mapAppDisposalSize(map));
			containerChildrenSeries.push(container.childElementCount);
			containerClassSeries.push(container.className);
		}

		expect(activeDocumentSeries).toEqual([0, 0, 0]);
		expect(activeWindowSeries).toEqual([0, 0, 0]);
		expect(staleDispatchSeries).toEqual([0, 0, 0]);
		expect(activeResizeSeries).toEqual([0, 0, 0]);
		expect(registrySizeSeries).toEqual([0, 0, 0]);
		expect(containerChildrenSeries).toEqual([0, 0, 0]);
		expect(containerClassSeries).toEqual(['', '', '']);
		expect(sourceOnRemoveCalls).toBe(6);
		expect(loseContextCalls).toBe(0);
	} finally {
		for (const receipt of receipts) {
			if (receipt.active) {
				receipt.target.removeEventListener(receipt.type, receipt.listener, receipt.options);
			}
		}
		restoreDocument();
		restoreWindow();
		if (resizeObserverDescriptor) {
			Object.defineProperty(window, 'ResizeObserver', resizeObserverDescriptor);
		} else {
			Reflect.deleteProperty(window, 'ResizeObserver');
		}
		if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor);
		else Reflect.deleteProperty(globalThis, 'Worker');
	}
});

it('deletes bundled ImageRequest callbacks across repeated runtime painter faults', () => {
	const painterError = new Error('runtime painter destroy failed');
	let staleCallbackCalls = 0;
	let loseContextCalls = 0;
	type GlobalReceipt = {
		readonly target: EventTarget;
		readonly type: string;
		readonly listener: EventListenerOrEventListenerObject;
		readonly wrapped: EventListener;
		readonly options?: boolean | AddEventListenerOptions;
		active: boolean;
	};
	const receipts: GlobalReceipt[] = [];
	let dispatches = 0;
	function instrument(target: EventTarget): () => void {
		const add = target.addEventListener.bind(target);
		const remove = target.removeEventListener.bind(target);
		target.addEventListener = ((
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | AddEventListenerOptions,
		) => {
			if (!listener) return;
			const receipt: GlobalReceipt = {
				target,
				type,
				listener,
				options,
				active: true,
				wrapped: (event) => {
					dispatches += 1;
					if (typeof listener === 'function') listener.call(target, event);
					else listener.handleEvent(event);
				},
			};
			receipts.push(receipt);
			add(type, receipt.wrapped, options);
		}) as typeof target.addEventListener;
		target.removeEventListener = ((
			type: string,
			listener: EventListenerOrEventListenerObject | null,
			options?: boolean | EventListenerOptions,
		) => {
			const receipt = [...receipts]
				.reverse()
				.find(
					(candidate) =>
						candidate.active &&
						candidate.target === target &&
						candidate.type === type &&
						candidate.listener === listener,
				);
			if (receipt) {
				receipt.active = false;
				remove(type, receipt.wrapped, options);
				return;
			}
			if (listener) remove(type, listener, options);
		}) as typeof target.removeEventListener;
		return () => {
			target.addEventListener = add as typeof target.addEventListener;
			target.removeEventListener = remove as typeof target.removeEventListener;
		};
	}

	const restoreDocument = instrument(document);
	const restoreWindow = instrument(window);
	const resizeObserverDescriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
	const NativeResizeObserver = window.ResizeObserver;
	let activeResizeObservers = 0;
	class TrackingResizeObserver extends NativeResizeObserver {
		private active = true;

		constructor(callback: ResizeObserverCallback) {
			super(callback);
			activeResizeObservers += 1;
		}

		override disconnect(): void {
			if (this.active) {
				this.active = false;
				activeResizeObservers -= 1;
			}
			super.disconnect();
		}
	}
	Object.defineProperty(window, 'ResizeObserver', {
		configurable: true,
		writable: true,
		value: TrackingResizeObserver,
	});
	let removeEvents = 0;
	class ProbeMap extends maplibregl.Map {
		override _setupPainter(): void {
			this.painter = {
				destroy: () => {
					throw painterError;
				},
				context: {
					gl: {
						getExtension: (name: string) =>
							name === 'WEBGL_lose_context' ? { loseContext: () => (loseContextCalls += 1) } : null,
					},
				},
			} as unknown as MapLibreMap['painter'];
		}

		override resize(): this {
			return this;
		}

		override isMoving(): boolean {
			staleCallbackCalls += 1;
			return false;
		}
	}

	const containers: HTMLElement[] = [];
	const activeDocumentSeries: number[] = [];
	const activeWindowSeries: number[] = [];
	const staleDispatchSeries: number[] = [];
	const activeResizeSeries: number[] = [];
	const registrySizeSeries: number[] = [];
	const removedSeries: boolean[] = [];
	try {
		for (let round = 0; round < 3; round += 1) {
			const container = document.createElement('div');
			document.body.append(container);
			containers.push(container);
			const map = constructRecoverableMap(
				ProbeMap,
				{ container, attributionControl: false, interactive: false },
				vi.fn(),
			);
			map.on('remove', () => {
				removeEvents += 1;
			});
			expect(() => map.remove()).toThrow(painterError);
			const beforeDispatch = dispatches;
			document.dispatchEvent(new MouseEvent('mousemove'));
			document.dispatchEvent(new MouseEvent('mouseup'));
			window.dispatchEvent(new Event('blur'));
			window.dispatchEvent(new Event('online'));
			activeDocumentSeries.push(
				receipts.filter((receipt) => receipt.active && receipt.target === document).length,
			);
			activeWindowSeries.push(
				receipts.filter((receipt) => receipt.active && receipt.target === window).length,
			);
			staleDispatchSeries.push(dispatches - beforeDispatch);
			activeResizeSeries.push(activeResizeObservers);
			registrySizeSeries.push(mapAppDisposalSize(map));
			removedSeries.push((map as unknown as { readonly _removed?: boolean })._removed ?? false);
		}
		flushImageThrottleCallbacks();

		expect(activeDocumentSeries).toEqual([0, 0, 0]);
		expect(activeWindowSeries).toEqual([0, 0, 0]);
		expect(staleDispatchSeries).toEqual([0, 0, 0]);
		expect(activeResizeSeries).toEqual([0, 0, 0]);
		expect(registrySizeSeries).toEqual([0, 0, 0]);
		expect(removedSeries).toEqual([true, true, true]);
		expect(staleCallbackCalls).toBe(0);
		expect(loseContextCalls).toBe(3);
		expect(removeEvents).toBe(3);
		for (const container of containers) {
			expect(container.childElementCount).toBe(0);
			expect(container.className).toBe('');
		}
	} finally {
		for (const receipt of receipts) {
			if (receipt.active) {
				receipt.target.removeEventListener(receipt.type, receipt.listener, receipt.options);
			}
		}
		restoreDocument();
		restoreWindow();
		if (resizeObserverDescriptor) {
			Object.defineProperty(window, 'ResizeObserver', resizeObserverDescriptor);
		} else {
			Reflect.deleteProperty(window, 'ResizeObserver');
		}
	}
});

it('does not run constructor rollback for a later context-restoration failure', () => {
	const restorationError = new Error('restored painter failed');
	const originalHandlers = { destroy: vi.fn() };
	class RestorableMap {
		readonly _canvasContextAttributes = { contextType: 'webgl2' as const };
		readonly _canvas = document.createElement('canvas');
		readonly painter = { destroy: vi.fn(), context: { gl: { getExtension: () => null } } };
		readonly handlers = originalHandlers;
		setupCalls = 0;
		removeCalls = 0;

		constructor(_options: unknown) {
			this._setupPainter();
		}

		_setupPainter(): void {
			this.setupCalls += 1;
			if (this.setupCalls > 1) throw restorationError;
		}

		remove(): void {
			this.removeCalls += 1;
		}

		restoreContext(): void {
			this._setupPainter();
		}
	}

	const reportCleanupFailure = vi.fn();
	const map = constructRecoverableMap(
		RestorableMap as unknown as typeof maplibregl.Map,
		{ container: document.createElement('div') },
		reportCleanupFailure,
	) as unknown as RestorableMap;

	expect(() => map.restoreContext()).toThrow(restorationError);
	expect(map.removeCalls).toBe(0);
	expect(map.handlers).toBe(originalHandlers);
	expect(reportCleanupFailure).not.toHaveBeenCalled();
});

// @vitest-environment happy-dom
import maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import maplibrePackage from 'maplibre-gl/package.json';
import { afterEach, expect, it, vi } from 'vitest';
import { constructRecoverableMap } from './maplibreConstructorCleanup';

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

it('deletes bundled ImageRequest callbacks across repeated runtime painter faults', () => {
	const painterError = new Error('runtime painter destroy failed');
	let staleCallbackCalls = 0;
	let loseContextCalls = 0;
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
	for (let round = 0; round < 3; round += 1) {
		const container = document.createElement('div');
		document.body.append(container);
		containers.push(container);
		const map = constructRecoverableMap(
			ProbeMap,
			{ container, attributionControl: false, interactive: false },
			vi.fn(),
		);
		expect(() => map.remove()).toThrow(painterError);
	}
	flushImageThrottleCallbacks();

	expect(staleCallbackCalls).toBe(0);
	expect(loseContextCalls).toBe(3);
	for (const container of containers) {
		expect(container.childElementCount).toBe(0);
		expect(container.className).toBe('');
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

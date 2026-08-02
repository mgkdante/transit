// @vitest-environment happy-dom
import maplibregl from 'maplibre-gl';
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

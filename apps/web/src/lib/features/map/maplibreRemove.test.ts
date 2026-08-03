import maplibregl from 'maplibre-gl';
import { expect, it } from 'vitest';

function bareRealMap(
	control: { onRemove(map: InstanceType<typeof maplibregl.Map>): void },
	trace: string[] = [],
) {
	const MapLibreMap = maplibregl.Map;
	const map = Object.create(MapLibreMap.prototype) as InstanceType<typeof MapLibreMap>;
	const noop = () => {};

	Object.assign(map, {
		_controls: [control],
		_frameRequest: null,
		_renderTaskQueue: { clear: noop },
		_diffStyleRequest: null,
		painter: {
			destroy: () => trace.push('painter.destroy'),
			context: { gl: { getExtension: () => null } },
		},
		handlers: { destroy: () => trace.push('handlers.destroy') },
		setStyle: (style: unknown) => trace.push(`setStyle:${String(style)}`),
		_imageQueueHandle: undefined,
		_resizeObserver: null,
		_canvas: { removeEventListener: noop },
		_canvasContainer: { remove: () => trace.push('canvas.remove') },
		_controlContainer: { remove: () => trace.push('controls.remove') },
		_container: {
			removeEventListener: noop,
			classList: { remove: noop },
		},
		_removed: false,
	});

	const handler = () => {};
	map.on('click', handler);
	return {
		map,
		trace,
		internals: map as unknown as {
			_controls: unknown[];
			_listeners?: Record<string, unknown[]>;
			_removed: boolean;
		},
	};
}

it('characterizes real MapLibre remove order while retaining Evented listeners', () => {
	const trace: string[] = [];
	const fixture = bareRealMap(
		{
			onRemove: () => trace.push('control.onRemove'),
		},
		trace,
	);
	const before = fixture.internals._listeners?.click?.length ?? 0;

	fixture.map.remove();

	expect(trace).toEqual([
		'control.onRemove',
		'painter.destroy',
		'handlers.destroy',
		'setStyle:null',
		'canvas.remove',
		'controls.remove',
	]);
	expect({
		before,
		after: fixture.internals._listeners?.click?.length ?? 0,
		controls: fixture.internals._controls.length,
		removed: fixture.internals._removed,
	}).toEqual({ before: 1, after: 1, controls: 0, removed: true });
});

it('characterizes a control fault as aborting real remove before style and DOM release', () => {
	const error = new Error('control removal failed');
	const trace: string[] = [];
	const fixture = bareRealMap(
		{
			onRemove: () => {
				trace.push('control.onRemove');
				throw error;
			},
		},
		trace,
	);

	expect(() => fixture.map.remove()).toThrow(error);

	expect(trace).toEqual(['control.onRemove']);
	expect(fixture.trace).toEqual(['control.onRemove']);
	expect(fixture.internals._controls).toHaveLength(1);
	expect(fixture.internals._listeners?.click).toHaveLength(1);
	expect(fixture.internals._removed).toBe(false);
});

it('characterizes removeControl ownership as splicing a faulty control before raw removal', () => {
	const error = new Error('owned control removal failed once');
	const trace: string[] = [];
	let fail = true;
	const control = {
		onRemove: () => {
			trace.push('control.onRemove');
			if (fail) {
				fail = false;
				throw error;
			}
		},
	};
	const fixture = bareRealMap(control, trace);

	expect(() => fixture.map.removeControl(control as never)).toThrow(error);
	expect(fixture.internals._controls).toHaveLength(0);

	fixture.map.remove();

	expect(trace).toEqual([
		'control.onRemove',
		'painter.destroy',
		'handlers.destroy',
		'setStyle:null',
		'canvas.remove',
		'controls.remove',
	]);
	expect(fixture.internals._removed).toBe(true);
});

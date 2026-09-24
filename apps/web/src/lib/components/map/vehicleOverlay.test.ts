import type { Map as MapLibreMap } from 'maplibre-gl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VehicleFC, VehicleFeature } from './vehicleLayer';
import { createVehicleOverlay, VEHICLE_OVERLAY_RECEIPT } from './vehicleOverlay';
import { HEADING_ICON, SILENT_ICON, type VehicleSpriteReceipt } from './vehicleSprites';

type PaintCall = { kind: string; id?: string; values?: number[]; opacity?: number };

function image(id: string, width = 52, height = 52): ImageData {
	return { width, height, id } as unknown as ImageData;
}

function harness() {
	const calls: PaintCall[] = [];
	function contextFor(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
		let opacity = 1;
		return {
			get globalAlpha() {
				return opacity;
			},
			set globalAlpha(value: number) {
				opacity = value;
			},
			putImageData(source: ImageData) {
				canvas.dataset.sprite = (source as ImageData & { id: string }).id;
			},
			setTransform(...values: number[]) {
				if (canvas.dataset.slot === 'vehicle-overlay') calls.push({ kind: 'transform', values });
			},
			clearRect() {
				if (canvas.dataset.slot === 'vehicle-overlay') calls.push({ kind: 'clear' });
			},
			drawImage(source: HTMLCanvasElement, ...values: number[]) {
				if (canvas.dataset.slot === 'vehicle-overlay')
					calls.push({ kind: 'sprite', id: source.dataset.sprite, values, opacity });
			},
			beginPath() {},
			arc(x: number, y: number, radius: number) {
				if (canvas.dataset.slot === 'vehicle-overlay')
					calls.push({ kind: 'circle', values: [x, y, radius], opacity });
			},
			fill() {},
			stroke() {},
			save() {},
			restore() {},
			translate() {},
			rotate(angle: number) {
				if (canvas.dataset.slot === 'vehicle-overlay')
					calls.push({ kind: 'rotate', values: [angle] });
			},
		} as unknown as CanvasRenderingContext2D;
	}
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
		this: HTMLCanvasElement,
	) {
		return contextFor(this);
	});
	const gl = document.createElement('canvas');
	gl.width = 1200;
	gl.height = 900;
	vi.spyOn(gl, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 600 } as DOMRect);
	const container = document.createElement('div');
	container.appendChild(gl);
	const handlers = new Map<string, Set<() => void>>();
	const on = vi.fn((name: string, handler: () => void) => {
		const values = handlers.get(name) ?? new Set();
		values.add(handler);
		handlers.set(name, values);
	});
	const off = vi.fn((name: string, handler: () => void) => handlers.get(name)?.delete(handler));
	let zoom = 11;
	let pitch = 0;
	let bearing = 0;
	const triggerRepaint = vi.fn();
	const map = {
		getCanvas: () => gl,
		getCanvasContainer: () => container,
		getCenter: () => ({ lng: 0, lat: 0 }),
		getPadding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
		getZoom: () => zoom,
		getPitch: () => pitch,
		getBearing: () => bearing,
		getRoll: () => 0,
		getVerticalFieldOfView: () => 36.87,
		project: ([lon, lat]: [number, number]) => ({ x: 400 + lon * 20, y: 300 + lat * 20 }),
		triggerRepaint,
		on,
		off,
	} as unknown as MapLibreMap;
	const sprites = {
		pixelRatio: 2,
		sprites: Object.fromEntries(
			['body-a', 'body-b', HEADING_ICON, 'mark-a', 'mark-b', SILENT_ICON].map((id) => [
				id,
				image(id),
			]),
		),
	} as unknown as VehicleSpriteReceipt;
	const pin = image('pin', 88, 120);
	const overlay = createVehicleOverlay(map, sprites, pin);
	return {
		calls,
		container,
		handlers,
		map,
		overlay,
		triggerRepaint,
		on,
		off,
		sprites,
		pin,
		setCamera(next: { zoom?: number; pitch?: number; bearing?: number }) {
			zoom = next.zoom ?? zoom;
			pitch = next.pitch ?? pitch;
			bearing = next.bearing ?? bearing;
		},
	};
}

function feature(
	id: string,
	lon: number,
	extra: Partial<VehicleFeature['properties']> = {},
): VehicleFeature {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [lon, 0] },
		properties: {
			id,
			body: `body-${id}`,
			mark: `mark-${id}`,
			bearing: 0,
			hasHeading: 1,
			route: '',
			selected: 0,
			matched: 1,
			stale: 0,
			...extra,
		},
	};
}

afterEach(() => vi.restoreAllMocks());

describe('vehicle moving foreground', () => {
	it('paints full-feature passes and the near-target pin last with the GL backing ratio', () => {
		const { overlay, calls, container } = harness();
		overlay.setScene(false, { lon: 3, lat: 0, label: 'Near' }, null, null);
		overlay.draw({
			type: 'FeatureCollection',
			features: [feature('a', 0, { stale: 1 }), feature('b', 1)],
		});
		const ids = calls.filter((call) => call.kind === 'sprite').map((call) => call.id);
		expect(ids).toEqual([
			'body-b',
			'body-a',
			HEADING_ICON,
			HEADING_ICON,
			'mark-b',
			'mark-a',
			SILENT_ICON,
			'pin',
		]);
		expect(calls.find((call) => call.kind === 'transform')?.values).toEqual([1.5, 0, 0, 1.5, 0, 0]);
		expect(overlay.receipt).toMatchObject({
			projectedCount: 2,
			paintedBodyCount: 2,
			drawSequence: 1,
		});
		const canvas = container.querySelector('[data-slot="vehicle-overlay"]') as HTMLCanvasElement;
		expect((canvas as unknown as Record<symbol, unknown>)[VEHICLE_OVERLAY_RECEIPT]).toBe(
			overlay.receipt,
		);
		expect(canvas.width).toBe(1200);
		expect(canvas.height).toBe(900);
		overlay.destroy();
	});

	it('keeps all features projected but picks only matched body bounding boxes in reverse paint order', () => {
		const { overlay } = harness();
		const features: VehicleFC = {
			type: 'FeatureCollection',
			features: [feature('a', 0), feature('b', 1), feature('hidden', 2, { matched: 0 })],
		};
		overlay.draw(features);
		expect(overlay.receipt).toMatchObject({ projectedCount: 3, paintedBodyCount: 2 });
		expect(overlay.pick([410, 300])).toBe('a');
		// At z11, the body visually ends near x410.14; MapLibre's collision box
		// includes its next-bucket layout size and default icon padding.
		expect(overlay.pick([414, 300])).toBe('b');
		expect(overlay.pick([386.5, 300])).toBe('a');
		expect(overlay.pick([385, 300])).toBeNull();
		expect(overlay.pick([440, 300])).toBeNull();
		overlay.destroy();
	});

	it('paints smaller viewport-Y symbols first and lets lower source index win exact-Y ties', () => {
		const { overlay, calls } = harness();
		const lower = {
			...feature('a', 0),
			geometry: { type: 'Point' as const, coordinates: [0, 0.25] as const },
		};
		const upper = feature('b', 0);
		overlay.draw({ type: 'FeatureCollection', features: [lower, upper] });
		expect(
			calls
				.filter((call) => call.kind === 'sprite' && call.id?.startsWith('body-'))
				.map((call) => call.id),
		).toEqual(['body-b', 'body-a']);
		expect(overlay.pick([400, 302])).toBe('a');
		overlay.destroy();
	});

	it('never hits or counts a matched body whose sprite is missing', () => {
		const { overlay } = harness();
		overlay.draw({ type: 'FeatureCollection', features: [feature('unknown', 0)] });
		expect(overlay.receipt).toMatchObject({ projectedCount: 1, paintedBodyCount: 0 });
		expect(overlay.pick([400, 300])).toBeNull();
		overlay.destroy();
	});

	it('keeps badge and heading size separate from body pitch scaling, with global stale dim only on the first three sprite passes', () => {
		const { overlay, calls, setCamera } = harness();
		setCamera({ pitch: 40, bearing: 45 });
		overlay.setScene(true, null, null, null);
		overlay.draw({ type: 'FeatureCollection', features: [feature('a', 0, { stale: 1 })] });
		const sprites = calls.filter((call) => call.kind === 'sprite');
		expect(sprites.map((call) => [call.id, call.opacity])).toEqual([
			['body-a', 0.45],
			[HEADING_ICON, 0.45],
			['mark-a', 0.45],
			[SILENT_ICON, 1],
		]);
		// At the camera center P=1. An explicit icon-offset suppresses the
		// perspective size multiplier for heading/badge layers in MapLibre 6.4.1.
		expect(sprites[0]?.values?.[2]).toBeCloseTo(26 * 0.78, 3);
		expect(sprites[1]?.values?.[2]).toBeCloseTo(26 * 0.78, 3);
		expect(sprites[2]?.values?.[2]).toBeCloseTo(26 * 0.78 * 0.6, 3);
		expect(calls.find((call) => call.kind === 'rotate')?.values?.[0] ?? 0).toBeCloseTo(
			(-37.45 * Math.PI) / 180,
			2,
		);
		overlay.destroy();
	});

	it('redraws synchronously on camera render without requesting a MapLibre repaint, then disposes listeners and hit records', () => {
		const { overlay, handlers, container, triggerRepaint, setCamera } = harness();
		overlay.draw({ type: 'FeatureCollection', features: [feature('a', 0)] });
		const first = overlay.receipt.drawSequence;
		handlers.get('render')?.forEach((handler) => handler());
		expect(overlay.receipt.drawSequence).toBe(first);
		setCamera({ zoom: 12, pitch: 40, bearing: 45 });
		handlers.get('render')?.forEach((handler) => handler());
		expect(overlay.receipt.drawSequence).toBe(first + 1);
		expect(triggerRepaint).not.toHaveBeenCalled();
		handlers.get('webglcontextlost')?.forEach((handler) => handler());
		expect(overlay.pick([400, 300])).toBeNull();
		overlay.resume();
		overlay.redraw();
		expect(overlay.pick([400, 300])).toBe('a');
		overlay.destroy();
		expect(overlay.receipt.destroyed).toBe(true);
		expect(container.querySelector('[data-slot="vehicle-overlay"]')).toBeNull();
		expect(handlers.get('render')?.size).toBe(0);
		expect(handlers.get('webglcontextlost')?.size).toBe(0);
	});

	it('keeps failed listener cleanup retryable while removing the owned canvas immediately', () => {
		const { overlay, handlers, container, off } = harness();
		overlay.draw({ type: 'FeatureCollection', features: [feature('a', 0)] });
		const failure = new Error('render listener detach failed');
		off.mockImplementationOnce(() => {
			throw failure;
		});
		expect(() => overlay.destroy()).toThrow(failure);
		expect(container.querySelector('[data-slot="vehicle-overlay"]')).toBeNull();
		expect(overlay.pick([400, 300])).toBeNull();
		expect(overlay.receipt.destroyed).toBe(false);
		expect(handlers.get('render')?.size).toBe(1);
		expect(handlers.get('webglcontextlost')?.size).toBe(0);
		expect(() => overlay.destroy()).not.toThrow();
		expect(handlers.get('render')?.size).toBe(0);
		expect(overlay.receipt.destroyed).toBe(true);
	});

	it('withholds painted hits through independent 2D and WebGL loss until both contexts recover', () => {
		const { overlay, container, handlers } = harness();
		overlay.draw({ type: 'FeatureCollection', features: [feature('a', 0)] });
		const canvas = container.querySelector('[data-slot="vehicle-overlay"]') as HTMLCanvasElement;
		const sequence = overlay.receipt.drawSequence;
		canvas.dispatchEvent(new Event('contextlost'));
		expect(overlay.receipt).toMatchObject({
			drawable: false,
			paintedBodyCount: 0,
			drawSequence: sequence,
		});
		expect(overlay.pick([400, 300])).toBeNull();
		handlers.get('webglcontextlost')?.forEach((handler) => handler());
		canvas.dispatchEvent(new Event('contextrestored'));
		expect(overlay.receipt.drawable).toBe(false);
		overlay.resume();
		overlay.redraw();
		expect(overlay.receipt).toMatchObject({ drawable: true, paintedBodyCount: 1 });
		expect(overlay.pick([400, 300])).toBe('a');
		overlay.destroy();
	});

	it('rolls back a mutating second-listener failure and exposes any failed cleanup for retry', () => {
		const { overlay, map, container, handlers, on, off, sprites, pin } = harness();
		overlay.destroy();
		const install = on.getMockImplementation()!;
		const registrationError = new Error('context-loss listener failed after registration');
		on.mockImplementation((name, handler) => {
			install(name, handler);
			if (name === 'webglcontextlost') throw registrationError;
		});
		expect(() => createVehicleOverlay(map, sprites, pin)).toThrow(registrationError);
		expect(container.querySelector('[data-slot="vehicle-overlay"]')).toBeNull();
		expect(handlers.get('render')?.size).toBe(0);
		expect(handlers.get('webglcontextlost')?.size).toBe(0);

		off.mockImplementationOnce(() => {
			throw new Error('first rollback failed');
		});
		let failure: unknown;
		try {
			createVehicleOverlay(map, sprites, pin);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(AggregateError);
		const pending = (
			failure as AggregateError & { overlay: ReturnType<typeof createVehicleOverlay> }
		).overlay;
		expect(pending).toBeDefined();
		expect(container.querySelector('[data-slot="vehicle-overlay"]')).toBeNull();
		expect(handlers.get('render')?.size).toBe(1);
		expect(() => pending.destroy()).not.toThrow();
		expect(handlers.get('render')?.size).toBe(0);
	});
});

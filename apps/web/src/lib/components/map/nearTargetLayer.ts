import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { GeocodePrecision } from '$lib/geocode/types';
import { resolveColor } from './vehicleSprites';

export const NEAR_TARGET_SOURCE = 'near-target';
export const NEAR_TARGET_LAYER = 'near-target-pin';
export const LOCATION_PIN_ICON = 'near-target-pin';

interface NearTarget {
	readonly lat: number;
	readonly lon: number;
	readonly label: string;
	readonly precision?: GeocodePrecision;
}

interface NearTargetFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: { id: string; label: string; precision: string };
}

interface NearTargetFC {
	type: 'FeatureCollection';
	features: NearTargetFeature[];
}

const EMPTY_FC: NearTargetFC = { type: 'FeatureCollection', features: [] };
const PIN_WIDTH = 44;
const PIN_HEIGHT = 60;
const PIN_RATIO = 2;

export function toNearTargetFeatures(target: NearTarget | null): NearTargetFC {
	if (!target) return EMPTY_FC;
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [target.lon, target.lat] },
				properties: {
					id: 'near-target',
					label: target.label,
					precision: target.precision ?? 'place',
				},
			},
		],
	};
}

export function bakeLocationPinSprite(map: MapLibreMap): void {
	if (typeof document === 'undefined') return;
	const fill = resolveColor('var(--accent-text)', 'rgb(255, 182, 39)');
	const halo = resolveColor('var(--background)', 'rgb(20, 20, 20)');
	const inner = resolveColor('var(--card)', 'rgb(255, 255, 255)');
	if (map.hasImage(LOCATION_PIN_ICON)) map.removeImage(LOCATION_PIN_ICON);
	map.addImage(LOCATION_PIN_ICON, pinImage(fill, halo, inner), { pixelRatio: PIN_RATIO });
}

export function addNearTargetSource(map: MapLibreMap): void {
	if (map.getSource(NEAR_TARGET_SOURCE)) return;
	map.addSource(NEAR_TARGET_SOURCE, { type: 'geojson', data: EMPTY_FC, promoteId: 'id' });
}

export function addNearTargetLayer(map: MapLibreMap): void {
	if (map.getLayer(NEAR_TARGET_LAYER)) return;
	map.addLayer({
		id: NEAR_TARGET_LAYER,
		type: 'symbol',
		source: NEAR_TARGET_SOURCE,
		layout: {
			'icon-image': LOCATION_PIN_ICON,
			'icon-anchor': 'bottom',
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
			'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.82, 13, 1.03, 17, 1.18],
		},
		paint: {
			'icon-opacity': 1,
		},
	} as unknown as LayerSpecification);
}

export function setNearTarget(map: MapLibreMap, target: NearTarget | null): void {
	const src = map.getSource(NEAR_TARGET_SOURCE) as GeoJSONSource | undefined;
	src?.setData(toNearTargetFeatures(target) as unknown as Parameters<GeoJSONSource['setData']>[0]);
}

function pinImage(fill: string, halo: string, inner: string): ImageData {
	const pxWidth = PIN_WIDTH * PIN_RATIO;
	const pxHeight = PIN_HEIGHT * PIN_RATIO;
	const canvas = document.createElement('canvas');
	canvas.width = pxWidth;
	canvas.height = pxHeight;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('[nearTargetLayer] 2D canvas context unavailable');
	ctx.scale(PIN_RATIO, PIN_RATIO);

	const c = PIN_WIDTH / 2;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.lineWidth = 4.5;
	ctx.strokeStyle = halo;
	ctx.fillStyle = fill;
	drawPinPath(ctx, c);
	ctx.fill();
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(c, 20, 6.5, 0, Math.PI * 2);
	ctx.fillStyle = inner;
	ctx.fill();
	ctx.lineWidth = 1.4;
	ctx.strokeStyle = halo;
	ctx.stroke();

	return ctx.getImageData(0, 0, pxWidth, pxHeight);
}

function drawPinPath(ctx: CanvasRenderingContext2D, c: number): void {
	ctx.beginPath();
	ctx.moveTo(c, PIN_HEIGHT - 3);
	ctx.bezierCurveTo(c - 3.5, PIN_HEIGHT - 12, 6, 34, 6, 21);
	ctx.bezierCurveTo(6, 9, 15, 3.5, c, 3.5);
	ctx.bezierCurveTo(PIN_WIDTH - 6, 3.5, PIN_WIDTH - 6, 9, PIN_WIDTH - 6, 21);
	ctx.bezierCurveTo(PIN_WIDTH - 6, 34, c + 3.5, PIN_HEIGHT - 12, c, PIN_HEIGHT - 3);
	ctx.closePath();
}

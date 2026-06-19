// map/vehicleSprites.ts — browser-only canvas baker for vehicle + stop icons.
//
// A vehicle is a single PAINTED BUS pictogram — the filter REPAINTS the bus
// fill (default orange → a status/occupancy colour) and HIDES non-matches, so
// colour alone carries state and the map stays uncluttered. The bus glyph is
// baked UPRIGHT and legible at every bearing: heading is rendered by a SEPARATE
// rotated CHEVRON layer (see vehicleLayer.ts) that points the way the bus is
// going, so the bus-front never reads upside-down. SHAPE encodes the entity:
//   · bus → a BUS-FRONT pictogram (PAINTED with the bus fill);
//   · heading → a small CHEVRON (separate rotated layer; ONE sprite, neutral);
//   · stop → a MAP-PIN pictogram (PAINTED with --map-stop-fill).
// Colours are read from live CSS tokens via a probe element (NEVER hardcoded
// hex), so a theme swap re-bakes to the active palette. Baked at devicePixelRatio
// so glyphs stay crisp on retina.

import type { Map as MapLibreMap } from 'maplibre-gl';
import {
	STATUS_CODES,
	OCCUPANCY_CODES,
	type StatusCode,
	type OccupancyCode,
} from '$lib/v1/schemas';
import { statusVar, occupancyVar } from '$lib/components/dataviz';

/** Logical icon box (px); baked at RATIO for retina crispness. */
const SIZE = 26;
/** Bake at the device pixel ratio (>=2) so glyphs stay crisp on retina. */
const RATIO =
	typeof window !== 'undefined' ? Math.max(2, Math.ceil(window.devicePixelRatio || 1)) : 2;

/** Default (no-filter) bus icon id — yesid brand orange. ONE sprite for every
 *  bus (no directional variants); the heading chevron is a separate layer. */
export const BUS_ICON = 'veh-bus';
/** The directional chevron icon id — ONE neutral sprite, rotated by the layer. */
export const HEADING_ICON = 'veh-heading';
/** The stop map-pin icon id. */
export const STOP_ICON = 'veh-stop';

export const BUS_FILL_TOKEN = 'var(--primary)';
export const BUS_FILL_FALLBACK = 'rgb(224, 120, 0)';
export const BUS_HALO_TOKEN = 'var(--background)';
export const BUS_HALO_FALLBACK = '#141414';
export const STOP_FILL_TOKEN = 'var(--map-stop-fill)';
export const STOP_FILL_FALLBACK = 'rgb(255, 182, 39)';
export const STOP_HALO_TOKEN = BUS_HALO_TOKEN;
export const STOP_HALO_FALLBACK = BUS_HALO_FALLBACK;
/** The chevron is a neutral direction tick that must read on ANY bus colour. */
export const HEADING_FILL_TOKEN = 'var(--foreground)';
export const HEADING_FILL_FALLBACK = '#f5f5f5';
export const HEADING_HALO_TOKEN = BUS_HALO_TOKEN;
export const HEADING_HALO_FALLBACK = BUS_HALO_FALLBACK;

/** Resolve a `var(--token)` expression to its computed `rgb(...)` string. */
export function resolveColor(varExpr: string, fallback: string): string {
	if (typeof document === 'undefined') return fallback;
	const probe = document.createElement('span');
	probe.style.cssText = `position:absolute;visibility:hidden;color:${varExpr}`;
	document.body.appendChild(probe);
	const c = getComputedStyle(probe).color;
	probe.remove();
	return c || fallback;
}

function newCtx(): { ctx: CanvasRenderingContext2D; px: number } {
	const px = SIZE * RATIO;
	const cv = document.createElement('canvas');
	cv.width = px;
	cv.height = px;
	const ctx = cv.getContext('2d');
	if (!ctx) throw new Error('[vehicleSprites] 2D canvas context unavailable');
	ctx.scale(RATIO, RATIO);
	return { ctx, px };
}

/** Trace a rounded rectangle path (no stroke/fill — caller decides). */
function roundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	const rr = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}

/**
 * Bake the BUS-FRONT pictogram, PAINTED with `fill` and ringed by `halo`. Drawn
 * upright (the heading chevron is a separate rotated layer), so it reads at
 * every bearing: a rounded body, a windshield band, and two headlights cut from
 * the halo colour so the silhouette stays a bus, not a blob, even at small zoom.
 */
function busImage(fill: string, halo: string): ImageData {
	const { ctx, px } = newCtx();
	ctx.lineJoin = 'round';

	// Body — a tall rounded rect (bus front), centred with a small margin.
	const bx = 6.5;
	const by = 3.5;
	const bw = SIZE - bx * 2;
	const bh = SIZE - by * 2;
	roundedRect(ctx, bx, by, bw, bh, 4);
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.lineWidth = 2;
	ctx.strokeStyle = halo;
	ctx.stroke();

	// Windshield — a halo-coloured band across the top third (reads as "front").
	const wm = 2.4; // inset from the body edge
	roundedRect(ctx, bx + wm, by + 2.4, bw - wm * 2, 5.6, 2);
	ctx.fillStyle = halo;
	ctx.globalAlpha = 0.9;
	ctx.fill();
	ctx.globalAlpha = 1;

	// Headlights — two small halo-coloured dots near the bottom corners.
	const ly = SIZE - by - 3.4;
	for (const lx of [bx + wm + 1.2, bx + bw - wm - 1.2]) {
		ctx.beginPath();
		ctx.arc(lx, ly, 1.15, 0, Math.PI * 2);
		ctx.fillStyle = halo;
		ctx.fill();
	}

	return ctx.getImageData(0, 0, px, px);
}

/**
 * Bake the STOP map-pin pictogram, PAINTED with `fill` and ringed by `halo`,
 * with a halo-cut hole so the pin reads as a stop marker, not a solid teardrop.
 */
function stopPinImage(fill: string, halo: string): ImageData {
	const { ctx, px } = newCtx();
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	const c = SIZE / 2;

	// Teardrop body — head arc + tapered point.
	const headY = c - 2.5;
	const headR = 6.6;
	const tipY = SIZE - 3.5;
	ctx.beginPath();
	ctx.moveTo(c, tipY);
	ctx.bezierCurveTo(
		c - headR * 0.92,
		headY + headR * 0.7,
		c - headR,
		headY,
		c - headR,
		headY - 0.5,
	);
	ctx.arc(c, headY, headR, Math.PI, 0, false);
	ctx.bezierCurveTo(c + headR, headY, c + headR * 0.92, headY + headR * 0.7, c, tipY);
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.lineWidth = 2;
	ctx.strokeStyle = halo;
	ctx.stroke();

	// Inner hole — halo-coloured, so the pin reads hollow (a stop, not a blob).
	ctx.beginPath();
	ctx.arc(c, headY, 2.5, 0, Math.PI * 2);
	ctx.fillStyle = halo;
	ctx.fill();

	return ctx.getImageData(0, 0, px, px);
}

/**
 * Bake the directional CHEVRON — a single neutral arrowhead (nose up), PAINTED
 * with `fill` and ringed by `halo`. ONE sprite; the layer rotates it by bearing
 * and floats it just ahead of the bus, so the bus glyph itself stays upright.
 */
function chevronImage(fill: string, halo: string): ImageData {
	const { ctx, px } = newCtx();
	const c = SIZE / 2;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	// A compact chevron near the TOP of the box so it sits ahead of the bus
	// once the layer offsets + rotates it.
	ctx.beginPath();
	ctx.moveTo(c, 3);
	ctx.lineTo(c + 5, 9.5);
	ctx.lineTo(c, 7.3);
	ctx.lineTo(c - 5, 9.5);
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.lineWidth = 1.6;
	ctx.strokeStyle = halo;
	ctx.stroke();
	return ctx.getImageData(0, 0, px, px);
}

/** Icon id the vehicle layer references per feature (see toVehicleFeatures). */
export const bodyIconId = (mode: 'status' | 'occupancy', code: string): string =>
	`veh-${mode === 'status' ? 's' : 'o'}-${code}`;

/**
 * Bake + register every vehicle icon: the default orange bus, plus one painted
 * bus per status code and per occupancy code (the "repaint" palette the filter
 * swaps in), the single directional chevron, and the stop map-pin. Idempotent
 * (re-removes before adding, so it re-bakes on a theme change). Browser-only.
 */
export function bakeVehicleSprites(map: MapLibreMap): void {
	const busHalo = resolveColor(BUS_HALO_TOKEN, BUS_HALO_FALLBACK);
	const add = (id: string, img: ImageData) => {
		if (map.hasImage(id)) map.removeImage(id);
		map.addImage(id, img, { pixelRatio: RATIO });
	};
	// One bus glyph per colour; the heading chevron is a SEPARATE rotated layer.
	const addBus = (id: string, fill: string) => add(id, busImage(fill, busHalo));

	for (const code of STATUS_CODES as readonly StatusCode[]) {
		addBus(bodyIconId('status', code), resolveColor(statusVar(code), '#8a8a8a'));
	}

	for (const code of OCCUPANCY_CODES as readonly OccupancyCode[]) {
		addBus(bodyIconId('occupancy', code), resolveColor(occupancyVar(code), '#7a5fb0'));
	}

	// Default (no filter) — yesid brand orange (--primary).
	addBus(BUS_ICON, resolveColor(BUS_FILL_TOKEN, BUS_FILL_FALLBACK));

	// The directional chevron — ONE neutral sprite, rotated per-feature by the layer.
	add(
		HEADING_ICON,
		chevronImage(
			resolveColor(HEADING_FILL_TOKEN, HEADING_FILL_FALLBACK),
			resolveColor(HEADING_HALO_TOKEN, HEADING_HALO_FALLBACK),
		),
	);

	// Stops are map-pins (reddish-orange on light, amber on dark), with the same
	// theme surface outline as buses.
	const stopFill = resolveColor(STOP_FILL_TOKEN, STOP_FILL_FALLBACK);
	const stopHalo = resolveColor(STOP_HALO_TOKEN, STOP_HALO_FALLBACK);
	add(STOP_ICON, stopPinImage(stopFill, stopHalo));
}

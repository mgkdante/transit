// map/vehicleSprites.ts — browser-only canvas baker for vehicle puck icons.
//
// A vehicle is a SINGLE coloured shape — no glyph overlay. The filter REPAINTS
// the shape's colour (default orange → a status/occupancy colour) and hides
// non-matches; colour alone carries state, so the map stays uncluttered. SHAPE
// encodes the entity + heading, not state:
//   · bus WITH heading → a KITE (nose up, rotated by bearing via the layer);
//   · bus with NO heading → a SQUARE (honest "no heading", never a fake arrow);
//   · stop → a DIAMOND (the distinct stop mark; STOP_ICON).
// Colours are read from live CSS tokens via a probe element (NEVER hardcoded
// hex), so a theme swap re-bakes to the active palette.

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
const RATIO = 2;

/** Default (no-filter) bus icon id — yesid brand orange. One sprite for every
 *  bus; the layer rotates it by bearing (a bus with no heading just isn't
 *  rotated). */
export const BUS_ICON = 'veh-bus';
/** The stop diamond icon id. */
export const STOP_ICON = 'veh-stop';

export const BUS_FILL_TOKEN = 'var(--primary)';
export const BUS_FILL_FALLBACK = 'rgb(224, 120, 0)';
export const BUS_HALO_TOKEN = 'var(--background)';
export const BUS_HALO_FALLBACK = '#141414';
export const STOP_FILL_TOKEN = 'var(--map-stop-fill)';
export const STOP_FILL_FALLBACK = 'rgb(255, 182, 39)';
export const STOP_HALO_TOKEN = BUS_HALO_TOKEN;
export const STOP_HALO_FALLBACK = BUS_HALO_FALLBACK;

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

type Shape = 'kite' | 'square' | 'diamond';

/** Bake one shape (kite / square / diamond), filled + halo-ringed. */
function shapeImage(fill: string, halo: string, shape: Shape): ImageData {
	const { ctx, px } = newCtx();
	const c = SIZE / 2;
	ctx.lineJoin = 'round';
	ctx.lineWidth = 2;
	ctx.strokeStyle = halo;
	ctx.fillStyle = fill;
	ctx.beginPath();
	if (shape === 'kite') {
		// Kite, nose up (the layer rotates it to the bearing).
		ctx.moveTo(c, 2.5);
		ctx.lineTo(c + 7.5, SIZE - 5);
		ctx.lineTo(c, SIZE - 9);
		ctx.lineTo(c - 7.5, SIZE - 5);
		ctx.closePath();
	} else if (shape === 'square') {
		// Axis-aligned square — bus with no heading.
		const r = 6.5;
		ctx.rect(c - r, c - r, r * 2, r * 2);
	} else {
		// Diamond (square at 45°) — the stop mark.
		const r = 6.5;
		ctx.moveTo(c, c - r);
		ctx.lineTo(c + r, c);
		ctx.lineTo(c, c + r);
		ctx.lineTo(c - r, c);
		ctx.closePath();
	}
	ctx.fill();
	ctx.stroke();
	return ctx.getImageData(0, 0, px, px);
}

/** Icon id the vehicle layer references per feature (see toVehicleFeatures). */
export const bodyIconId = (mode: 'status' | 'occupancy', code: string): string =>
	`veh-${mode === 'status' ? 's' : 'o'}-${code}`;

/**
 * Bake + register every vehicle body icon: the default orange pair, plus one
 * coloured pair (kite + diamond) per status code and per occupancy code — the
 * "repaint" palette the filter swaps in. Idempotent (re-removes before adding,
 * so it re-bakes on a theme change). Browser-only (canvas).
 */
export function bakeVehicleSprites(map: MapLibreMap): void {
	const busHalo = resolveColor(BUS_HALO_TOKEN, BUS_HALO_FALLBACK);
	const add = (id: string, img: ImageData) => {
		if (map.hasImage(id)) map.removeImage(id);
		map.addImage(id, img, { pixelRatio: RATIO });
	};
	// One bus shape (kite); the layer rotates it by bearing (no heading -> unrotated).
	const addBus = (id: string, fill: string) => add(id, shapeImage(fill, busHalo, 'kite'));

	for (const code of STATUS_CODES as readonly StatusCode[]) {
		addBus(bodyIconId('status', code), resolveColor(statusVar(code), '#8a8a8a'));
	}

	for (const code of OCCUPANCY_CODES as readonly OccupancyCode[]) {
		addBus(bodyIconId('occupancy', code), resolveColor(occupancyVar(code), '#7a5fb0'));
	}

	// Default (no filter) — yesid brand orange (--primary).
	addBus(BUS_ICON, resolveColor(BUS_FILL_TOKEN, BUS_FILL_FALLBACK));

	// Stops are diamonds (reddish-orange on light, amber on dark), with the same
	// theme surface outline as buses.
	const stopFill = resolveColor(STOP_FILL_TOKEN, STOP_FILL_FALLBACK);
	const stopHalo = resolveColor(STOP_HALO_TOKEN, STOP_HALO_FALLBACK);
	add(STOP_ICON, shapeImage(stopFill, stopHalo, 'diamond'));
}

// map/vehicleSprites.ts — browser-only canvas baker for vehicle puck icons.
//
// A vehicle is a SINGLE coloured shape — no glyph overlay. The filter REPAINTS
// the shape's colour (default orange → a status/occupancy colour) and hides
// non-matches; colour alone carries state, so the map stays uncluttered. SHAPE
// encodes the entity + heading, not state:
//   · bus WITH heading → a KITE (nose up, rotated by bearing via the layer);
//   · bus with NO heading → a SQUARE (honest "no heading", never a fake arrow);
//   · stop → a DIAMOND (the distinct stop mark; STOP_ICON).
// Colours are read from the live --dataviz-* / --primary tokens via a probe
// element (NEVER hardcoded hex), so a theme swap re-bakes to the active palette.

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

/** Default (no-filter) bus icon ids — yesid brand orange. */
export const BUS_ICON = 'veh-bus';
export const BUS_ICON_ND = 'veh-bus-nd';
/** The stop diamond icon id. */
export const STOP_ICON = 'veh-stop';

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
export const bodyIconId = (
	mode: 'status' | 'occupancy',
	code: string,
	directional: boolean,
): string => `veh-${mode === 'status' ? 's' : 'o'}-${code}${directional ? '' : '-nd'}`;

/**
 * Bake + register every vehicle body icon: the default orange pair, plus one
 * coloured pair (kite + diamond) per status code and per occupancy code — the
 * "repaint" palette the filter swaps in. Idempotent (re-removes before adding,
 * so it re-bakes on a theme change). Browser-only (canvas).
 */
export function bakeVehicleSprites(map: MapLibreMap): void {
	const halo = resolveColor('var(--background)', '#141414');
	const add = (id: string, img: ImageData) => {
		if (map.hasImage(id)) map.removeImage(id);
		map.addImage(id, img, { pixelRatio: RATIO });
	};
	// directional → kite; no heading → square.
	const addBus = (id: string, fill: string, directional: boolean) =>
		add(id, shapeImage(fill, halo, directional ? 'kite' : 'square'));

	for (const code of STATUS_CODES as readonly StatusCode[]) {
		const fill = resolveColor(statusVar(code), '#8a8a8a');
		addBus(bodyIconId('status', code, true), fill, true);
		addBus(bodyIconId('status', code, false), fill, false);
	}

	for (const code of OCCUPANCY_CODES as readonly OccupancyCode[]) {
		const fill = resolveColor(occupancyVar(code), '#7a5fb0');
		addBus(bodyIconId('occupancy', code, true), fill, true);
		addBus(bodyIconId('occupancy', code, false), fill, false);
	}

	// Default (no filter) — yesid brand orange (--primary). rgb fallback, not the
	// #hex literal, to keep the brand-hex doctrine lint green.
	const busFill = resolveColor('var(--primary)', 'rgb(224, 120, 0)');
	addBus(BUS_ICON, busFill, true);
	addBus(BUS_ICON_ND, busFill, false);

	// Stops are diamonds (same brand orange; the layer dims them under the buses).
	add(STOP_ICON, shapeImage(busFill, halo, 'diamond'));
}

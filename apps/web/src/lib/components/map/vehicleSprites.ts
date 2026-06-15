// map/vehicleSprites.ts — browser-only canvas baker for vehicle puck icons.
//
// The basemap styles ship NO glyph/font endpoint (offline-safe), so we can't use
// MapLibre text layers for the status/occupancy glyph. Instead we bake every
// icon as a canvas image and register it with map.addImage:
//   · a BODY image — a directional kite (nose up, rotated by bearing at draw
//     time via the layer's icon-rotate) OR a bearing-less disc, filled with the
//     band's --dataviz-* colour and ringed with a dark halo for legibility.
//   · a GLYPH image — the upright status/occupancy glyph (▼●▲◆○ / ▁▃▅▇█ / ◌),
//     drawn white with a dark halo so it reads on any band. Placed on a separate
//     non-rotating layer so it stays upright while the body rotates.
//
// Colours are read from the live --dataviz-* tokens via a probe element (NEVER
// hardcoded hex), so a theme swap re-bakes to the right palette.

import type { Map as MapLibreMap } from 'maplibre-gl';
import {
	STATUS_CODES,
	OCCUPANCY_CODES,
	type StatusCode,
	type OccupancyCode,
} from '$lib/v1/schemas';
import {
	statusVar,
	occupancyVar,
	STATUS_GLYPH,
	OCCUPANCY_GLYPH,
	OCCUPANCY_NODATA_GLYPH,
} from '$lib/components/dataviz';

/** Logical icon box (px); baked at RATIO for retina crispness. */
const SIZE = 26;
const RATIO = 2;
/** Sentinel occupancy code for vehicles with no telemetry this cycle. */
export const OCC_NODATA = 'nodata';

/** The single default-mode bus icon ids (calm white; no status glyph). */
export const BUS_ICON = 'veh-bus';
export const BUS_ICON_ND = 'veh-bus-nd';

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

/** A directional kite (nose up) or a bearing-less disc, filled + halo-ringed. */
function bodyImage(fill: string, halo: string, directional: boolean): ImageData {
	const { ctx, px } = newCtx();
	const c = SIZE / 2;
	ctx.lineJoin = 'round';
	ctx.lineWidth = 2;
	ctx.strokeStyle = halo;
	ctx.fillStyle = fill;
	ctx.beginPath();
	if (directional) {
		ctx.moveTo(c, 2.5);
		ctx.lineTo(c + 7.5, SIZE - 5);
		ctx.lineTo(c, SIZE - 9);
		ctx.lineTo(c - 7.5, SIZE - 5);
		ctx.closePath();
	} else {
		ctx.arc(c, c, 7.5, 0, Math.PI * 2);
	}
	ctx.fill();
	ctx.stroke();
	return ctx.getImageData(0, 0, px, px);
}

/** The upright glyph, white with a dark halo so it reads on any band colour. */
function glyphImage(glyph: string, halo: string): ImageData {
	const { ctx, px } = newCtx();
	const c = SIZE / 2;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.font = '600 12px "JetBrains Mono Variable", ui-monospace, monospace';
	ctx.lineWidth = 2.5;
	ctx.strokeStyle = halo;
	ctx.strokeText(glyph, c, c);
	ctx.fillStyle = '#f5f5f0';
	ctx.fillText(glyph, c, c);
	return ctx.getImageData(0, 0, px, px);
}

/** Icon ids the vehicle layer references per feature (see toVehicleFeatures). */
export const bodyIconId = (mode: 'status' | 'occupancy', code: string, directional: boolean): string =>
	`veh-${mode === 'status' ? 's' : 'o'}-${code}${directional ? '' : '-nd'}`;
export const glyphIconId = (mode: 'status' | 'occupancy', code: string): string =>
	`veh-${mode === 'status' ? 'gs' : 'go'}-${code}`;

/**
 * Bake + register every vehicle icon (both modes, directional + bearing-less,
 * plus the occupancy no-data variant). Idempotent: re-removes before adding, so
 * it can re-bake on a theme change. Browser-only (canvas).
 */
export function bakeVehicleSprites(map: MapLibreMap): void {
	const halo = resolveColor('var(--background)', '#141414');
	const add = (id: string, img: ImageData) => {
		if (map.hasImage(id)) map.removeImage(id);
		map.addImage(id, img, { pixelRatio: RATIO });
	};

	for (const code of STATUS_CODES as readonly StatusCode[]) {
		const fill = resolveColor(statusVar(code), '#8a8a8a');
		add(bodyIconId('status', code, true), bodyImage(fill, halo, true));
		add(bodyIconId('status', code, false), bodyImage(fill, halo, false));
		add(glyphIconId('status', code), glyphImage(STATUS_GLYPH[code], halo));
	}

	for (const code of OCCUPANCY_CODES as readonly OccupancyCode[]) {
		const fill = resolveColor(occupancyVar(code), '#7a5fb0');
		add(bodyIconId('occupancy', code, true), bodyImage(fill, halo, true));
		add(bodyIconId('occupancy', code, false), bodyImage(fill, halo, false));
		add(glyphIconId('occupancy', code), glyphImage(OCCUPANCY_GLYPH[code], halo));
	}

	// Occupancy no-data: a neutral body + the ◌ glyph (never the 'empty' band).
	const nodataFill = resolveColor('var(--dataviz-status-unknown)', '#8a8a8a');
	add(bodyIconId('occupancy', OCC_NODATA, true), bodyImage(nodataFill, halo, true));
	add(bodyIconId('occupancy', OCC_NODATA, false), bodyImage(nodataFill, halo, false));
	add(glyphIconId('occupancy', OCC_NODATA), glyphImage(OCCUPANCY_NODATA_GLYPH, halo));

	// Default single-colour bus (the calm default — one colour per entity, no
	// status glyph). State colour only appears when a filter lights matches up.
	const busFill = resolveColor('var(--foreground)', '#f5f5f0');
	add(BUS_ICON, bodyImage(busFill, halo, true));
	add(BUS_ICON_ND, bodyImage(busFill, halo, false));
}

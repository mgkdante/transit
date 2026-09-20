// map/vehicleSprites.ts — browser-only canvas baker for vehicle + stop icons.
//
// A vehicle is a single PAINTED BUS pictogram — the filter REPAINTS the bus
// fill (default orange → a status/occupancy colour) and HIDES non-matches. A
// separate neutral vector state badge preserves a shape channel, so colour is
// never the only state signal. The bus glyph is baked UPRIGHT and legible at every bearing:
// heading is rendered by a SEPARATE rotated CHEVRON layer (see vehicleLayer.ts)
// that points the way the bus is going, so the bus-front never reads upside-down.
// SHAPE encodes the entity:
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
} from '$lib/v1/schemas/types';
import {
	STATUS_GLYPH,
	occupancyGlyph,
	occupancyVar,
	statusVar,
} from '$lib/components/dataviz/tokens';

/** Frozen marker geometry: the map layer and non-Chromium receipt runner share this table. */
export const VEHICLE_MARKER_GEOMETRY = Object.freeze({
	box: 26,
	bodyIconSize: Object.freeze({ z11: 0.78, z15: 1.3 }),
	headingOffset: Object.freeze([0, -9] as const),
	stateBadge: Object.freeze({
		offset: Object.freeze([0, 30] as const),
		pairedOffset: Object.freeze([-9, 30] as const),
		scale: 0.6,
	}),
	silentBadge: Object.freeze({
		offset: Object.freeze([0, 30] as const),
		pairedOffset: Object.freeze([9, 30] as const),
		scale: 0.75,
	}),
	chevronAnnulus: Object.freeze({ inner: 12.7, outer: 19.8 }),
	plateMargin: 2.4,
});

/** Logical icon box (px); baked at RATIO for retina crispness. */
const SIZE = VEHICLE_MARKER_GEOMETRY.box;
/** Bake at the device pixel ratio (>=2) so glyphs stay crisp on retina. */
const RATIO =
	typeof window !== 'undefined' ? Math.max(2, Math.ceil(window.devicePixelRatio || 1)) : 2;

/** Default (no-filter) bus icon id — yesid brand orange. ONE sprite for every
 *  bus (no directional variants); the heading chevron is a separate layer. */
export const BUS_ICON = 'veh-bus';
/** The directional chevron icon id — ONE neutral sprite, rotated by the layer. */
export const HEADING_ICON = 'veh-heading';
/** The per-bus "!" not-reporting badge icon id — drawn ABOVE a frozen/stale bus. */
export const SILENT_ICON = 'veh-silent';
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
/** The silent "!" badge disc is a high-contrast foreground dot; the "!" is cut in
 *  the halo colour so it reads on ANY bus colour beneath it. */
export const SILENT_FILL_TOKEN = 'var(--foreground)';
export const SILENT_FILL_FALLBACK = '#f5f5f5';
export const SILENT_HALO_TOKEN = 'var(--background)';
export const SILENT_HALO_FALLBACK = '#141414';

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

function spriteContext(): CanvasRenderingContext2D {
	const px = SIZE * RATIO;
	const cv = document.createElement('canvas');
	cv.width = px;
	cv.height = px;
	const ctx = cv.getContext('2d');
	if (!ctx) throw new Error('[vehicleSprites] 2D canvas context unavailable');
	ctx.scale(RATIO, RATIO);
	return ctx;
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
function busCanvas(fill: string, halo: string): HTMLCanvasElement {
	const ctx = spriteContext();
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

	return ctx.canvas;
}

/**
 * Bake the STOP map-pin pictogram, PAINTED with `fill` and ringed by `halo`,
 * with a halo-cut hole so the pin reads as a stop marker, not a solid teardrop.
 */
function stopPinCanvas(fill: string, halo: string): HTMLCanvasElement {
	const ctx = spriteContext();
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

	return ctx.canvas;
}

/**
 * Bake the directional CHEVRON — a single neutral arrowhead (nose up), PAINTED
 * with `fill` and ringed by `halo`. ONE sprite; the layer rotates it by bearing
 * and floats it just ahead of the bus, so the bus glyph itself stays upright.
 */
function chevronCanvas(fill: string, halo: string): HTMLCanvasElement {
	const ctx = spriteContext();
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
	return ctx.canvas;
}

/**
 * Bake the SILENT "!" badge — a BIG, bold alert mark that FILLS most of its
 * sprite box (it reads at a glance as a real alert flag, not a tiny corner dot).
 * A high-contrast rounded-square badge (`fill`, ringed by a `halo` stroke) holds
 * a FAT rounded vertical bar + a fat dot, both cut in the halo colour, centred so
 * the "!" dominates the glyph. Drawn as a SEPARATE layer ABOVE a frozen/stale bus
 * so a no-longer-reporting vehicle is FLAGGED, not hidden. The flag is per-bus
 * (each bus's own reported_utc age), not the old global silence.
 */
function silentBadgeCanvas(fill: string, halo: string): HTMLCanvasElement {
	const ctx = spriteContext();
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';

	const cx = SIZE / 2;
	const cy = SIZE / 2;

	// Badge background — a rounded square filling most of the box (small margin so
	// the halo ring stays inside the sprite). This is the prominent alert plate the
	// fat "!" sits on, high-contrast against any bus colour beneath it.
	const margin = VEHICLE_MARKER_GEOMETRY.plateMargin;
	const side = SIZE - margin * 2;
	roundedRect(ctx, margin, margin, side, side, side * 0.28);
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.lineWidth = 2;
	ctx.strokeStyle = halo;
	ctx.stroke();

	// "!" — a FAT rounded vertical bar cut in the halo colour, spanning most of the
	// badge height so the glyph dominates. Drawn as a thick round-capped stroke.
	ctx.strokeStyle = halo;
	ctx.lineWidth = SIZE * 0.16;
	ctx.beginPath();
	ctx.moveTo(cx, cy - side * 0.3);
	ctx.lineTo(cx, cy + side * 0.07);
	ctx.stroke();

	// …and a FAT dot beneath the bar.
	ctx.beginPath();
	ctx.arc(cx, cy + side * 0.28, SIZE * 0.085, 0, Math.PI * 2);
	ctx.fillStyle = halo;
	ctx.fill();

	return ctx.canvas;
}

/** Icon id the vehicle layer references per feature (see toVehicleFeatures). */
export const bodyIconId = (mode: 'status' | 'occupancy', code: string): string =>
	`veh-${mode === 'status' ? 's' : 'o'}-${code}`;

/** The compact glyph plate layered above a status/occupancy-painted bus body. */
export const stateBadgeIconId = (mode: 'status' | 'occupancy', code: string): string =>
	`veh-m-${mode === 'status' ? 's' : 'o'}-${code}`;

export type StateBadgeReceipt = Readonly<{
	stateBadges: Readonly<Record<string, number>>;
	stateBadgeImages: Readonly<Record<string, ImageData>>;
	stateGlyphMasks: Readonly<Record<string, number>>;
	stateGlyphMaskImages: Readonly<Record<string, ImageData>>;
}>;

/**
 * Count alpha-painted canvas pixels from an actual baked image (registered badge
 * or glyph-only mask), normalize its DPR, then apply the frozen MapLibre
 * state-badge scale. This stays pure so a non-Chromium runner can consume real
 * ImageData without browser rasterization.
 */
export function countStateBadgePaintedPixels(image: ImageData): number {
	if (image.width !== image.height || image.width % SIZE !== 0) {
		throw new Error('[vehicleSprites] state badge image must be a square 26px DPR multiple');
	}
	const ratio = image.width / SIZE;
	let opaquePixels = 0;
	for (let index = 3; index < image.data.length; index += 4) {
		if (image.data[index] > 0) opaquePixels += 1;
	}
	return Number(
		((opaquePixels / ratio ** 2) * VEHICLE_MARKER_GEOMETRY.stateBadge.scale ** 2).toFixed(6),
	);
}

function drawStateGlyph(
	ctx: CanvasRenderingContext2D,
	glyph: string,
	paint: string,
	holeFill: string | null,
): void {
	const c = SIZE / 2;
	const side = SIZE - VEHICLE_MARKER_GEOMETRY.plateMargin * 2;
	const left = VEHICLE_MARKER_GEOMETRY.plateMargin;
	const top = left;
	ctx.fillStyle = paint;

	if (glyph === STATUS_GLYPH.early) {
		ctx.beginPath();
		ctx.moveTo(c, top + side * 0.72);
		ctx.lineTo(left + side * 0.27, top + side * 0.3);
		ctx.lineTo(left + side * 0.73, top + side * 0.3);
		ctx.closePath();
		ctx.fill();
		return;
	}
	if (glyph === STATUS_GLYPH.on_time) {
		ctx.beginPath();
		ctx.arc(c, c, side * 0.18, 0, Math.PI * 2);
		ctx.fill();
		return;
	}
	if (glyph === STATUS_GLYPH.late) {
		ctx.beginPath();
		ctx.moveTo(c, top + side * 0.28);
		ctx.lineTo(left + side * 0.27, top + side * 0.7);
		ctx.lineTo(left + side * 0.73, top + side * 0.7);
		ctx.closePath();
		ctx.fill();
		return;
	}
	if (glyph === STATUS_GLYPH.severe) {
		ctx.beginPath();
		ctx.moveTo(c, top + side * 0.23);
		ctx.lineTo(left + side * 0.77, c);
		ctx.lineTo(c, top + side * 0.77);
		ctx.lineTo(left + side * 0.23, c);
		ctx.closePath();
		ctx.fill();
		return;
	}
	if (glyph === STATUS_GLYPH.unknown) {
		ctx.beginPath();
		ctx.arc(c, c, side * 0.22, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(c, c, side * 0.11, 0, Math.PI * 2);
		if (holeFill === null) {
			ctx.save();
			ctx.globalCompositeOperation = 'destination-out';
			ctx.fill();
			ctx.restore();
		} else {
			ctx.fillStyle = holeFill;
			ctx.fill();
		}
		return;
	}
	if (glyph === occupancyGlyph('full')) {
		const inset = 2.8;
		const near = Math.round((left + inset) * 10) / 10;
		const far = Math.round((left + side - inset) * 10) / 10;
		ctx.strokeStyle = paint;
		ctx.lineWidth = 2.4;
		ctx.beginPath();
		ctx.moveTo(near, near);
		ctx.lineTo(far, near);
		ctx.lineTo(far, far);
		ctx.lineTo(near, far);
		ctx.closePath();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(near, near);
		ctx.lineTo(far, far);
		ctx.moveTo(far, near);
		ctx.lineTo(near, far);
		ctx.stroke();
		return;
	}

	let occupancyHeight: number;
	if (glyph === occupancyGlyph('empty')) occupancyHeight = 0.12;
	else if (glyph === occupancyGlyph('many_seats')) occupancyHeight = 0.28;
	else if (glyph === occupancyGlyph('few_seats')) occupancyHeight = 0.45;
	else if (glyph === occupancyGlyph('standing')) occupancyHeight = 0.62;
	else throw new Error(`[vehicleSprites] unrecognized state glyph: ${glyph}`);
	const h = side * occupancyHeight;
	roundedRect(ctx, left + side * 0.2, top + side * 0.78 - h, side * 0.6, h, Math.min(1.2, h / 2));
	ctx.fill();
}

/** Bake a compact halo-cut state mark using only vector paths, never font glyphs. */
function stateBadgeCanvas(glyph: string, fill: string, halo: string): HTMLCanvasElement {
	const ctx = spriteContext();
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';

	const margin = VEHICLE_MARKER_GEOMETRY.plateMargin;
	const side = SIZE - margin * 2;
	roundedRect(ctx, margin, margin, side, side, side * 0.28);
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.lineWidth = 2;
	ctx.strokeStyle = halo;
	ctx.stroke();
	drawStateGlyph(ctx, glyph, halo, fill);

	return ctx.canvas;
}

/** Bake only the shared vector glyph path on transparency for pixel-threshold receipts. */
function stateGlyphMaskCanvas(glyph: string, fill: string): HTMLCanvasElement {
	const ctx = spriteContext();
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	drawStateGlyph(ctx, glyph, fill, null);
	return ctx.canvas;
}

/**
 * Bake + register every vehicle icon: the default orange bus, plus one painted
 * bus per status code and per occupancy code (the "repaint" palette the filter
 * swaps in), the single directional chevron, the per-bus silent "!" badge, and
 * the stop map-pin. Idempotent (re-removes before adding, so it re-bakes on a
 * theme change). Browser-only. Returns distinct alpha-derived registered-badge
 * and glyph-mask receipts; threshold runners derive provenance from the exact
 * `stateGlyphMaskImages` whose counts are recorded in `stateGlyphMasks`.
 */
export function bakeVehicleSprites(map: MapLibreMap): StateBadgeReceipt {
	const background = resolveColor(BUS_HALO_TOKEN, BUS_HALO_FALLBACK);
	const foreground = resolveColor(SILENT_FILL_TOKEN, SILENT_FILL_FALLBACK);
	const canvases: HTMLCanvasElement[] = [];
	const sprites: { id: string; index: number }[] = [];
	const badges: { id: string; image: number; mask: number }[] = [];
	const queue = (canvas: HTMLCanvasElement): number => canvases.push(canvas) - 1;
	const add = (id: string, canvas: HTMLCanvasElement): number => {
		const index = queue(canvas);
		sprites.push({ id, index });
		return index;
	};

	for (const code of STATUS_CODES as readonly StatusCode[]) {
		add(
			bodyIconId('status', code),
			busCanvas(resolveColor(statusVar(code), '#8a8a8a'), background),
		);
	}
	for (const code of OCCUPANCY_CODES as readonly OccupancyCode[]) {
		add(
			bodyIconId('occupancy', code),
			busCanvas(resolveColor(occupancyVar(code), '#7a5fb0'), background),
		);
	}
	for (const code of STATUS_CODES as readonly StatusCode[]) {
		const id = stateBadgeIconId('status', code);
		const glyph = STATUS_GLYPH[code];
		badges.push({
			id,
			image: add(id, stateBadgeCanvas(glyph, foreground, background)),
			mask: queue(stateGlyphMaskCanvas(glyph, background)),
		});
	}
	for (const code of OCCUPANCY_CODES as readonly OccupancyCode[]) {
		const id = stateBadgeIconId('occupancy', code);
		const glyph = occupancyGlyph(code);
		badges.push({
			id,
			image: add(id, stateBadgeCanvas(glyph, foreground, background)),
			mask: queue(stateGlyphMaskCanvas(glyph, background)),
		});
	}
	add(BUS_ICON, busCanvas(resolveColor(BUS_FILL_TOKEN, BUS_FILL_FALLBACK), background));
	add(HEADING_ICON, chevronCanvas(foreground, background));
	add(SILENT_ICON, silentBadgeCanvas(foreground, background));
	add(STOP_ICON, stopPinCanvas(resolveColor(STOP_FILL_TOKEN, STOP_FILL_FALLBACK), background));

	const images = readSpriteCanvases(canvases);
	const stateBadges: Record<string, number> = {};
	const stateBadgeImages: Record<string, ImageData> = {};
	const stateGlyphMasks: Record<string, number> = {};
	const stateGlyphMaskImages: Record<string, ImageData> = {};
	for (const { id, image, mask } of badges) {
		stateBadgeImages[id] = images[image];
		stateGlyphMaskImages[id] = images[mask];
		stateBadges[id] = countStateBadgePaintedPixels(images[image]);
		stateGlyphMasks[id] = countStateBadgePaintedPixels(images[mask]);
	}
	for (const { id, index } of sprites) {
		if (map.hasImage(id)) map.removeImage(id);
		map.addImage(id, images[index], { pixelRatio: RATIO });
	}
	return Object.freeze({
		stateBadges: Object.freeze(stateBadges),
		stateBadgeImages: Object.freeze(stateBadgeImages),
		stateGlyphMasks: Object.freeze(stateGlyphMasks),
		stateGlyphMaskImages: Object.freeze(stateGlyphMaskImages),
	});
}

/** Keep the original per-sprite rasterization, then read one vertical atlas.
 *  Equal-width sprites occupy contiguous RGBA blocks; every image is complete
 *  before MapLibre installation and the alpha-derived receipts are computed. */
function readSpriteCanvases(canvases: readonly HTMLCanvasElement[]): ImageData[] {
	const px = SIZE * RATIO;
	const atlas = document.createElement('canvas');
	atlas.width = px;
	atlas.height = px * canvases.length;
	const ctx = atlas.getContext('2d');
	if (!ctx) throw new Error('[vehicleSprites] 2D canvas context unavailable');
	canvases.forEach((canvas, index) => ctx.drawImage(canvas, 0, index * px));
	const { data } = ctx.getImageData(0, 0, px, atlas.height);
	const bytes = px * px * 4;
	return canvases.map(
		(_, index) => new ImageData(data.slice(index * bytes, (index + 1) * bytes), px, px),
	);
}

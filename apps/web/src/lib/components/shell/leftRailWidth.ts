// leftRailWidth — the draggable expanded width of the LEFT NAV rail, persisted.
//
// The rail is an absolute OVERLAY (it never takes layout space from the map), so
// its width is a single CSS custom property (`--app-rail-width-expanded`) the
// AppShell row carries. Dragging the rail's right-edge handle writes a live px
// width into that var; we persist the chosen WIDTH as a scalar so the layout
// sticks across reloads. The map canvas never reads this value, so resizing the
// rail can not resize the map.
//
// Thin wrapper over the shared `overlayWidth` factory (the de-dup with the right
// detail panel) — it binds this rail's key + band and re-exports the same named
// constants/functions, so every import site stays untouched.

import { createOverlayWidth } from './overlayWidth';

/** The localStorage key the chosen rail width persists under. */
export const LEFT_RAIL_WIDTH_STORAGE_KEY = 'transit:left-rail-width';

/** Default expanded rail width (px) — matches the 16rem CSS default at 16px root. */
export const DEFAULT_LEFT_RAIL_WIDTH = 256;

/** Floor (px) so the dragged rail can never crush its nav copy. */
export const MIN_LEFT_RAIL_WIDTH = 208;

/** Ceiling (px) so the rail can never swallow the map. */
export const MAX_LEFT_RAIL_WIDTH = 420;

const overlay = createOverlayWidth({
	key: LEFT_RAIL_WIDTH_STORAGE_KEY,
	min: MIN_LEFT_RAIL_WIDTH,
	max: MAX_LEFT_RAIL_WIDTH,
	default: DEFAULT_LEFT_RAIL_WIDTH,
});

/**
 * Clamp a candidate rail width (px) into [MIN, MAX]. A non-finite / degenerate
 * input falls back to the default so a junk stored value can never wedge the rail.
 */
export const clampLeftRailWidth = overlay.clamp;

/** Read the persisted width, falling back to the default on SSR / absent / junk. */
export const readStoredLeftRailWidth = overlay.read;

/** Persist a rail width (browser-only; storage failures are swallowed). */
export const writeStoredLeftRailWidth = overlay.write;

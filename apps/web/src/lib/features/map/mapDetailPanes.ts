// mapDetailPanes — the draggable width of the RIGHT DETAIL panel, persisted.
//
// The detail panel is an absolute OVERLAY anchored flush to the map's right edge
// (it never takes layout space from the map canvas), so its width is a single CSS
// custom property (`--app-right-detail-offset`) the map-hero carries. Dragging the
// panel's left-edge handle writes a live px width into that var; we persist the
// chosen WIDTH as a scalar so the layout sticks across reloads. The map canvas
// never reads this value, so resizing the detail panel can not resize the map.
//
// This is a thin wrapper over the SHARED `overlayWidth` factory, binding its own
// storage key + band and re-exporting the named constants/functions (every import
// site stays untouched). The factory was originally shared with the left-nav rail's
// overlay width; the rail is gone (nav lives in the NavPill), so the detail panel is
// the sole consumer now — the factory stays because it owns the SSR-safe clamp +
// persist that this panel relies on.

import { createOverlayWidth } from '$lib/components/shell/overlayWidth';

/** The localStorage key the chosen detail-panel width persists under. */
export const DETAIL_PANEL_WIDTH_STORAGE_KEY = 'transit:detail-panel-width';

/** Default detail-panel width (px) — matches the RightPanel's 360px design width. */
export const DEFAULT_DETAIL_PANEL_WIDTH = 360;

/** Floor (px) so the dragged panel never cramps its detail content. */
export const MIN_DETAIL_PANEL_WIDTH = 300;

/** Ceiling (px) so the panel can never swallow the map. */
export const MAX_DETAIL_PANEL_WIDTH = 560;

const overlay = createOverlayWidth({
	key: DETAIL_PANEL_WIDTH_STORAGE_KEY,
	min: MIN_DETAIL_PANEL_WIDTH,
	max: MAX_DETAIL_PANEL_WIDTH,
	default: DEFAULT_DETAIL_PANEL_WIDTH,
});

/**
 * Clamp a candidate detail-panel width (px) into [MIN, MAX]. A non-finite /
 * degenerate input falls back to the default so a junk stored value can never
 * wedge the panel.
 */
export const clampDetailPanelWidth = overlay.clamp;

/** Read the persisted width, falling back to the default on SSR / absent / junk. */
export const readStoredDetailPanelWidth = overlay.read;

/** Persist a detail-panel width (browser-only; storage failures are swallowed). */
export const writeStoredDetailPanelWidth = overlay.write;

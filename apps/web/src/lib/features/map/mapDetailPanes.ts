// mapDetailPanes — the draggable width of the RIGHT DETAIL panel, persisted.
//
// The detail panel is an absolute OVERLAY anchored flush to the map's right edge
// (it never takes layout space from the map canvas), so its width is a single CSS
// custom property (`--app-right-detail-offset`) the map-hero carries. Dragging the
// panel's left-edge handle writes a live px width into that var; we persist the
// chosen WIDTH as a scalar so the layout sticks across reloads. The map canvas
// never reads this value, so resizing the detail panel can not resize the map.
//
// This mirrors `leftRailWidth.ts` (the left nav rail's overlay width) exactly —
// one mechanism (absolute overlay + CSS-var width + data-attr collapse + pointer
// drag + localStorage), two instances.
//
// SSR-safe: every localStorage touch is browser-guarded and falls back to the
// default with no JS / no stored choice. A pure clamp helper keeps the bounds
// unit-tested without a DOM.

import { browser } from '$app/environment';

/** The localStorage key the chosen detail-panel width persists under. */
export const DETAIL_PANEL_WIDTH_STORAGE_KEY = 'transit:detail-panel-width';

/** Default detail-panel width (px) — matches the RightPanel's 360px design width. */
export const DEFAULT_DETAIL_PANEL_WIDTH = 360;

/** Floor (px) so the dragged panel never cramps its detail content. */
export const MIN_DETAIL_PANEL_WIDTH = 300;

/** Ceiling (px) so the panel can never swallow the map. */
export const MAX_DETAIL_PANEL_WIDTH = 560;

/**
 * Clamp a candidate detail-panel width (px) into [MIN, MAX]. A non-finite /
 * degenerate input falls back to the default so a junk stored value can never
 * wedge the panel.
 */
export function clampDetailPanelWidth(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_DETAIL_PANEL_WIDTH;
	return Math.min(Math.max(Math.round(width), MIN_DETAIL_PANEL_WIDTH), MAX_DETAIL_PANEL_WIDTH);
}

/** Read the persisted width, falling back to the default on SSR / absent / junk. */
export function readStoredDetailPanelWidth(): number {
	if (!browser) return DEFAULT_DETAIL_PANEL_WIDTH;
	try {
		const raw = localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY);
		if (raw == null) return DEFAULT_DETAIL_PANEL_WIDTH;
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) return DEFAULT_DETAIL_PANEL_WIDTH;
		return clampDetailPanelWidth(parsed);
	} catch {
		// Private mode / disabled storage / malformed value — session-only is fine.
		return DEFAULT_DETAIL_PANEL_WIDTH;
	}
}

/** Persist a detail-panel width (browser-only; storage failures are swallowed). */
export function writeStoredDetailPanelWidth(width: number): void {
	if (!browser) return;
	try {
		localStorage.setItem(DETAIL_PANEL_WIDTH_STORAGE_KEY, String(clampDetailPanelWidth(width)));
	} catch {
		/* private mode / disabled storage — session-only width is fine */
	}
}

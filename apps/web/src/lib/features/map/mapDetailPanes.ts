// mapDetailPanes — the draggable width of the RIGHT DETAIL panel, persisted.
//
// The detail panel is an absolute OVERLAY anchored flush to the map's right edge
// (it never takes layout space from the map canvas), so its width is a single CSS
// custom property (`--app-right-detail-offset`) the map-hero carries. Dragging the
// panel's left-edge handle writes a live px width into that var; we persist the
// chosen WIDTH as a scalar so the layout sticks across reloads. The map canvas
// never reads this value, so resizing the detail panel can not resize the map.
//
// The left-nav rail is gone, so the detail panel is the only remaining consumer of
// this SSR-safe clamp + persistence behavior. Keep it local and keep every public
// export stable.

import { browser } from '$app/environment';

/** The localStorage key the chosen detail-panel width persists under. */
export const DETAIL_PANEL_WIDTH_STORAGE_KEY = 'transit:detail-panel-width';

/** The localStorage key for the entity whose desktop detail rail is collapsed. */
export const DETAIL_RAIL_STORAGE_KEY = 'transit:detail-rail';

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

/**
 * Publish the detail-panel width, the map-chrome clearance, and the document-level
 * rail clearance from one state snapshot. The root channel lets fixed shell chrome
 * react in CSS without a store, measurement loop, or route-level second writer.
 *
 * Svelte runs the returned cleanup before every effect re-run. That transient reset
 * and the next publication share a microtask, so only the new target is painted.
 * Publishes FOUR properties across two elements: the hero-local
 * --app-right-detail-offset (always the persisted width) and --map-detail-offset
 * (effective occlusion), plus the :root --app-effective-rail-offset (the shell
 * channel NavPill stages against) and --app-rail-offset-duration (0ms while
 * `dragging`, absent otherwise — the pill tracks a live drag 1:1).
 * @param open desktop panel visible; @param collapsed icon-rail state;
 * @param dragging live width drag in progress.
 */
export function publishRailOffset(
	element: HTMLElement,
	detailWidthPx: number,
	open: boolean,
	collapsed: boolean,
	dragging: boolean,
): () => void {
	const detailWidth = `${detailWidthPx}px`;
	const effectiveOffset = open ? (collapsed ? '3.7rem' : detailWidth) : '0px';
	const root = element.ownerDocument.documentElement;

	element.style.setProperty('--app-right-detail-offset', detailWidth);
	element.style.setProperty('--map-detail-offset', effectiveOffset);
	root.style.setProperty('--app-effective-rail-offset', effectiveOffset);
	if (dragging) root.style.setProperty('--app-rail-offset-duration', '0ms');
	else root.style.removeProperty('--app-rail-offset-duration');

	return () => {
		root.style.setProperty('--app-effective-rail-offset', '0px');
		root.style.removeProperty('--app-rail-offset-duration');
	};
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
		return DEFAULT_DETAIL_PANEL_WIDTH;
	}
}

/** Persist a detail-panel width (browser-only; storage failures are swallowed). */
export function writeStoredDetailPanelWidth(width: number): void {
	if (!browser) return;
	try {
		Storage.prototype.setItem.call(
			localStorage,
			DETAIL_PANEL_WIDTH_STORAGE_KEY,
			String(clampDetailPanelWidth(width)),
		);
	} catch {
		/* private mode / disabled storage — session-only width is fine */
	}
}

/** Read the surface key whose rail should restore as collapsed. */
export function readStoredDetailRail(): string | null {
	if (!browser) return null;
	try {
		const value = localStorage.getItem(DETAIL_RAIL_STORAGE_KEY);
		return value ? value : null;
	} catch {
		return null;
	}
}

/** Persist a deliberate rail collapse for one selected surface. */
export function writeStoredDetailRail(surfaceKey: string): void {
	if (!browser) return;
	try {
		Storage.prototype.setItem.call(localStorage, DETAIL_RAIL_STORAGE_KEY, surfaceKey);
	} catch {
		/* private mode / disabled storage — session-only collapse is fine */
	}
}

/** Clear a rail collapse when a detail expands, closes, or changes entity. */
export function clearStoredDetailRail(): void {
	if (!browser) return;
	try {
		localStorage.removeItem(DETAIL_RAIL_STORAGE_KEY);
	} catch {
		/* private mode / disabled storage — session-only collapse is fine */
	}
}

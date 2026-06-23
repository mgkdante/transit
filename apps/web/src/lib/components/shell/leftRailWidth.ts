// leftRailWidth — the draggable expanded width of the LEFT NAV rail, persisted.
//
// The rail is an absolute OVERLAY (it never takes layout space from the map), so
// its width is a single CSS custom property (`--app-rail-width-expanded`) the
// AppShell row carries. Dragging the rail's right-edge handle writes a live px
// width into that var; we persist the chosen WIDTH as a scalar (NOT a paneforge
// percent — the rail is an overlay, not a pane) so the layout sticks across
// reloads. The map canvas never reads this value, so resizing the rail can not
// resize the map.
//
// SSR-safe: every localStorage touch is browser-guarded and falls back to the
// default with no JS / no stored choice. A pure clamp helper keeps the bounds
// unit-tested without a DOM.

import { browser } from '$app/environment';

/** The localStorage key the chosen rail width persists under. */
export const LEFT_RAIL_WIDTH_STORAGE_KEY = 'transit:left-rail-width';

/** Default expanded rail width (px) — matches the 16rem CSS default at 16px root. */
export const DEFAULT_LEFT_RAIL_WIDTH = 256;

/** Floor (px) so the dragged rail can never crush its nav copy. */
export const MIN_LEFT_RAIL_WIDTH = 208;

/** Ceiling (px) so the rail can never swallow the map. */
export const MAX_LEFT_RAIL_WIDTH = 420;

/**
 * Clamp a candidate rail width (px) into [MIN, MAX]. A non-finite / degenerate
 * input falls back to the default so a junk stored value can never wedge the rail.
 */
export function clampLeftRailWidth(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_LEFT_RAIL_WIDTH;
	return Math.min(Math.max(Math.round(width), MIN_LEFT_RAIL_WIDTH), MAX_LEFT_RAIL_WIDTH);
}

/** Read the persisted width, falling back to the default on SSR / absent / junk. */
export function readStoredLeftRailWidth(): number {
	if (!browser) return DEFAULT_LEFT_RAIL_WIDTH;
	try {
		const raw = localStorage.getItem(LEFT_RAIL_WIDTH_STORAGE_KEY);
		if (raw == null) return DEFAULT_LEFT_RAIL_WIDTH;
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) return DEFAULT_LEFT_RAIL_WIDTH;
		return clampLeftRailWidth(parsed);
	} catch {
		// Private mode / disabled storage / malformed value — session-only is fine.
		return DEFAULT_LEFT_RAIL_WIDTH;
	}
}

/** Persist a rail width (browser-only; storage failures are swallowed). */
export function writeStoredLeftRailWidth(width: number): void {
	if (!browser) return;
	try {
		localStorage.setItem(LEFT_RAIL_WIDTH_STORAGE_KEY, String(clampLeftRailWidth(width)));
	} catch {
		/* private mode / disabled storage — session-only width is fine */
	}
}

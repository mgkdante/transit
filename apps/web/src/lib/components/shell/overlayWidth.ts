// overlayWidth — the shared draggable-overlay width machinery.
//
// Both the LEFT NAV rail (leftRailWidth.ts) and the RIGHT DETAIL panel
// (features/map/mapDetailPanes.ts) are absolute OVERLAYS whose width is a single
// persisted px scalar written into a CSS custom property (the map canvas never
// reads it, so resizing an overlay can never resize the map). The clamp + the
// SSR-safe localStorage read/write were byte-identical between the two; this
// factory is the ONE implementation, parameterised by storage key + bounds. The
// two call sites become thin wrappers that bind their key/band and re-export the
// same named constants/functions, so every import site stays untouched.
//
// SSR-safe: every localStorage touch is browser-guarded and falls back to the
// default with no JS / no stored choice. The clamp is pure (unit-testable without
// a DOM); a non-finite / degenerate input falls back to the default so a junk
// stored value can never wedge the overlay.

import { browser } from '$app/environment';

export interface OverlayWidthConfig {
	/** The localStorage key the chosen width persists under. */
	key: string;
	/** Floor (px) — the dragged overlay can never go below this. */
	min: number;
	/** Ceiling (px) — the overlay can never swallow the map past this. */
	max: number;
	/** Default width (px) used on SSR / absent / junk stored value. */
	default: number;
}

export interface OverlayWidth {
	/** Clamp a candidate width (px) into [min, max]; non-finite → default. */
	clamp(width: number): number;
	/** Read the persisted width, falling back to the default on SSR / absent / junk. */
	read(): number;
	/** Persist a (clamped) width (browser-only; storage failures are swallowed). */
	write(width: number): void;
}

/**
 * Build the clamp + SSR-safe read/write helpers for one overlay's persisted width.
 * The clamp rounds to an integer px and falls back to `default` for non-finite
 * input; read/write are no-ops server-side (read returns `default`, write skips
 * storage) and swallow storage failures (private mode / disabled storage →
 * session-only width is fine).
 */
export function createOverlayWidth(config: OverlayWidthConfig): OverlayWidth {
	const { key, min, max, default: fallback } = config;

	function clamp(width: number): number {
		if (!Number.isFinite(width)) return fallback;
		return Math.min(Math.max(Math.round(width), min), max);
	}

	function read(): number {
		if (!browser) return fallback;
		try {
			const raw = localStorage.getItem(key);
			if (raw == null) return fallback;
			const parsed = Number(raw);
			if (!Number.isFinite(parsed)) return fallback;
			return clamp(parsed);
		} catch {
			// Private mode / disabled storage / malformed value — session-only is fine.
			return fallback;
		}
	}

	function write(width: number): void {
		if (!browser) return;
		try {
			localStorage.setItem(key, String(clamp(width)));
		} catch {
			/* private mode / disabled storage — session-only width is fine */
		}
	}

	return { clamp, read, write };
}

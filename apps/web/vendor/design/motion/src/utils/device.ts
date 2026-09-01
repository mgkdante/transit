/**
 * Detect touch device via the Pointer Events spec.
 * Uses maxTouchPoints (reliable, not spoofed by jsdom).
 */
export function isTouchDevice(): boolean {
	return typeof window !== 'undefined' && navigator.maxTouchPoints > 0;
}

/**
 * True when the viewport matches `(max-width: ${maxWidthPx}px)`.
 * SSR-safe: returns false when `window` is unavailable.
 *
 * Breakpoints differ deliberately by behavior:
 * - 1023: tablet-and-below layouts use the shorter pinned range.
 * - 767: phone-width pointer effects are disabled.
 * - 767: phone-width viewBox crops replace `window.innerWidth < 768`, which
 *   is equivalent at integer CSS pixel widths.
 */
export function isViewportAtMost(maxWidthPx: number): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches;
}

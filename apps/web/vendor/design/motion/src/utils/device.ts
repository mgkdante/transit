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
 * Consolidates the former inline isMobile checks (slice-28.3 #103/#114).
 * Breakpoints differ deliberately per call site:
 * - HeroBanner pin length: 1023 (tablet-and-below get the short pin)
 * - morphHover disable: 767 (phone-width only)
 * - MetroNetwork viewBox crop: 767 (replaces `window.innerWidth < 768`,
 *   equivalent at integer CSS pixel widths)
 */
export function isViewportAtMost(maxWidthPx: number): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches;
}

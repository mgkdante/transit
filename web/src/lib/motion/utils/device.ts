/**
 * Detect a touch device via the Pointer Events spec (maxTouchPoints — reliable,
 * not spoofed by jsdom/happy-dom). SSR-safe.
 */
export function isTouchDevice(): boolean {
	return typeof window !== 'undefined' && navigator.maxTouchPoints > 0;
}

/**
 * True when the viewport matches `(max-width: ${maxWidthPx}px)`.
 * SSR-safe: returns false when `window` is unavailable.
 */
export function isViewportAtMost(maxWidthPx: number): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches;
}

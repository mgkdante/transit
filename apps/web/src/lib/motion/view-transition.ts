// SPA View Transitions guard — the single decision point for "should this
// SvelteKit client navigation animate via the View Transitions API?".
//
// Wired from the root `+layout.svelte` `onNavigate` hook. The CSS side
// (`@view-transition` + the `::view-transition-*(root)` cross-fade in app.css)
// is the document-level styling; this module owns the SPA-navigation behaviour.
//
// We gate on three conditions, all honoured here so the layout stays a one-liner:
//   - feature-detect `document.startViewTransition` (absent in Firefox/older
//     Safari → fall through to the instant default SvelteKit swap), and
//   - respect `prefers-reduced-motion: reduce` (a cross-fade is "motion" on a
//     data dashboard; reduced-motion users get the instant swap), and
//   - skip same-path query/hash rewrites, which update the current surface and
//     must not place a transient document layer over its controls.
//
// On the happy path we return a Promise that resolves INSIDE
// `startViewTransition`, so the DOM swap (resolve) happens within the
// transition; we then await `navigation.complete` so SvelteKit's async load
// settles before the new snapshot is captured. Mirrors the canonical SvelteKit
// + startViewTransition recipe.

import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';

/** The slice of SvelteKit's `onNavigate` argument this helper needs. */
export interface ViewTransitionNavigation {
	from: { url: URL } | null;
	to: { url: URL } | null;
	complete: Promise<unknown>;
}

/**
 * Decide whether a client navigation should run a View Transition.
 * `false` when the API is unsupported OR the user prefers reduced motion — both
 * cases fall through to SvelteKit's default instant swap.
 */
export function shouldRunViewTransition(): boolean {
	if (typeof document === 'undefined') return false;
	if (typeof document.startViewTransition !== 'function') return false;
	return !isPrefersReducedMotion();
}

/**
 * `onNavigate` handler body. Returns a Promise that drives the DOM swap inside a
 * View Transition when eligible, or `undefined` to let SvelteKit swap instantly.
 */
export function runViewTransition(navigation: ViewTransitionNavigation): Promise<void> | undefined {
	if (!shouldRunViewTransition()) return;
	if (navigation.from && navigation.from.url.pathname === navigation.to?.url.pathname) return;
	return new Promise<void>((resolve) => {
		document.startViewTransition(async () => {
			resolve();
			await navigation.complete;
		});
	});
}

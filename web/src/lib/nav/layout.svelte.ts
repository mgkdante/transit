// Reactive layout store — is the viewport DESKTOP (>= the panel breakpoint)?
//
// This is the single source of truth for the navigation-as-intent split:
// `openSurface` (see ./intent.ts) consults `layout.isDesktop` to decide between a
// route push (mobile, one surface at a time) and an in-memory panel swap (desktop,
// master/detail). Anything that needs to branch its rendering on form factor reads
// the SAME store, so route resolution and layout stay in lockstep.
//
// SSR-safe by construction (mirrors $lib/motion/reduced-motion):
//   - No `window` access at module top beyond a guarded read; the server has no
//     `matchMedia`, so the initial value is `false` (mobile-first — the safe SSR
//     default, since a panelled desktop layout degrades cleanly to a single
//     route surface).
//   - The live matchMedia subscription is wired LAZILY the first time the value
//     is observed in a browser context, and exactly once (idempotent).
//
// WHY a getter (not a bare exported `$state`): `$state` reassignments only
// propagate reactively when read through a live accessor. Exposing `isDesktop` as
// a getter keeps `.svelte`/`.svelte.ts` consumers reactive; plain-TS callers get
// a correct one-time snapshot.

/** The desktop breakpoint — at/above this width we render panels, not pages. */
const QUERY = '(min-width: 1024px)';

// SSR-safe initial value — no `window`/`matchMedia` on the server. Default to
// mobile (`false`) so SSR emits the route-push layout, which is the universal
// fallback; the client re-syncs to the real viewport on first read.
let desktop = $state(typeof window !== 'undefined' && window.matchMedia(QUERY).matches);

// Idempotent client-side subscription: set up the matchMedia listener exactly
// once, the first time `isDesktop` is observed in a browser context.
let subscribed = false;

function ensureSubscribed(): void {
	if (subscribed || typeof window === 'undefined') return;
	subscribed = true;
	const mql = window.matchMedia(QUERY);
	// Re-sync once in case the viewport changed between module init and first read.
	desktop = mql.matches;
	mql.addEventListener('change', (e: MediaQueryListEvent) => {
		desktop = e.matches;
	});
}

/**
 * Reactive layout snapshot. `isDesktop` is `true` at/above the 1024px panel
 * breakpoint and `false` below it (and during SSR). Read it inside a reactive
 * context (`.svelte` / `$derived`) to stay live across viewport changes.
 */
export const layout = {
	/** True when the viewport is at/above the desktop panel breakpoint. */
	get isDesktop(): boolean {
		ensureSubscribed();
		return desktop;
	},
};

/**
 * Synchronous, non-reactive snapshot for plain-TS callers (e.g. the one-shot
 * route-vs-panel decision inside `openSurface`). SSR-safe: returns `false`
 * (mobile) without a `window`.
 */
export function isDesktopViewport(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia(QUERY).matches;
}

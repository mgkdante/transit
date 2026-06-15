// Reactive `prefers-reduced-motion` store, Svelte 5 runes edition.
//
// Reads the OS-level "prefers-reduced-motion: reduce" setting and exposes it as
// a reactive value. Motion is opt-out, not opt-in, so the default is `false`
// (animations enabled). During SSR there is no `window`, so the initial value
// is `false` and the live subscription is set up lazily on the client.
//
// WHY a getter (not a bare exported `$state`):
//   - `$state` reassignments only propagate reactively when read through a live
//     accessor, so we expose `prefersReducedMotion` as a getter that reads the
//     rune. Consumers in `.svelte`/`.svelte.ts` modules stay reactive; plain TS
//     callers get a correct one-time snapshot.

const QUERY = '(prefers-reduced-motion: reduce)';

// SSR-safe initial value — no `window` on the server, default to allowing motion.
let reduced = $state(typeof window !== 'undefined' && window.matchMedia(QUERY).matches);

// Idempotent client-side subscription: set up the matchMedia listener exactly
// once, the first time the value is observed in a browser context.
let subscribed = false;

function ensureSubscribed(): void {
	if (subscribed || typeof window === 'undefined') return;
	subscribed = true;
	const mql = window.matchMedia(QUERY);
	// Sync once in case the value changed between module init and first read.
	reduced = mql.matches;
	mql.addEventListener('change', (e: MediaQueryListEvent) => {
		reduced = e.matches;
	});
}

/**
 * Reactive snapshot of the OS `prefers-reduced-motion: reduce` preference.
 * `false` during SSR and when the user has not requested reduced motion.
 */
export const prefersReducedMotion = {
	get current(): boolean {
		ensureSubscribed();
		return reduced;
	},
};

/**
 * Synchronous, non-reactive snapshot for plain-TS callers (e.g. one-shot
 * decisions inside actions). SSR-safe: returns `false` without a `window`.
 */
export function isPrefersReducedMotion(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia(QUERY).matches;
}

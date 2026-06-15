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
//   - The matchMedia subscription is wired EAGERLY at module load (browser-only),
//     NOT lazily inside the getter: `.current` is read inside `$derived`/template
//     expressions (e.g. ChartTooltip's reduced-motion fade gate), and mutating
//     `$state` during a derived read throws `state_unsafe_mutation`. So the getter
//     stays a PURE read; writes happen only from the initializer + the `change`
//     event callback (which fires outside any reactive read).

const QUERY = '(prefers-reduced-motion: reduce)';

// SSR-safe initial value — no `window` on the server, default to allowing motion.
let reduced = $state(typeof window !== 'undefined' && window.matchMedia(QUERY).matches);

// Live subscription, wired once at module load in the browser (never on the
// server). The `change` callback fires outside any reactive read, so mutating
// `reduced` here is safe; the getter never writes.
if (typeof window !== 'undefined') {
	window.matchMedia(QUERY).addEventListener('change', (e: MediaQueryListEvent) => {
		reduced = e.matches;
	});
}

/**
 * Reactive snapshot of the OS `prefers-reduced-motion: reduce` preference.
 * `false` during SSR and when the user has not requested reduced motion.
 */
export const prefersReducedMotion = {
	get current(): boolean {
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

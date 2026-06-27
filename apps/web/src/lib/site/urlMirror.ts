// urlMirror — best-effort mirror of a single search param to the URL, for shareable / deep-linkable
// view state (which tab, which grain). PURE side-channel: the URL is a HINT, never a data source.
//
//   - replaceState (NOT pushState) so toggling a view never spams the history stack.
//   - idempotent: a no-op when the param already matches (so an effect that reads page.url + the
//     value can call this every run without looping).
//   - resilient: replaceState throws before the SvelteKit router is initialized (SSR, early
//     hydration, unit tests) — there is nothing to sync then, so we swallow it. The mirror is
//     non-critical; the seed-from-URL on load is what restores a deep-linked view.
//   - default-omitting is the CALLER's job (pass `null` to drop the param for a clean canonical URL).

import { page } from '$app/state';
import { replaceState } from '$app/navigation';

export function mirrorSearchParam(key: string, value: string | null): void {
	if (typeof window === 'undefined') return; // SSR: no URL to mirror
	if (page.url.searchParams.get(key) === value) return; // already in sync — no write, no loop
	const url = new URL(page.url);
	if (value === null) url.searchParams.delete(key);
	else url.searchParams.set(key, value);
	try {
		replaceState(url, page.state);
	} catch {
		// router not ready (SSR / pre-hydration / isolated component test) — the URL hint is
		// best-effort and non-load-bearing, so skip silently.
	}
}

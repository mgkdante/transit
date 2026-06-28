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

/**
 * Mirror SEVERAL params in ONE replaceState. Use this — never N separate mirrorSearchParam calls
 * in the same tick — when a single view change touches multiple params (e.g. grain + from + to):
 * replaceState updates `page.url` ASYNCHRONOUSLY, so back-to-back single writes each clone the
 * STALE url and clobber one another (last write wins, dropping the others). Reading page.url ONCE
 * and writing the full set once is the only race-free option. `null` deletes a key; same
 * resilience contract as the singular form (idempotent no-op when nothing changes; swallows the
 * pre-router throw).
 */
export function mirrorSearchParams(params: Record<string, string | null>): void {
	if (typeof window === 'undefined') return;
	const url = new URL(page.url);
	let changed = false;
	for (const [key, value] of Object.entries(params)) {
		const current = url.searchParams.get(key);
		if (value === null) {
			if (current !== null) {
				url.searchParams.delete(key);
				changed = true;
			}
		} else if (current !== value) {
			url.searchParams.set(key, value);
			changed = true;
		}
	}
	if (!changed) return; // already in sync — no write, no loop
	try {
		replaceState(url, page.state);
	} catch {
		// router not ready (SSR / pre-hydration / isolated component test) — best-effort hint.
	}
}

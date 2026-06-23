// mapUrlSync — pure URL search-string builders for the /map hero.
//
// Every map URL mutation (set/clear the near-me target, clear the one-shot focus
// param) follows the same shape: clone the current search params, mutate them, and
// resolve the goto path (`?<search>` when non-empty, else the bare pathname so the
// query is dropped cleanly). That assembly is pulled out of MapHero so it is a
// plain, testable transform: no goto, no stores, no reactive state. MapHero keeps
// the thin goto() shells (which also own the local near-me state + the nearUrlKey
// bookkeeping) and feeds the current params + pathname in.

import {
	clearNearTargetSearchParams,
	setNearTargetSearchParams,
	type MapNearTarget,
} from '$lib/search/mapNear';
import { clearMapFocusSearchParams } from '$lib/search/mapFocus';

/** Resolve the goto path from mutated params: `?<search>` when non-empty, else the
 *  bare pathname (so an emptied query reduces to the clean path, never a stray `?`). */
function toGotoPath(searchParams: URLSearchParams, pathname: string): string {
	const next = searchParams.toString();
	return next ? `?${next}` : pathname;
}

/**
 * The goto path that WRITES a chosen near-me target into the URL (preserving every
 * other param). Clones `current` so the live page params are never mutated.
 */
export function buildNearTargetSearch(
	current: URLSearchParams,
	pathname: string,
	target: MapNearTarget,
): string {
	const nextSearchParams = new URLSearchParams(current);
	setNearTargetSearchParams(nextSearchParams, target);
	return toGotoPath(nextSearchParams, pathname);
}

/**
 * The goto path that CLEARS the near-me target from the URL (the address pin),
 * leaving every other param — crucially the URL-backed map filters — untouched.
 */
export function clearNearTargetSearch(current: URLSearchParams, pathname: string): string {
	const nextSearchParams = new URLSearchParams(current);
	clearNearTargetSearchParams(nextSearchParams);
	return toGotoPath(nextSearchParams, pathname);
}

/**
 * The goto path that strips the one-shot `focus` param after the camera has acted
 * on it (so the zoom fires exactly once), preserving every other param.
 */
export function buildFocusClearSearch(current: URLSearchParams, pathname: string): string {
	const nextSearchParams = new URLSearchParams(current);
	clearMapFocusSearchParams(nextSearchParams);
	return toGotoPath(nextSearchParams, pathname);
}

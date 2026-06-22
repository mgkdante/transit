// $lib/v1/data-state — the one reason-typed state a surface resolves to.
//
// THE no-data spine (Chart Doctrine §4). A surface's load is never just
// "data or not" — it's one of: ok / loading / a reason-typed empty / a filter
// returned nothing (no_results) / error. Modeling it as ONE discriminated union
// lets the boundary and every surface branch on `kind` instead of re-deriving the
// same booleans, and guarantees an absence is rendered as an honest, reason-typed
// message — never a bare "·", a fabricated 0, or a blank box.
//
// The empty `reason` reuses the canonical serviceWindow.AbsenceReason (the web's
// single reason brain: closed / overnight / before-open / metro-no-realtime /
// scheduled-silent / last-seen) rather than inventing a parallel vocabulary;
// null = a generic honest empty. EdgeState already renders every one of these.
//
// SSR-safe: pure types + a pure resolver, no DOM.

import type { Resource } from './resource.svelte';
import type { AbsenceReason } from '$lib/site/serviceWindow';

export type { AbsenceReason };

/** The discriminated load state a surface (or the boundary) branches on. */
export type DataState<T> =
	| { kind: 'ok'; data: NonNullable<T> }
	| { kind: 'loading' }
	| { kind: 'empty'; reason: AbsenceReason | null }
	| { kind: 'no_results' }
	| { kind: 'error'; staleAt?: string };

export interface ResolveOptions<T> {
	/**
	 * True when a LOADED value should be treated as empty (e.g. a zero-length
	 * list). Routes to a reason-typed `empty` instead of `ok`.
	 */
	isEmpty?: (data: NonNullable<T>) => boolean;
	/**
	 * True when a loaded value is empty BECAUSE the user's filter/search excluded
	 * everything (a recoverable `no_results`, distinct from the world having no
	 * data). Checked before {@link ResolveOptions.isEmpty}.
	 */
	isNoResults?: (data: NonNullable<T>) => boolean;
	/** The inferred reason for a genuine empty (serviceWindow.inferAbsenceReason). */
	emptyReason?: AbsenceReason | null;
	/**
	 * ISO timestamp of the last good build, when the resource retained it across a
	 * failed reload — lets the consumer show stale-but-present data with an "as of"
	 * note rather than discarding it. Surfaced on the `error` state.
	 */
	staleAt?: string;
}

/**
 * Resolve a {@link Resource} into a {@link DataState}. Priority mirrors
 * ResourceBoundary: a PRESENT value wins (ok / no_results / empty), else
 * error → loading → empty. A present value is narrowed to `NonNullable<T>` on the
 * `ok` branch, so consumers never null-check the data.
 */
export function asDataState<T>(resource: Resource<T>, opts: ResolveOptions<T> = {}): DataState<T> {
	const value = resource.data;
	if (value != null) {
		const present = value as NonNullable<T>;
		if (opts.isNoResults?.(present)) return { kind: 'no_results' };
		if (opts.isEmpty?.(present)) return { kind: 'empty', reason: opts.emptyReason ?? null };
		return { kind: 'ok', data: present };
	}
	if (resource.error) return { kind: 'error', staleAt: opts.staleAt };
	if (resource.loading || !resource.settled) return { kind: 'loading' };
	return { kind: 'empty', reason: opts.emptyReason ?? null };
}

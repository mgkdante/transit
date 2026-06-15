// $lib/filters/state — the canonical FilterState shape + pure, immutable helpers.
//
// FilterState is the single source of truth for every cross-surface filter the
// citizen app understands: the three free-text id sets (routes / stops / trips),
// the two enum chip families (status / occupancy), the time grain, and the time
// window. It is intentionally plain data — no methods, no runes — so it can be
// serialized to the URL (see ./url), snapshotted across a locale switch, and
// hydrated SSR-side without touching `window`.
//
// SSR-safe: this module is pure data + pure functions; it never touches the DOM,
// `window`, or `localStorage`.

import type { StatusCode, OccupancyCode, Grain } from '$lib/v1/schemas';
import { STATUS_CODES, OCCUPANCY_CODES, GRAINS } from '$lib/v1/schemas';

/**
 * The complete, serializable filter state shared across every surface.
 *
 * The three id collections are `Set`s so membership toggles are O(1) and order
 * is irrelevant; `toSearchParams` sorts them for a stable URL. The two enum
 * families and the time levers are optional — absent means "no filter applied"
 * and is omitted from the URL entirely.
 */
export interface FilterState {
	/** Selected route ids (e.g. STM line numbers). */
	routes: Set<string>;
	/** Selected stop ids. */
	stops: Set<string>;
	/** Selected trip ids. */
	trips: Set<string>;
	/** On-time status chips; absent = no status filter. */
	status?: StatusCode[];
	/** Occupancy/crowding chips; absent = no occupancy filter. */
	occupancy?: OccupancyCode[];
	/** Active time grain; absent = surface default. */
	grain?: Grain;
	/** Time window token (opaque to this layer); absent = surface default. */
	window?: string;
}

// ---------------------------------------------------------------------------
// Enum allow-lists — the runtime guards for dropping invalid URL/query values.
// Re-exported from the SINGLE SOURCE ($lib/v1/schemas, where they are derived
// from the zod enums via `.options`). Re-exporting keeps the public
// `$lib/filters` surface stable while avoiding a second copy of the tuples (DRY).
// ---------------------------------------------------------------------------

export { STATUS_CODES, OCCUPANCY_CODES, GRAINS };

const STATUS_SET: ReadonlySet<string> = new Set(STATUS_CODES);
const OCCUPANCY_SET: ReadonlySet<string> = new Set(OCCUPANCY_CODES);
const GRAIN_SET: ReadonlySet<string> = new Set(GRAINS);

/** True when `v` is a valid {@link StatusCode}. */
export function isStatusCode(v: string): v is StatusCode {
	return STATUS_SET.has(v);
}

/** True when `v` is a valid {@link OccupancyCode}. */
export function isOccupancyCode(v: string): v is OccupancyCode {
	return OCCUPANCY_SET.has(v);
}

/** True when `v` is a valid {@link Grain}. */
export function isGrain(v: string): v is Grain {
	return GRAIN_SET.has(v);
}

/**
 * Coerce an arbitrary string list to a deduped {@link StatusCode}[], DROPPING
 * any value that is not a valid status. Returns `undefined` when nothing valid
 * remains so the field stays absent from state (and thus the URL).
 */
export function normalizeStatus(values: readonly string[]): StatusCode[] | undefined {
	const out: StatusCode[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const v = raw.trim();
		if (isStatusCode(v) && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out.length > 0 ? out : undefined;
}

/**
 * Coerce an arbitrary string list to a deduped {@link OccupancyCode}[], dropping
 * invalid values. Returns `undefined` when nothing valid remains.
 */
export function normalizeOccupancy(values: readonly string[]): OccupancyCode[] | undefined {
	const out: OccupancyCode[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const v = raw.trim();
		if (isOccupancyCode(v) && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out.length > 0 ? out : undefined;
}

/** A pristine, empty FilterState. Fresh `Set`s every call — never share refs. */
export function emptyFilterState(): FilterState {
	return {
		routes: new Set<string>(),
		stops: new Set<string>(),
		trips: new Set<string>(),
	};
}

/**
 * Deep, value-equal clone of a FilterState. The three `Set`s are copied (never
 * aliased) and the optional arrays are sliced, so a mutation of the clone can
 * never reach back into the source. Used by the store and snapshot/restore.
 */
export function cloneFilterState(s: FilterState): FilterState {
	return {
		routes: new Set(s.routes),
		stops: new Set(s.stops),
		trips: new Set(s.trips),
		...(s.status ? { status: s.status.slice() } : {}),
		...(s.occupancy ? { occupancy: s.occupancy.slice() } : {}),
		...(s.grain !== undefined ? { grain: s.grain } : {}),
		...(s.window !== undefined ? { window: s.window } : {}),
	};
}

/** The three id-set fields, named for the set helpers below. */
export type IdSetKey = 'routes' | 'stops' | 'trips';

/**
 * Return a NEW FilterState with `value` added to the named id set. Empty/blank
 * values are ignored (returns an equivalent fresh clone). Immutable: the input
 * is never mutated.
 */
export function addToSet(s: FilterState, key: IdSetKey, value: string): FilterState {
	const v = value.trim();
	const next = cloneFilterState(s);
	if (v) next[key].add(v);
	return next;
}

/**
 * Return a NEW FilterState with `value` removed from the named id set.
 * Immutable: the input is never mutated.
 */
export function removeFromSet(s: FilterState, key: IdSetKey, value: string): FilterState {
	const next = cloneFilterState(s);
	next[key].delete(value.trim());
	return next;
}

/**
 * Return a fresh, empty FilterState. `clear` is the canonical "reset all
 * filters" operation; it intentionally ignores its argument so callers can use
 * it both standalone and as a state transformer.
 */
export function clear(_s?: FilterState): FilterState {
	return emptyFilterState();
}

/** True when no filter of any kind is applied (every field empty/absent). */
export function isEmptyFilterState(s: FilterState): boolean {
	return (
		s.routes.size === 0 &&
		s.stops.size === 0 &&
		s.trips.size === 0 &&
		(s.status === undefined || s.status.length === 0) &&
		(s.occupancy === undefined || s.occupancy.length === 0) &&
		s.grain === undefined &&
		(s.window === undefined || s.window === '')
	);
}

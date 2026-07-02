// $lib/filters/state — the canonical FilterState shape + pure, immutable helpers.
//
// FilterState is the single source of truth for every cross-surface filter the
// citizen app understands: the free-text id sets (routes / stops / trips / vehicles),
// the two enum chip families (status / occupancy), the entity/shape family, the
// time grain, and the time window. It is intentionally plain data — no methods,
// no runes — so it can be serialized to the URL (see ./url), snapshotted across
// a locale switch, and hydrated SSR-side without touching `window`.
//
// SSR-safe: this module is pure data + pure functions; it never touches the DOM,
// `window`, or `localStorage`.

import type { StatusCode, OccupancyCode, Grain } from '$lib/v1/schemas';
import { STATUS_CODES, OCCUPANCY_CODES, GRAINS } from '$lib/v1/schemas';

export const ENTITY_KINDS = ['bus', 'stop'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export const ALERT_ENTITY_KINDS = ['has_alert'] as const;
export type AlertEntityKind = (typeof ALERT_ENTITY_KINDS)[number];

/**
 * A closed, inclusive span of LOCAL calendar dates (America/Montréal service
 * days), each an ISO `YYYY-MM-DD` string with `from <= to`. This is the ONE
 * window shape the whole filter layer speaks — a "range" is simply "a window is
 * present" (both bounds set), never a separate {@link Grain} token. A single-day
 * pick is `{ from: d, to: d }`. Half-picked or inverted spans are never stored:
 * they normalize (see {@link normalizeWindow}) or drop to `undefined` so a
 * fabricated span never reaches a shared URL (honest-absence).
 */
export interface DateWindow {
	/** Inclusive span start — ISO `YYYY-MM-DD`, `<= to`. */
	readonly from: string;
	/** Inclusive span end — ISO `YYYY-MM-DD`, `>= from`. */
	readonly to: string;
}

/**
 * SHAPE gate for an ISO calendar date (`YYYY-MM-DD`). Pure regex — DOM-free,
 * SSR-safe. This is the gate used BEFORE availability is known (the codec has no
 * data); availability (is this a real published day?) is validated surface-side
 * via {@link import('./grain').resolveWindow}. Lives here beside {@link DateWindow}
 * so the codec and every surface share one definition.
 */
export function isIsoDate(v: string | null | undefined): v is string {
	return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Build a normalized {@link DateWindow} from two candidate bounds, or
 * `undefined` when a complete, valid span cannot be formed. A half window (one
 * bound missing/malformed) is NO window — the surface then falls to its
 * grain-only default rather than a fabricated span. An inverted pair
 * (`from > to`) is swapped so the stored span always reads `from <= to`.
 */
export function normalizeWindow(
	from: string | null | undefined,
	to: string | null | undefined,
): DateWindow | undefined {
	if (!isIsoDate(from) || !isIsoDate(to)) return undefined;
	return from <= to ? { from, to } : { from: to, to: from };
}

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
	/** Selected vehicle ids (STM bus unit ids). */
	vehicles: Set<string>;
	/** On-time status chips; absent = no status filter. */
	status?: StatusCode[];
	/** Occupancy/crowding chips; absent = no occupancy filter. */
	occupancy?: OccupancyCode[];
	/** Entity/shape chips; absent = no entity filter. */
	entities?: EntityKind[];
	/** Entity families with attached alerts; absent = no alert filter. */
	alerts?: AlertEntityKind[];
	/** Active time grain; absent = surface default. */
	grain?: Grain;
	/**
	 * Active date window — a closed `{from,to}` span of local calendar dates;
	 * absent = surface default (no span narrowing). Presence of a window is the
	 * signal for "range mode" (a surface renders its in-span aggregate); grain
	 * and window are orthogonal and both optional.
	 */
	window?: DateWindow;
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
const ENTITY_SET: ReadonlySet<string> = new Set(ENTITY_KINDS);
const ALERT_ENTITY_SET: ReadonlySet<string> = new Set(ALERT_ENTITY_KINDS);

/** True when `v` is a valid {@link StatusCode}. */
export function isStatusCode(v: string): v is StatusCode {
	return STATUS_SET.has(v);
}

/** True when `v` is a valid {@link OccupancyCode}. */
export function isOccupancyCode(v: string): v is OccupancyCode {
	return OCCUPANCY_SET.has(v);
}

/** True when `v` is a valid {@link EntityKind}. */
export function isEntityKind(v: string): v is EntityKind {
	return ENTITY_SET.has(v);
}

/** True when `v` is a valid alert entity filter. */
export function isAlertEntityKind(v: string): v is AlertEntityKind {
	return ALERT_ENTITY_SET.has(v);
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

/**
 * Coerce arbitrary strings to deduped entity/shape filters. Invalid values drop
 * on input so hand-edited URLs self-heal.
 */
export function normalizeEntities(values: readonly string[]): EntityKind[] | undefined {
	const out: EntityKind[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const v = raw.trim();
		if (isEntityKind(v) && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out.length > 0 ? out : undefined;
}

/** Coerce arbitrary strings to deduped alert entity filters. */
export function normalizeAlerts(values: readonly string[]): AlertEntityKind[] | undefined {
	const out: AlertEntityKind[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const v = raw.trim();
		if (isAlertEntityKind(v) && !seen.has(v)) {
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
		vehicles: new Set<string>(),
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
		vehicles: new Set(s.vehicles ?? []),
		...(s.status ? { status: s.status.slice() } : {}),
		...(s.occupancy ? { occupancy: s.occupancy.slice() } : {}),
		...(s.entities ? { entities: s.entities.slice() } : {}),
		...(s.alerts ? { alerts: s.alerts.slice() } : {}),
		...(s.grain !== undefined ? { grain: s.grain } : {}),
		...(s.window !== undefined ? { window: { from: s.window.from, to: s.window.to } } : {}),
	};
}

/** The three id-set fields, named for the set helpers below. */
export type IdSetKey = 'routes' | 'stops' | 'trips' | 'vehicles';

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
		(s.vehicles?.size ?? 0) === 0 &&
		(s.status === undefined || s.status.length === 0) &&
		(s.occupancy === undefined || s.occupancy.length === 0) &&
		(s.entities === undefined || s.entities.length === 0) &&
		(s.alerts === undefined || s.alerts.length === 0) &&
		s.grain === undefined &&
		s.window === undefined
	);
}

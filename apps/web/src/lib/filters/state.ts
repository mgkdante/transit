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

import type { StatusCode, OccupancyCode, SeverityCode, Grain } from '$lib/v1/schemas';
import { STATUS_CODES, OCCUPANCY_CODES, SEVERITY_CODES, GRAINS } from '$lib/v1/schemas';
import type { DateWindow } from '$lib/v1/history/window';

export type { DateWindow } from '$lib/v1/history/window';

export const ENTITY_KINDS = ['bus', 'stop'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export const ALERT_ENTITY_KINDS = ['has_alert'] as const;
export type AlertEntityKind = (typeof ALERT_ENTITY_KINDS)[number];

/**
 * The alerts-surface "affects" axis (S15) — narrow the alert log to the entities an
 * alert touches: lines (routes non-empty) or stops (stops non-empty). A SINGLE-select
 * axis (the surface renders it as a radiogroup with an implicit "all" = absent), so it
 * is a scalar in the codec (like `?date`), not one of the comma-joined enum families.
 */
export const ALERT_AFFECTS = ['lines', 'stops'] as const;
export type AlertAffects = (typeof ALERT_AFFECTS)[number];

/**
 * SHAPE gate for an ISO calendar date (`YYYY-MM-DD`). Pure regex — DOM-free,
 * SSR-safe. This is the gate used BEFORE availability is known (the codec has no
 * data); availability (is this a real published day?) is validated surface-side
 * via {@link import('./grain').resolveWindow}. The history domain owns
 * {@link DateWindow}; this filter-layer gate keeps the codec and every surface
 * on its canonical date shape.
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
	/**
	 * A SINGLE local calendar date (America/Montréal service day), ISO
	 * `YYYY-MM-DD` — the receipt surface's chosen day (S13). Orthogonal to the
	 * `{from,to}` {@link DateWindow}: `?date` is ONE day (a receipt is inherently
	 * single-date), never a span, so reusing `?from` would fabricate a degenerate
	 * window that leaks into every OTHER surface's window semantics. A dedicated key
	 * keeps the window invariant ("present iff both bounds") clean. Absent = the
	 * surface default (the receipt picks the latest published day). A malformed
	 * value self-heals to absent (dropped on parse via {@link isIsoDate}); no
	 * non-receipt surface reads it.
	 */
	date?: string;
	/**
	 * Worst-N ladder cap (S12) — how many worst-first ranked entries a ladder
	 * surface (hotspots) shows before the honest `shown/total` truncation. One of
	 * the fixed truthful rungs {@link WORST_N_LADDER} (5/10/20/30/50), or the
	 * literal `'all'` for the uncapped view. Absent = the surface default (10). A
	 * DISPLAY axis only — truncating the list never rescales the ranks (the absolute
	 * domain stays stable), so it is orthogonal to grain/window and self-heals off
	 * the URL like the enum families.
	 */
	worstN?: WorstN;
	/**
	 * The alerts-surface "affects" axis (S15) — `lines`|`stops`|absent (= all). A
	 * single-select scalar (a radiogroup, not a multi-chip family); a junk value drops
	 * to absent so a hand-edited `?affects=bogus` self-heals to the unfiltered view.
	 */
	alertAffects?: AlertAffects;
	/**
	 * The alerts-surface severity axis (S15) — one {@link SeverityCode} or absent (=
	 * all). A single-select scalar mirrored to `?severity`; a value outside the closed
	 * enum drops to absent (self-heal). Distinct from the `status`/`occupancy` chip
	 * families — alert severity is its own closed vocabulary.
	 */
	alertSeverity?: SeverityCode;
}

/**
 * The fixed, truthful worst-N rungs a ladder surface (S12 hotspots) offers, plus
 * the uncapped `'all'`. A LADDER-of-truth (never an arbitrary free integer) so a
 * hand-edited `?n=7` self-heals to absent (→ the surface default), and the URL only
 * ever carries a rung the UI actually renders. Ascending; `'all'` last. The top rung
 * is 50 — the per-kind ranked cap the DB serves (WEB2), so no rung can request rows
 * the payload never carries; '100' was trimmed as a dead rung (FIX-3).
 */
export const WORST_N_LADDER = ['5', '10', '20', '30', '50'] as const;
export type WorstNRung = (typeof WORST_N_LADDER)[number];
/** A worst-N cap: a numeric rung or the uncapped 'all'. */
export type WorstN = WorstNRung | 'all';

const WORST_N_SET: ReadonlySet<string> = new Set([...WORST_N_LADDER, 'all']);

/** True when `v` is a valid {@link WorstN} rung (one of the ladder, or 'all'). */
export function isWorstN(v: string): v is WorstN {
	return WORST_N_SET.has(v);
}

/**
 * Coerce an arbitrary string to a {@link WorstN}, or `undefined` when it is not one
 * of the fixed rungs. A junk `?n=7`/`?n=999` drops to absent (the surface default),
 * so the URL never carries a cap the ladder cannot render (honest self-heal).
 */
export function normalizeWorstN(v: string | null | undefined): WorstN | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return isWorstN(t) ? t : undefined;
}

// ---------------------------------------------------------------------------
// Enum allow-lists — the runtime guards for dropping invalid URL/query values.
// Re-exported from the SINGLE SOURCE ($lib/v1/schemas, where they are derived
// from the zod enums via `.options`). Re-exporting keeps the public
// `$lib/filters` surface stable while avoiding a second copy of the tuples (DRY).
// ---------------------------------------------------------------------------

export { STATUS_CODES, OCCUPANCY_CODES, SEVERITY_CODES, GRAINS };

const STATUS_SET: ReadonlySet<string> = new Set(STATUS_CODES);
const OCCUPANCY_SET: ReadonlySet<string> = new Set(OCCUPANCY_CODES);
const SEVERITY_SET: ReadonlySet<string> = new Set(SEVERITY_CODES);
const GRAIN_SET: ReadonlySet<string> = new Set(GRAINS);
const ENTITY_SET: ReadonlySet<string> = new Set(ENTITY_KINDS);
const ALERT_ENTITY_SET: ReadonlySet<string> = new Set(ALERT_ENTITY_KINDS);
const ALERT_AFFECTS_SET: ReadonlySet<string> = new Set(ALERT_AFFECTS);

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

/** True when `v` is a valid {@link AlertAffects} (`lines`|`stops`). */
export function isAlertAffects(v: string): v is AlertAffects {
	return ALERT_AFFECTS_SET.has(v);
}

/** True when `v` is a valid {@link SeverityCode} (`critical`|`high`|`watch`). */
export function isSeverityCode(v: string): v is SeverityCode {
	return SEVERITY_SET.has(v);
}

/**
 * Coerce a single string to a valid {@link AlertAffects}, or `undefined`. A junk value
 * drops to absent so the URL never carries a filter the surface can't render (self-heal).
 */
export function normalizeAlertAffects(v: string | null | undefined): AlertAffects | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return isAlertAffects(t) ? t : undefined;
}

/**
 * Coerce a single string to a valid {@link SeverityCode}, or `undefined`. A value
 * outside the closed enum drops to absent (self-heal), same contract as the affects axis.
 */
export function normalizeSeverity(v: string | null | undefined): SeverityCode | undefined {
	if (typeof v !== 'string') return undefined;
	const t = v.trim();
	return isSeverityCode(t) ? t : undefined;
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
		...(s.date !== undefined ? { date: s.date } : {}),
		...(s.worstN !== undefined ? { worstN: s.worstN } : {}),
		...(s.alertAffects !== undefined ? { alertAffects: s.alertAffects } : {}),
		...(s.alertSeverity !== undefined ? { alertSeverity: s.alertSeverity } : {}),
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
		s.window === undefined &&
		s.date === undefined &&
		s.worstN === undefined &&
		s.alertAffects === undefined &&
		s.alertSeverity === undefined
	);
}

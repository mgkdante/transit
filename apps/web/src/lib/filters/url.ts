// $lib/filters/url — the URL ⇄ FilterState codec.
//
// The URL is the canonical home of filter state: it is shareable, bookmarkable,
// survives a locale switch (the switcher preserves `url.search`), and SSR reads
// it before the store ever exists. This module is the ONLY place that knows the
// wire format:
//
//   keys  : route, stop, trip, vehicle, status, occupancy, entity, grain, window  (stable order)
//   sets  : comma-joined, sorted, deduped (route=10,165,80)
//   empty : an empty set / absent enum / absent lever is OMITTED entirely
//   round : fromSearchParams(toSearchParams(s)) is value-equal to a normalized s
//
// Invalid values are dropped on the way IN (enum guards in ./state), so the URL
// is self-healing: a hand-edited `?status=bogus,late` parses to `late` only.
//
// SSR-safe: operates purely on URLSearchParams; never touches `window`.

import type { FilterState, IdSetKey } from './state';
import {
	emptyFilterState,
	normalizeStatus,
	normalizeOccupancy,
	normalizeEntities,
	normalizeAlerts,
	isGrain,
} from './state';

/**
 * Stable, intentional key order for the serialized URL. Sets first (the primary
 * subject), then the enum chip families, then the time levers. Iterating this
 * (rather than Object.keys) guarantees a byte-stable query string regardless of
 * insertion order in the source state — which is what makes the round-trip and
 * equality checks deterministic.
 */
const KEY_ORDER = [
	'route',
	'stop',
	'trip',
	'vehicle',
	'status',
	'occupancy',
	'entity',
	'alert',
	'grain',
	'window',
] as const;

/** Wire key → the FilterState id-set field it maps to. */
const SET_KEY_TO_FIELD: Record<'route' | 'stop' | 'trip' | 'vehicle', IdSetKey> = {
	route: 'routes',
	stop: 'stops',
	trip: 'trips',
	vehicle: 'vehicles',
};

/**
 * Split one raw query value into trimmed, non-empty tokens. Accepts both the
 * canonical comma-joined form (`?route=10,80`) and repeated keys
 * (`?route=10&route=80`) by being called per-value; blank tokens (from
 * `?route=` or `10,,80`) are discarded.
 */
function splitTokens(raw: string): string[] {
	return raw
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

/** Collect every token across all occurrences of `key` (comma + repeated). */
function collect(sp: URLSearchParams, key: string): string[] {
	const out: string[] = [];
	for (const raw of sp.getAll(key)) out.push(...splitTokens(raw));
	return out;
}

/** Dedupe while preserving first-seen order. */
function dedupe(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of values) {
		if (!seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out;
}

/**
 * Parse a URLSearchParams into a normalized {@link FilterState}.
 *
 * - id sets (route/stop/trip): comma + repeated keys both accepted, blanks and
 *   duplicates dropped;
 * - status/occupancy: invalid enum values DROPPED, deduped, absent when empty;
 * - grain: kept only if a valid {@link import('./state').FilterState['grain']};
 * - window: trimmed; absent when blank.
 *
 * Unknown query keys are ignored. The result is canonical, so feeding it back
 * through {@link toSearchParams} and re-parsing is a fixed point.
 */
export function fromSearchParams(sp: URLSearchParams): FilterState {
	const state = emptyFilterState();

	for (const [key, field] of Object.entries(SET_KEY_TO_FIELD) as [
		'route' | 'stop' | 'trip' | 'vehicle',
		IdSetKey,
	][]) {
		for (const token of collect(sp, key)) state[field].add(token);
	}

	const status = normalizeStatus(collect(sp, 'status'));
	if (status) state.status = status;

	const occupancy = normalizeOccupancy(collect(sp, 'occupancy'));
	if (occupancy) state.occupancy = occupancy;

	const entities = normalizeEntities(collect(sp, 'entity'));
	if (entities) state.entities = entities;

	const alerts = normalizeAlerts(collect(sp, 'alert'));
	if (alerts) state.alerts = alerts;

	const grainTokens = dedupe(collect(sp, 'grain'));
	const grain = grainTokens.find((g) => isGrain(g));
	if (grain && isGrain(grain)) state.grain = grain;

	const windowRaw = (sp.get('window') ?? '').trim();
	if (windowRaw) state.window = windowRaw;

	return state;
}

/**
 * Serialize a {@link FilterState} to URLSearchParams in the canonical wire
 * format. Sets are sorted + comma-joined; absent/empty fields are omitted; keys
 * are appended in {@link KEY_ORDER} so the resulting query string is byte-stable
 * for a given logical state (idempotent round-trip, stable history entries).
 */
export function toSearchParams(s: FilterState): URLSearchParams {
	const sp = new URLSearchParams();

	for (const key of KEY_ORDER) {
		switch (key) {
			case 'route':
			case 'stop':
			case 'trip':
			case 'vehicle': {
				const set = s[SET_KEY_TO_FIELD[key]];
				if (set.size > 0) sp.set(key, [...set].sort().join(','));
				break;
			}
			case 'status': {
				if (s.status && s.status.length > 0) sp.set('status', s.status.join(','));
				break;
			}
			case 'occupancy': {
				if (s.occupancy && s.occupancy.length > 0) sp.set('occupancy', s.occupancy.join(','));
				break;
			}
			case 'entity': {
				if (s.entities && s.entities.length > 0) sp.set('entity', s.entities.join(','));
				break;
			}
			case 'alert': {
				if (s.alerts && s.alerts.length > 0) sp.set('alert', s.alerts.join(','));
				break;
			}
			case 'grain': {
				if (s.grain !== undefined) sp.set('grain', s.grain);
				break;
			}
			case 'window': {
				if (s.window) sp.set('window', s.window);
				break;
			}
		}
	}

	return sp;
}

/**
 * Canonical query string (no leading `?`) for a state, or `''` when empty.
 * Convenience for callers building an href: `path + (qs ? '?' + qs : '')`.
 */
export function toSearchString(s: FilterState): string {
	return toSearchParams(s).toString();
}

// $lib/filters/store — the request-scoped, runes-backed filter store.
//
// CRITICAL DESIGN CONSTRAINTS (enforced by review + SSR):
//   - NOT a module singleton. `createFilterStore` returns a FRESH store every
//     call, so each SSR request (and each panel that wants isolated state) gets
//     its own instance — module-level `$state` would leak one user's filters
//     into another's response.
//   - NO module-top `window`. This module is import-safe on the server. The URL
//     is written through a caller-supplied `pushUrl` callback (the page wires it
//     to SvelteKit's `goto`/`replaceState`), so the store never imports
//     `$app/navigation` or touches the DOM itself.
//   - URL is the source of truth. Every mutation produces the next state, then
//     hands its canonical query string to `pushUrl`; the page is free to push,
//     replace, or ignore (e.g. during SSR `pushUrl` is a no-op).
//
// The store exposes reactive getters (read through them to stay reactive) plus a
// small mutation surface that mirrors the chip vocabulary of the filter bar.

import type { StatusCode, OccupancyCode, Grain } from '$lib/v1/schemas';
import {
	type FilterState,
	type IdSetKey,
	type EntityKind,
	type AlertEntityKind,
	cloneFilterState,
	emptyFilterState,
	isEmptyFilterState,
} from './state';
import { toSearchString } from './url';

/**
 * Called after every mutation with the next state's canonical query string
 * (no leading `?`, `''` when empty). The page wires this to navigation
 * (`goto`/`replaceState`); SSR passes a no-op. It is the store's ONLY side
 * channel to the URL — keeping the store itself DOM-free and SSR-safe.
 */
export type PushUrl = (search: string) => void;

/** A removable filter chip — discriminated by family, carrying its value. */
export type Chip =
	| { kind: 'route'; value: string }
	| { kind: 'stop'; value: string }
	| { kind: 'trip'; value: string }
	| { kind: 'vehicle'; value: string }
	| { kind: 'status'; value: StatusCode }
	| { kind: 'occupancy'; value: OccupancyCode }
	| { kind: 'entity'; value: EntityKind }
	| { kind: 'alert'; value: AlertEntityKind }
	| { kind: 'grain' }
	| { kind: 'window' };

/** The id-set chip kinds, mapped to their FilterState fields. */
const CHIP_TO_SET: Record<'route' | 'stop' | 'trip' | 'vehicle', IdSetKey> = {
	route: 'routes',
	stop: 'stops',
	trip: 'trips',
	vehicle: 'vehicles',
};

/** The reactive store returned by {@link createFilterStore}. */
export interface FilterStore {
	/** Live, value-equal snapshot of the current state (read to stay reactive). */
	readonly state: FilterState;
	readonly routes: ReadonlySet<string>;
	readonly stops: ReadonlySet<string>;
	readonly trips: ReadonlySet<string>;
	readonly vehicles: ReadonlySet<string>;
	readonly status: readonly StatusCode[];
	readonly occupancy: readonly OccupancyCode[];
	readonly entities: readonly EntityKind[];
	readonly alerts: readonly AlertEntityKind[];
	readonly grain: Grain | undefined;
	readonly window: string | undefined;
	/** True when no filter of any kind is applied. */
	readonly isEmpty: boolean;
	/** Flat, ordered list of removable chips for rendering the active-filter bar. */
	readonly chips: Chip[];

	addRoute(id: string): void;
	removeRoute(id: string): void;
	addStop(id: string): void;
	removeStop(id: string): void;
	addTrip(id: string): void;
	removeTrip(id: string): void;
	addVehicle(id: string): void;
	removeVehicle(id: string): void;

	toggleStatus(code: StatusCode): void;
	setStatus(codes: readonly StatusCode[]): void;
	toggleOccupancy(code: OccupancyCode): void;
	setOccupancy(codes: readonly OccupancyCode[]): void;
	toggleEntity(kind: EntityKind): void;
	setEntities(kinds: readonly EntityKind[]): void;
	toggleAlert(kind: AlertEntityKind): void;
	setAlerts(kinds: readonly AlertEntityKind[]): void;

	setGrain(grain: Grain | undefined): void;
	setWindow(window: string | undefined): void;

	/** Remove a single chip (any family). */
	removeChip(chip: Chip): void;
	/** Reset every filter to empty. */
	clear(): void;
	/**
	 * Replace the entire state (e.g. on a back/forward navigation when the page
	 * re-parses the URL). Does NOT call `pushUrl` — the URL is already the source
	 * of this change, so re-pushing would loop.
	 */
	replace(next: FilterState): void;
}

/**
 * Create a fresh, request-scoped filter store seeded from `init` (typically
 * `fromSearchParams(url.searchParams)` on the server/page). Every mutation
 * computes the next state immutably, commits it to the rune, and pushes its
 * canonical query string through `pushUrl`.
 *
 * @param init    seed state (cloned defensively — the caller keeps ownership)
 * @param pushUrl URL side-channel; defaults to a no-op so the store is usable in
 *                pure-SSR / test contexts without any navigation wiring.
 */
export function createFilterStore(init: FilterState, pushUrl: PushUrl = () => {}): FilterStore {
	let current = $state<FilterState>(cloneFilterState(init));

	/** Commit a next state and publish it to the URL. */
	function commit(next: FilterState): void {
		current = next;
		pushUrl(toSearchString(next));
	}

	/** Mutate via a transform that receives a fresh clone it may mutate in place. */
	function mutate(fn: (draft: FilterState) => void): void {
		const draft = cloneFilterState(current);
		fn(draft);
		commit(draft);
	}

	function addId(key: IdSetKey, id: string): void {
		const v = id.trim();
		if (!v) return;
		mutate((d) => d[key].add(v));
	}

	function removeId(key: IdSetKey, id: string): void {
		mutate((d) => d[key].delete(id.trim()));
	}

	function toggleEnum<T extends string>(
		read: (d: FilterState) => T[] | undefined,
		write: (d: FilterState, next: T[] | undefined) => void,
		code: T,
	): void {
		mutate((d) => {
			const cur = read(d) ?? [];
			const has = cur.includes(code);
			const next = has ? cur.filter((c) => c !== code) : [...cur, code];
			write(d, next.length > 0 ? next : undefined);
		});
	}

	return {
		get state() {
			return current;
		},
		get routes() {
			return current.routes;
		},
		get stops() {
			return current.stops;
		},
		get trips() {
			return current.trips;
		},
		get vehicles() {
			return current.vehicles;
		},
		get status() {
			return current.status ?? [];
		},
		get occupancy() {
			return current.occupancy ?? [];
		},
		get entities() {
			return current.entities ?? [];
		},
		get alerts() {
			return current.alerts ?? [];
		},
		get grain() {
			return current.grain;
		},
		get window() {
			return current.window;
		},
		get isEmpty() {
			return isEmptyFilterState(current);
		},
		get chips() {
			const out: Chip[] = [];
			for (const value of current.routes) out.push({ kind: 'route', value });
			for (const value of current.stops) out.push({ kind: 'stop', value });
			for (const value of current.trips) out.push({ kind: 'trip', value });
			for (const value of current.vehicles) out.push({ kind: 'vehicle', value });
			for (const value of current.status ?? []) out.push({ kind: 'status', value });
			for (const value of current.occupancy ?? []) out.push({ kind: 'occupancy', value });
			for (const value of current.entities ?? []) out.push({ kind: 'entity', value });
			for (const value of current.alerts ?? []) out.push({ kind: 'alert', value });
			if (current.grain !== undefined) out.push({ kind: 'grain' });
			if (current.window !== undefined && current.window !== '') out.push({ kind: 'window' });
			return out;
		},

		addRoute(id) {
			addId('routes', id);
		},
		removeRoute(id) {
			removeId('routes', id);
		},
		addStop(id) {
			addId('stops', id);
		},
		removeStop(id) {
			removeId('stops', id);
		},
		addTrip(id) {
			addId('trips', id);
		},
		removeTrip(id) {
			removeId('trips', id);
		},
		addVehicle(id) {
			addId('vehicles', id);
		},
		removeVehicle(id) {
			removeId('vehicles', id);
		},

		toggleStatus(code) {
			toggleEnum<StatusCode>(
				(d) => d.status,
				(d, next) => {
					if (next) d.status = next;
					else delete d.status;
				},
				code,
			);
		},
		setStatus(codes) {
			mutate((d) => {
				if (codes.length > 0) d.status = [...codes];
				else delete d.status;
			});
		},
		toggleOccupancy(code) {
			toggleEnum<OccupancyCode>(
				(d) => d.occupancy,
				(d, next) => {
					if (next) d.occupancy = next;
					else delete d.occupancy;
				},
				code,
			);
		},
		setOccupancy(codes) {
			mutate((d) => {
				if (codes.length > 0) d.occupancy = [...codes];
				else delete d.occupancy;
			});
		},
		toggleEntity(kind) {
			toggleEnum<EntityKind>(
				(d) => d.entities,
				(d, next) => {
					if (next) d.entities = next;
					else delete d.entities;
				},
				kind,
			);
		},
		setEntities(kinds) {
			mutate((d) => {
				if (kinds.length > 0) d.entities = [...kinds];
				else delete d.entities;
			});
		},
		toggleAlert(kind) {
			toggleEnum<AlertEntityKind>(
				(d) => d.alerts,
				(d, next) => {
					if (next) d.alerts = next;
					else delete d.alerts;
				},
				kind,
			);
		},
		setAlerts(kinds) {
			mutate((d) => {
				if (kinds.length > 0) d.alerts = [...kinds];
				else delete d.alerts;
			});
		},

		setGrain(grain) {
			mutate((d) => {
				if (grain !== undefined) d.grain = grain;
				else delete d.grain;
			});
		},
		setWindow(window) {
			mutate((d) => {
				const w = window?.trim();
				if (w) d.window = w;
				else delete d.window;
			});
		},

		removeChip(chip) {
			switch (chip.kind) {
				case 'route':
				case 'stop':
				case 'trip':
				case 'vehicle':
					removeId(CHIP_TO_SET[chip.kind], chip.value);
					break;
				case 'status':
					mutate((d) => {
						const next = (d.status ?? []).filter((c) => c !== chip.value);
						if (next.length > 0) d.status = next;
						else delete d.status;
					});
					break;
				case 'occupancy':
					mutate((d) => {
						const next = (d.occupancy ?? []).filter((c) => c !== chip.value);
						if (next.length > 0) d.occupancy = next;
						else delete d.occupancy;
					});
					break;
				case 'entity':
					mutate((d) => {
						const next = (d.entities ?? []).filter((e) => e !== chip.value);
						if (next.length > 0) d.entities = next;
						else delete d.entities;
					});
					break;
				case 'alert':
					mutate((d) => {
						const next = (d.alerts ?? []).filter((a) => a !== chip.value);
						if (next.length > 0) d.alerts = next;
						else delete d.alerts;
					});
					break;
				case 'grain':
					mutate((d) => {
						delete d.grain;
					});
					break;
				case 'window':
					mutate((d) => {
						delete d.window;
					});
					break;
			}
		},

		clear() {
			commit(emptyFilterState());
		},

		replace(next) {
			current = cloneFilterState(next);
		},
	};
}

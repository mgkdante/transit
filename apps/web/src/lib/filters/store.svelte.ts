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
	type DateWindow,
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

export interface FilterWriteContext {
	readonly authority: 'user' | 'selection';
	readonly ownership: 'release-touched' | 'claim-new';
}

const DEFAULT_WRITE_CONTEXT: FilterWriteContext = {
	authority: 'user',
	ownership: 'release-touched',
};

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

const SET_TO_CHIP: Record<IdSetKey, 'route' | 'stop' | 'trip' | 'vehicle'> = {
	routes: 'route',
	stops: 'stop',
	trips: 'trip',
	vehicles: 'vehicle',
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
	readonly window: DateWindow | undefined;
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
	setWindow(window: DateWindow | undefined): void;

	/** Remove a single chip (any family). */
	removeChip(chip: Chip): void;
	/** Reset every filter to empty. */
	clear(): void;
	/** Apply additive chips in one provenance-aware transaction. */
	applyChips(chips: readonly Chip[], context?: FilterWriteContext): void;
	/** Remove every filter value claimed by a selection in one transaction. */
	clearSelectionOwned(): void;
	/**
	 * Replace the entire state (e.g. on a back/forward navigation when the page
	 * re-parses the URL). Does NOT call `pushUrl` — the URL is already the source
	 * of this change, so re-pushing would loop.
	 */
	replaceFromUrl(next: FilterState, cause: 'echo' | 'adopt'): void;
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
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- provenance is private bookkeeping, not UI state
	const selectionOwned = new Map<string, Chip>();

	/** Commit only a changed canonical payload, optionally publishing it to the URL. */
	function commit(next: FilterState, publish = true, clone = false): void {
		const search = toSearchString(next);
		if (search === toSearchString(current)) return;
		current = clone ? cloneFilterState(next) : next;
		if (publish) pushUrl(search);
	}

	function chipKey(chip: Chip): string {
		if (chip.kind === 'grain' || chip.kind === 'window') return chip.kind;
		const value = ['route', 'stop', 'trip', 'vehicle'].includes(chip.kind)
			? chip.value.trim()
			: chip.value;
		return `${chip.kind}\u0000${value}`;
	}

	function hasChip(state: FilterState, chip: Chip): boolean {
		switch (chip.kind) {
			case 'route':
			case 'stop':
			case 'trip':
			case 'vehicle':
				return state[CHIP_TO_SET[chip.kind]].has(chip.value.trim());
			case 'status':
				return state.status?.includes(chip.value) ?? false;
			case 'occupancy':
				return state.occupancy?.includes(chip.value) ?? false;
			case 'entity':
				return state.entities?.includes(chip.value) ?? false;
			case 'alert':
				return state.alerts?.includes(chip.value) ?? false;
			case 'grain':
				return state.grain !== undefined;
			case 'window':
				return state.window !== undefined;
		}
	}

	function releaseTouched(chips: readonly Chip[]): void {
		for (const chip of chips) selectionOwned.delete(chipKey(chip));
	}

	function transitionOwnership(
		before: FilterState,
		after: FilterState,
		chips: readonly Chip[],
		context: FilterWriteContext,
	): void {
		if (context.ownership === 'release-touched') {
			releaseTouched(chips);
			return;
		}
		for (const chip of chips) {
			if (!hasChip(before, chip) && hasChip(after, chip)) selectionOwned.set(chipKey(chip), chip);
		}
	}

	/** Mutate via a transform that receives a fresh clone it may mutate in place. */
	function mutate(
		fn: (draft: FilterState) => void,
		chips: readonly Chip[],
		context: FilterWriteContext = DEFAULT_WRITE_CONTEXT,
	): void {
		const draft = cloneFilterState(current);
		fn(draft);
		transitionOwnership(current, draft, chips, context);
		commit(draft);
	}

	function addId(key: IdSetKey, id: string): void {
		const v = id.trim();
		if (!v) return;
		mutate((d) => d[key].add(v), [{ kind: SET_TO_CHIP[key], value: v }]);
	}

	function removeId(key: IdSetKey, id: string): void {
		mutate((d) => d[key].delete(id.trim()), [{ kind: SET_TO_CHIP[key], value: id }]);
	}

	function toggleEnum<T extends string>(
		read: (d: FilterState) => T[] | undefined,
		write: (d: FilterState, next: T[] | undefined) => void,
		chip: Chip,
		code: T,
	): void {
		mutate(
			(d) => {
				const cur = read(d) ?? [];
				const has = cur.includes(code);
				const next = has ? cur.filter((c) => c !== code) : [...cur, code];
				write(d, next.length > 0 ? next : undefined);
			},
			[chip],
		);
	}

	function addChip(draft: FilterState, chip: Chip): void {
		switch (chip.kind) {
			case 'route':
			case 'stop':
			case 'trip':
			case 'vehicle': {
				const value = chip.value.trim();
				if (value) draft[CHIP_TO_SET[chip.kind]].add(value);
				break;
			}
			case 'status':
				if (!draft.status?.includes(chip.value))
					draft.status = [...(draft.status ?? []), chip.value];
				break;
			case 'occupancy':
				if (!draft.occupancy?.includes(chip.value))
					draft.occupancy = [...(draft.occupancy ?? []), chip.value];
				break;
			case 'entity':
				if (!draft.entities?.includes(chip.value))
					draft.entities = [...(draft.entities ?? []), chip.value];
				break;
			case 'alert':
				if (!draft.alerts?.includes(chip.value))
					draft.alerts = [...(draft.alerts ?? []), chip.value];
				break;
			case 'grain':
			case 'window':
				break;
		}
	}

	function removeChipFromState(draft: FilterState, chip: Chip): void {
		switch (chip.kind) {
			case 'route':
			case 'stop':
			case 'trip':
			case 'vehicle':
				draft[CHIP_TO_SET[chip.kind]].delete(chip.value.trim());
				break;
			case 'status': {
				const next = (draft.status ?? []).filter((code) => code !== chip.value);
				if (next.length) draft.status = next;
				else delete draft.status;
				break;
			}
			case 'occupancy': {
				const next = (draft.occupancy ?? []).filter((code) => code !== chip.value);
				if (next.length) draft.occupancy = next;
				else delete draft.occupancy;
				break;
			}
			case 'entity': {
				const next = (draft.entities ?? []).filter((kind) => kind !== chip.value);
				if (next.length) draft.entities = next;
				else delete draft.entities;
				break;
			}
			case 'alert': {
				const next = (draft.alerts ?? []).filter((kind) => kind !== chip.value);
				if (next.length) draft.alerts = next;
				else delete draft.alerts;
				break;
			}
			case 'grain':
				delete draft.grain;
				break;
			case 'window':
				delete draft.window;
				break;
		}
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
			if (current.window !== undefined) out.push({ kind: 'window' });
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
				{ kind: 'status', value: code },
				code,
			);
		},
		setStatus(codes) {
			const chips: Chip[] = [...(current.status ?? []), ...codes].map((value) => ({
				kind: 'status',
				value,
			}));
			mutate((d) => {
				if (codes.length > 0) d.status = [...codes];
				else delete d.status;
			}, chips);
		},
		toggleOccupancy(code) {
			toggleEnum<OccupancyCode>(
				(d) => d.occupancy,
				(d, next) => {
					if (next) d.occupancy = next;
					else delete d.occupancy;
				},
				{ kind: 'occupancy', value: code },
				code,
			);
		},
		setOccupancy(codes) {
			const chips: Chip[] = [...(current.occupancy ?? []), ...codes].map((value) => ({
				kind: 'occupancy',
				value,
			}));
			mutate((d) => {
				if (codes.length > 0) d.occupancy = [...codes];
				else delete d.occupancy;
			}, chips);
		},
		toggleEntity(kind) {
			toggleEnum<EntityKind>(
				(d) => d.entities,
				(d, next) => {
					if (next) d.entities = next;
					else delete d.entities;
				},
				{ kind: 'entity', value: kind },
				kind,
			);
		},
		setEntities(kinds) {
			const chips: Chip[] = [...(current.entities ?? []), ...kinds].map((value) => ({
				kind: 'entity',
				value,
			}));
			mutate((d) => {
				if (kinds.length > 0) d.entities = [...kinds];
				else delete d.entities;
			}, chips);
		},
		toggleAlert(kind) {
			toggleEnum<AlertEntityKind>(
				(d) => d.alerts,
				(d, next) => {
					if (next) d.alerts = next;
					else delete d.alerts;
				},
				{ kind: 'alert', value: kind },
				kind,
			);
		},
		setAlerts(kinds) {
			const chips: Chip[] = [...(current.alerts ?? []), ...kinds].map((value) => ({
				kind: 'alert',
				value,
			}));
			mutate((d) => {
				if (kinds.length > 0) d.alerts = [...kinds];
				else delete d.alerts;
			}, chips);
		},

		setGrain(grain) {
			mutate(
				(d) => {
					if (grain !== undefined) d.grain = grain;
					else delete d.grain;
				},
				[{ kind: 'grain' }],
			);
		},
		setWindow(window) {
			mutate(
				(d) => {
					if (window) d.window = { from: window.from, to: window.to };
					else delete d.window;
				},
				[{ kind: 'window' }],
			);
		},

		removeChip(chip) {
			mutate((draft) => removeChipFromState(draft, chip), [chip]);
		},

		clear() {
			selectionOwned.clear();
			commit(emptyFilterState());
		},

		applyChips(chips, context = DEFAULT_WRITE_CONTEXT) {
			mutate(
				(draft) => {
					for (const chip of chips) addChip(draft, chip);
				},
				chips,
				context,
			);
		},

		clearSelectionOwned() {
			if (selectionOwned.size === 0) return;
			const owned = [...selectionOwned.values()];
			selectionOwned.clear();
			const draft = cloneFilterState(current);
			for (const chip of owned) removeChipFromState(draft, chip);
			commit(draft);
		},

		replaceFromUrl(next, cause) {
			if (cause === 'adopt') selectionOwned.clear();
			commit(next, false, true);
		},
	};
}

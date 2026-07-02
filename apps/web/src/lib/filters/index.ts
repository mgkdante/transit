// $lib/filters — the URL ⇄ filter-state engine.
//
// Single import surface for the whole filter layer:
//   import { fromSearchParams, createFilterStore } from '$lib/filters';
//
// State shape + immutable helpers, the URL codec, the request-scoped runes
// store, and tier→grain gating. SSR-safe end to end: nothing here touches the
// DOM, `window`, or navigation directly (the store reaches the URL only through
// a caller-supplied `pushUrl`).

export type {
	FilterState,
	IdSetKey,
	EntityKind,
	AlertEntityKind,
	DateWindow,
	WorstN,
	WorstNRung,
} from './state';
export {
	STATUS_CODES,
	OCCUPANCY_CODES,
	GRAINS,
	ENTITY_KINDS,
	ALERT_ENTITY_KINDS,
	WORST_N_LADDER,
	isStatusCode,
	isOccupancyCode,
	isEntityKind,
	isAlertEntityKind,
	isGrain,
	isWorstN,
	isIsoDate,
	normalizeStatus,
	normalizeOccupancy,
	normalizeEntities,
	normalizeAlerts,
	normalizeWindow,
	normalizeWorstN,
	emptyFilterState,
	cloneFilterState,
	isEmptyFilterState,
	addToSet,
	removeFromSet,
	clear,
} from './state';

export { fromSearchParams, toSearchParams, toSearchString } from './url';

export type { MapFilterTarget } from './mapTarget';
export { mapSearchFor } from './mapTarget';

export type { FilterStore, PushUrl, Chip } from './store.svelte';
export { createFilterStore } from './store.svelte';

export type { DataTier } from './grain';
export {
	availableGrains,
	defaultGrain,
	isGrainAvailable,
	resolveGrain,
	resolveWindow,
	usableGrains,
	usableFromOffered,
	isGrainUsable,
	MIN_POINTS_PER_GRAIN,
} from './grain';

// $lib/filters — the URL ⇄ filter-state engine.
//
// Single import surface for the whole filter layer:
//   import { fromSearchParams, createFilterStore } from '$lib/filters';
//
// State shape + immutable helpers, the URL codec, the request-scoped runes
// store, and tier→grain gating. SSR-safe end to end: nothing here touches the
// DOM, `window`, or navigation directly (the store reaches the URL only through
// a caller-supplied `pushUrl`).

export type { FilterState, IdSetKey } from './state';
export {
	STATUS_CODES,
	OCCUPANCY_CODES,
	GRAINS,
	isStatusCode,
	isOccupancyCode,
	isGrain,
	normalizeStatus,
	normalizeOccupancy,
	emptyFilterState,
	cloneFilterState,
	isEmptyFilterState,
	addToSet,
	removeFromSet,
	clear,
} from './state';

export { fromSearchParams, toSearchParams, toSearchString } from './url';

export type { FilterStore, PushUrl, Chip } from './store.svelte';
export { createFilterStore } from './store.svelte';

export type { DataTier } from './grain';
export { availableGrains, defaultGrain, isGrainAvailable, resolveGrain } from './grain';

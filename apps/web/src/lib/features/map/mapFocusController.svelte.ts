import { MAP_FOCUS_PARAM, type MapFocus } from '$lib/search/mapFocus';

export interface MapFocusControllerDependencies {
	readonly readFocus: (searchParams: URLSearchParams) => MapFocus | null;
	readonly clearFocus: () => void;
}

export interface MapFocusController {
	get pending(): MapFocus | null;
	syncFromUrl(searchParams: URLSearchParams): void;
	consumeOnce(handle: (focus: MapFocus) => void): boolean;
}

/** Owns the rune that wakes MapHero's resolver effect after one-shot URL ingestion. */
export function createMapFocusController(
	dependencies: MapFocusControllerDependencies,
): MapFocusController {
	let pendingFocus = $state<MapFocus | null>(null);
	let pendingRaw = $state<string | null>(null);
	let consumedRaw = $state<string | null>(null);

	function syncFromUrl(searchParams: URLSearchParams): void {
		const raw = searchParams.get(MAP_FOCUS_PARAM);
		if (raw === null) {
			pendingFocus = null;
			pendingRaw = null;
			consumedRaw = null;
			return;
		}
		if (raw === consumedRaw || raw === pendingRaw) return;

		const focus = dependencies.readFocus(searchParams);
		if (!focus) {
			pendingFocus = null;
			pendingRaw = null;
			consumedRaw = raw;
			dependencies.clearFocus();
			return;
		}
		pendingFocus = focus;
		pendingRaw = raw;
	}

	function consumeOnce(handle: (focus: MapFocus) => void): boolean {
		if (!pendingFocus || pendingRaw === null) return false;
		const focus = pendingFocus;
		consumedRaw = pendingRaw;
		pendingFocus = null;
		pendingRaw = null;
		dependencies.clearFocus();
		handle(focus);
		return true;
	}

	return {
		get pending() {
			return pendingFocus;
		},
		syncFromUrl,
		consumeOnce,
	};
}

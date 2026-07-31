import type { MapFocus } from '$lib/search/mapFocus';

export interface MapFocusControllerDependencies {
	readonly readFocus: (searchParams: URLSearchParams) => MapFocus | null;
	readonly clearFocus: () => void;
}

export interface MapFocusController {
	get pending(): MapFocus | null;
	syncFromUrl(searchParams: URLSearchParams): void;
	consume(resolve: (focus: MapFocus) => boolean): boolean;
}

/** Owns the rune that wakes MapHero's resolver effect after one-shot URL ingestion. */
export function createMapFocusController(
	dependencies: MapFocusControllerDependencies,
): MapFocusController {
	let pendingFocus = $state<MapFocus | null>(null);

	function syncFromUrl(searchParams: URLSearchParams): void {
		const focus = dependencies.readFocus(searchParams);
		if (focus) pendingFocus = focus;
	}

	function consume(resolve: (focus: MapFocus) => boolean): boolean {
		if (!pendingFocus || !resolve(pendingFocus)) return false;
		pendingFocus = null;
		dependencies.clearFocus();
		return true;
	}

	return {
		get pending() {
			return pendingFocus;
		},
		syncFromUrl,
		consume,
	};
}

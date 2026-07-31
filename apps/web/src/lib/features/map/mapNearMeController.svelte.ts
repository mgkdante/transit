import type { GeocodedLocation, GeocodeSuggestion } from '$lib/geocode/types';
import { hasCoordinates } from '$lib/geocode/types';
import type { MapNearTarget } from '$lib/search/mapNear';
import { parseCoordinateQuery } from './mapNearMe';

export type NearMeOrigin = MapNearTarget;

export interface NearMeTranslations {
	readonly nearMeUseLocation: string;
	readonly nearMeError: string;
	readonly nearMeGeoDenied: string;
	readonly nearMeGeoTimeout: string;
	readonly nearMeGeoUnavailable: string;
	readonly nearMeGeoInsecure: string;
}

export interface MapNearMeControllerDependencies {
	readonly goto: (
		target: string,
		options: { replaceState: true; keepFocus: true; noScroll: true },
	) => unknown;
	readonly currentUrl: () => URL;
	readonly readTarget: (searchParams: URLSearchParams) => NearMeOrigin | null;
	readonly targetKey: (origin: NearMeOrigin) => string;
	readonly buildTargetSearch: (
		current: URLSearchParams,
		pathname: string,
		origin: NearMeOrigin,
	) => string;
	readonly clearTargetSearch: (current: URLSearchParams, pathname: string) => string;
	readonly focusOrigin: (origin: NearMeOrigin) => void;
	readonly fetch: (input: string) => Promise<Response>;
	readonly getGeolocation: () => Geolocation | null;
	readonly isSecureContext: () => boolean;
	readonly translations: NearMeTranslations;
}

export interface MapNearMeController {
	get open(): boolean;
	set open(next: boolean);
	get query(): string;
	set query(next: string);
	get loading(): boolean;
	get error(): string | null;
	get origin(): NearMeOrigin | null;
	get urlKey(): string;
	setOrigin(origin: NearMeOrigin, options?: { syncUrl?: boolean; urlBacked?: boolean }): void;
	syncFromUrl(searchParams: URLSearchParams): void;
	refocus(): void;
	clear(): void;
	useLocation(): void;
	search(event: SubmitEvent): Promise<void>;
	selectSuggestion(result: GeocodeSuggestion, sessionToken: string): Promise<void>;
}

const NAVIGATION_OPTIONS = {
	replaceState: true,
	keepFocus: true,
	noScroll: true,
} as const;

/** Owns the externally coupled near-me state machine behind injected browser seams. */
export function createMapNearMeController(
	dependencies: MapNearMeControllerDependencies,
): MapNearMeController {
	let open = $state(false);
	let query = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let origin = $state<NearMeOrigin | null>(null);
	let urlKey = $state('');
	// S5-377 B1: syncUrl ("write this origin to the URL?") and urlBacked
	// ("does the URL own it?") are separate questions — a URL-adopted origin
	// is owned by the URL yet must not echo back into it; a device fix is
	// neither written nor owned.
	let urlBacked = $state(true);

	function syncToUrl(nextOrigin: NearMeOrigin): void {
		const url = dependencies.currentUrl();
		urlKey = dependencies.targetKey(nextOrigin);
		void dependencies.goto(
			dependencies.buildTargetSearch(url.searchParams, url.pathname, nextOrigin),
			NAVIGATION_OPTIONS,
		);
	}

	function setOrigin(
		nextOrigin: NearMeOrigin,
		{ syncUrl = true, urlBacked: nextUrlBacked = true } = {},
	): void {
		origin = nextOrigin;
		error = null;
		urlBacked = nextUrlBacked;
		if (syncUrl) syncToUrl(nextOrigin);
		dependencies.focusOrigin(nextOrigin);
	}

	function syncFromUrl(searchParams: URLSearchParams): void {
		const nearTarget = dependencies.readTarget(searchParams);
		if (!nearTarget) {
			urlKey = '';
			// Only a URL-backed origin answers to the URL; a device fix (privacy:
			// coordinates never enter the query string) must survive URL moves.
			if (urlBacked) origin = null;
			return;
		}

		const key = dependencies.targetKey(nearTarget);
		if (urlKey === key) return;

		urlKey = key;
		open = true;
		query = '';
		setOrigin(nearTarget, { syncUrl: false });
	}

	function refocus(): void {
		if (origin) dependencies.focusOrigin(origin);
	}

	function clear(): void {
		origin = null;
		query = '';
		error = null;
		urlKey = '';
		urlBacked = true;
		const url = dependencies.currentUrl();
		void dependencies.goto(
			dependencies.clearTargetSearch(url.searchParams, url.pathname),
			NAVIGATION_OPTIONS,
		);
	}

	function useLocation(): void {
		open = true;
		if (!dependencies.isSecureContext()) {
			error = dependencies.translations.nearMeGeoInsecure;
			return;
		}
		const geolocation = dependencies.getGeolocation();
		if (!geolocation) {
			error = dependencies.translations.nearMeGeoUnavailable;
			return;
		}
		loading = true;
		error = null;
		geolocation.getCurrentPosition(
			(position) => {
				loading = false;
				// A device fix never enters the URL (WS8-A privacy: no coordinate
				// leak) and honestly frames at place precision, not street level.
				setOrigin(
					{
						lat: position.coords.latitude,
						lon: position.coords.longitude,
						label: dependencies.translations.nearMeUseLocation,
						precision: 'place',
					},
					{ syncUrl: false, urlBacked: false },
				);
			},
			(geoError) => {
				loading = false;
				error =
					geoError.code === geoError.PERMISSION_DENIED
						? dependencies.translations.nearMeGeoDenied
						: geoError.code === geoError.TIMEOUT
							? dependencies.translations.nearMeGeoTimeout
							: dependencies.translations.nearMeGeoUnavailable;
			},
			{ enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
		);
	}

	async function resolveQuery(nextQuery: string): Promise<void> {
		loading = true;
		error = null;
		try {
			const response = await dependencies.fetch(
				`/api/geocode/montreal?q=${encodeURIComponent(nextQuery)}`,
			);
			if (!response.ok) {
				error = dependencies.translations.nearMeError;
				return;
			}
			const result = (await response.json()) as GeocodedLocation;
			query = result.label;
			setOrigin(result);
		} catch {
			error = dependencies.translations.nearMeError;
		} finally {
			loading = false;
		}
	}

	async function search(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const nextQuery = query.trim();
		if (!nextQuery) return;

		const manual = parseCoordinateQuery(nextQuery);
		if (manual) {
			setOrigin({ ...manual, label: nextQuery, precision: 'address' });
			return;
		}

		await resolveQuery(nextQuery);
	}

	async function resolvePlace(placeId: string, sessionToken: string): Promise<void> {
		loading = true;
		error = null;
		try {
			const response = await dependencies.fetch(
				`/api/geocode/montreal?placeId=${encodeURIComponent(placeId)}&session=${encodeURIComponent(sessionToken)}`,
			);
			if (!response.ok) {
				error = dependencies.translations.nearMeError;
				return;
			}
			const result = (await response.json()) as GeocodedLocation;
			query = result.label;
			setOrigin(result);
		} catch {
			error = dependencies.translations.nearMeError;
		} finally {
			loading = false;
		}
	}

	async function selectSuggestion(result: GeocodeSuggestion, sessionToken: string): Promise<void> {
		query = result.label;
		if (hasCoordinates(result)) {
			setOrigin(result);
			return;
		}
		if (result.placeId && result.source === 'google_places') {
			await resolvePlace(result.placeId, sessionToken);
			return;
		}
		await resolveQuery(result.label);
	}

	return {
		get open() {
			return open;
		},
		set open(next: boolean) {
			open = next;
		},
		get query() {
			return query;
		},
		set query(next: string) {
			query = next;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get origin() {
			return origin;
		},
		get urlKey() {
			return urlKey;
		},
		setOrigin,
		syncFromUrl,
		refocus,
		clear,
		useLocation,
		search,
		selectSuggestion,
	};
}

import type { GeocodedLocation, GeocodePrecision, GeocodeSuggestion } from './types';
import { MONTREAL_BOUNDS, isInsideMontrealBounds } from './types';

export type GooglePlacesAutocompleteFetcher = (input: URL, init?: RequestInit) => Promise<Response>;
export type GooglePlaceDetailsFetcher = (input: URL, init?: RequestInit) => Promise<Response>;

const FIELD_MASK =
	'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.types';

// Place Details (New): only the fields needed to turn a placeId into a precise,
// in-bounds coordinate. Keeping the mask minimal keeps it in the cheapest SKU.
const DETAILS_FIELD_MASK = 'id,location,formattedAddress,types,displayName';

interface GoogleAutocompletePayload {
	suggestions?: unknown;
}

interface GooglePlacePrediction {
	placeId?: unknown;
	text?: unknown;
	types?: unknown;
}

interface GoogleText {
	text?: unknown;
}

interface GoogleSuggestion {
	placePrediction?: unknown;
}

export function googlePlacesAutocompleteUrl(): URL {
	return new URL('https://places.googleapis.com/v1/places:autocomplete');
}

export async function googlePlacesAutocompleteSuggestions(
	query: string,
	apiKey: string | undefined,
	fetcher: GooglePlacesAutocompleteFetcher = fetch,
	options: {
		readonly limit?: number;
		readonly sessionToken?: string | null;
		readonly languageCode?: string;
	} = {},
): Promise<GeocodeSuggestion[]> {
	const trimmed = query.trim();
	const key = apiKey?.trim();
	if (!trimmed || !key) return [];

	const response = await fetcher(googlePlacesAutocompleteUrl(), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'X-Goog-Api-Key': key,
			'X-Goog-FieldMask': FIELD_MASK,
		},
		body: JSON.stringify(autocompleteBody(trimmed, options)),
	});
	if (!response.ok) return [];

	const payload = (await response.json()) as GoogleAutocompletePayload;
	return parseAutocompleteSuggestions(payload).slice(
		0,
		Math.max(0, Math.trunc(options.limit ?? 5)),
	);
}

function autocompleteBody(
	input: string,
	options: { readonly sessionToken?: string | null; readonly languageCode?: string },
) {
	const body: Record<string, unknown> = {
		input,
		includedRegionCodes: ['ca'],
		languageCode: options.languageCode ?? 'en',
		regionCode: 'ca',
		locationRestriction: {
			rectangle: {
				low: {
					latitude: MONTREAL_BOUNDS.minLat,
					longitude: MONTREAL_BOUNDS.minLon,
				},
				high: {
					latitude: MONTREAL_BOUNDS.maxLat,
					longitude: MONTREAL_BOUNDS.maxLon,
				},
			},
		},
	};
	if (options.sessionToken) body.sessionToken = options.sessionToken;
	return body;
}

function parseAutocompleteSuggestions(payload: GoogleAutocompletePayload): GeocodeSuggestion[] {
	if (!Array.isArray(payload.suggestions)) return [];

	return payload.suggestions
		.map((item): GeocodeSuggestion | null => {
			const prediction = (item as GoogleSuggestion).placePrediction as
				| GooglePlacePrediction
				| undefined;
			if (!prediction || typeof prediction !== 'object') return null;

			const text = prediction.text as GoogleText | undefined;
			const label = typeof text?.text === 'string' ? text.text.trim() : '';
			const placeId = typeof prediction.placeId === 'string' ? prediction.placeId : '';
			if (!label || !placeId) return null;

			const types = Array.isArray(prediction.types)
				? prediction.types.filter((type): type is string => typeof type === 'string')
				: [];

			return {
				label,
				source: 'google_places',
				precision: googlePrecision(types),
				placeId,
				attribution: 'google',
			};
		})
		.filter((item): item is GeocodeSuggestion => item != null);
}

export function googlePlaceDetailsUrl(placeId: string): URL {
	return new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
}

interface GooglePlaceDetailsPayload {
	location?: { latitude?: unknown; longitude?: unknown };
	formattedAddress?: unknown;
	types?: unknown;
}

/**
 * Resolve a Google autocomplete placeId to exact coordinates — the second half
 * of a session: passing the SAME sessionToken used for autocomplete closes the
 * billing session (one Details + N autocomplete keystrokes = one charge).
 * Returns null on missing key/placeId, a non-OK response, no coordinate, or a
 * coordinate outside the Montréal bias rectangle.
 */
export async function googlePlaceDetails(
	placeId: string,
	apiKey: string | undefined,
	fetcher: GooglePlaceDetailsFetcher = fetch,
	options: { readonly sessionToken?: string | null; readonly languageCode?: string } = {},
): Promise<GeocodedLocation | null> {
	const id = placeId.trim();
	const key = apiKey?.trim();
	if (!id || !key) return null;

	const url = googlePlaceDetailsUrl(id);
	url.searchParams.set('languageCode', options.languageCode ?? 'en');
	url.searchParams.set('regionCode', 'ca');
	if (options.sessionToken) url.searchParams.set('sessionToken', options.sessionToken);

	const response = await fetcher(url, {
		method: 'GET',
		headers: {
			'X-Goog-Api-Key': key,
			'X-Goog-FieldMask': DETAILS_FIELD_MASK,
		},
	});
	if (!response.ok) return null;

	const payload = (await response.json()) as GooglePlaceDetailsPayload;
	const lat = Number(payload.location?.latitude);
	const lon = Number(payload.location?.longitude);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (!isInsideMontrealBounds(lat, lon)) return null;

	const label = typeof payload.formattedAddress === 'string' ? payload.formattedAddress.trim() : '';
	const types = Array.isArray(payload.types)
		? payload.types.filter((type): type is string => typeof type === 'string')
		: [];

	return {
		lat,
		lon,
		label: label || id,
		source: 'google_places',
		precision: googlePrecision(types),
		placeId: id,
		attribution: 'google',
	};
}

function googlePrecision(types: readonly string[]): GeocodePrecision {
	const normalized = types.map((type) => type.toLowerCase());
	if (normalized.some((type) => type.includes('postal_code'))) return 'postal';
	if (normalized.some((type) => ['street_address', 'premise', 'subpremise'].includes(type))) {
		return 'address';
	}
	if (normalized.some((type) => ['route', 'intersection'].includes(type))) return 'street';
	if (
		normalized.some((type) =>
			['neighborhood', 'neighbourhood', 'sublocality', 'political'].includes(type),
		)
	) {
		return 'neighbourhood';
	}
	return 'place';
}

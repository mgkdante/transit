import type { GeocodePrecision, GeocodeSuggestion } from './types';

export type GooglePlacesAutocompleteFetcher = (input: URL, init?: RequestInit) => Promise<Response>;

const MONTREAL_BOUNDS = {
	minLat: 45.35,
	maxLat: 45.75,
	minLon: -74.05,
	maxLon: -73.35,
};

const FIELD_MASK =
	'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.types';

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

import { describe, expect, it, vi } from 'vitest';
import {
	googlePlaceDetails,
	googlePlaceDetailsUrl,
	googlePlacesAutocompleteSuggestions,
	googlePlacesAutocompleteUrl,
	type GooglePlaceDetailsFetcher,
	type GooglePlacesAutocompleteFetcher,
} from './googlePlaces';

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		headers: { 'content-type': 'application/json' },
	});
}

describe('googlePlacesAutocompleteUrl', () => {
	it('targets Places Autocomplete New', () => {
		expect(googlePlacesAutocompleteUrl().toString()).toBe(
			'https://places.googleapis.com/v1/places:autocomplete',
		);
	});
});

describe('googlePlacesAutocompleteSuggestions', () => {
	it('uses Google only for autocomplete labels inside the Montreal provider area', async () => {
		const fetcher = vi.fn<GooglePlacesAutocompleteFetcher>(async () =>
			jsonResponse({
				suggestions: [
					{
						placePrediction: {
							placeId: 'google-address',
							text: { text: '5333 Avenue Casgrain, Montréal, QC, Canada' },
							types: ['street_address', 'premise'],
						},
					},
					{
						placePrediction: {
							placeId: 'google-postal',
							text: { text: 'H2T 1X3, Montréal, QC, Canada' },
							types: ['postal_code'],
						},
					},
				],
			}),
		);

		await expect(
			googlePlacesAutocompleteSuggestions('5333 casgrain', 'secret-key', fetcher, {
				limit: 2,
				sessionToken: 'session-1',
				languageCode: 'en',
			}),
		).resolves.toEqual([
			{
				label: '5333 Avenue Casgrain, Montréal, QC, Canada',
				source: 'google_places',
				precision: 'address',
				placeId: 'google-address',
				attribution: 'google',
			},
			{
				label: 'H2T 1X3, Montréal, QC, Canada',
				source: 'google_places',
				precision: 'postal',
				placeId: 'google-postal',
				attribution: 'google',
			},
		]);

		expect(fetcher).toHaveBeenCalledOnce();
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url?.toString()).toBe('https://places.googleapis.com/v1/places:autocomplete');
		expect(init).toMatchObject({
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'X-Goog-Api-Key': 'secret-key',
				'X-Goog-FieldMask':
					'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.types',
			},
		});
		expect(JSON.parse(String(init?.body))).toEqual({
			input: '5333 casgrain',
			includedRegionCodes: ['ca'],
			languageCode: 'en',
			regionCode: 'ca',
			sessionToken: 'session-1',
			locationRestriction: {
				rectangle: {
					low: { latitude: 45.35, longitude: -74.05 },
					high: { latitude: 45.75, longitude: -73.35 },
				},
			},
		});
	});

	it('does not call Google when no private API key is configured', async () => {
		const fetcher = vi.fn<GooglePlacesAutocompleteFetcher>();

		await expect(googlePlacesAutocompleteSuggestions('casgrain', '', fetcher)).resolves.toEqual([]);
		expect(fetcher).not.toHaveBeenCalled();
	});
});

describe('googlePlaceDetailsUrl', () => {
	it('targets Places Details New by id', () => {
		expect(googlePlaceDetailsUrl('ChIJabc').toString()).toBe(
			'https://places.googleapis.com/v1/places/ChIJabc',
		);
	});
});

describe('googlePlaceDetails', () => {
	it('resolves a placeId to an in-bounds GeocodedLocation, closing the session', async () => {
		const fetcher = vi.fn<GooglePlaceDetailsFetcher>(async () =>
			jsonResponse({
				id: 'ChIJabc',
				location: { latitude: 45.5256864, longitude: -73.5947644 },
				formattedAddress: '5333 Avenue Casgrain, Montréal, QC, Canada',
				types: ['street_address'],
			}),
		);

		await expect(
			googlePlaceDetails('ChIJabc', 'secret-key', fetcher, {
				sessionToken: 'session-1',
				languageCode: 'en',
			}),
		).resolves.toEqual({
			lat: 45.5256864,
			lon: -73.5947644,
			label: '5333 Avenue Casgrain, Montréal, QC, Canada',
			source: 'google_places',
			precision: 'address',
			placeId: 'ChIJabc',
			attribution: 'google',
		});

		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(url?.pathname).toBe('/v1/places/ChIJabc');
		expect(url?.searchParams.get('sessionToken')).toBe('session-1');
		expect(init?.method).toBe('GET');
		expect(init?.headers).toMatchObject({
			'X-Goog-Api-Key': 'secret-key',
			'X-Goog-FieldMask': 'id,location,formattedAddress,types,displayName',
		});
	});

	it('rejects a coordinate outside the Montréal bias rectangle', async () => {
		const fetcher = vi.fn<GooglePlaceDetailsFetcher>(async () =>
			jsonResponse({ location: { latitude: 43.65, longitude: -79.38 } }),
		);
		await expect(googlePlaceDetails('ChIJtoronto', 'secret-key', fetcher)).resolves.toBeNull();
	});

	it('returns null on a non-OK response', async () => {
		const fetcher = vi.fn<GooglePlaceDetailsFetcher>(
			async () => new Response('nope', { status: 429 }),
		);
		await expect(googlePlaceDetails('ChIJabc', 'secret-key', fetcher)).resolves.toBeNull();
	});

	it('does not call Google without a key or placeId', async () => {
		const fetcher = vi.fn<GooglePlaceDetailsFetcher>();
		await expect(googlePlaceDetails('ChIJabc', '', fetcher)).resolves.toBeNull();
		await expect(googlePlaceDetails('', 'secret-key', fetcher)).resolves.toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});
});

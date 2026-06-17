import { describe, expect, it, vi } from 'vitest';
import {
	googlePlacesAutocompleteSuggestions,
	googlePlacesAutocompleteUrl,
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

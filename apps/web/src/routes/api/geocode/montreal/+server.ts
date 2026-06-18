import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { googlePlaceDetails, googlePlacesAutocompleteSuggestions } from '$lib/geocode/googlePlaces';
import { geocodeMontreal, geocodeMontrealSuggestions } from '$lib/geocode/nominatim';

export const prerender = false;

export const GET: RequestHandler = async ({ url, fetch }) => {
	// Place-Details mode: resolve a Google placeId to exact coordinates server-side
	// (keeps the API key off the client and closes the autocomplete billing
	// session). This is what a picked Google suggestion calls instead of
	// re-text-searching its label — the fix for the wrong-place bug.
	const placeId = url.searchParams.get('placeId');
	if (placeId?.trim()) {
		const detail = await googlePlaceDetails(placeId, googlePlacesApiKey(), fetch, {
			sessionToken: url.searchParams.get('session'),
			languageCode: 'en',
		}).catch(() => null);
		if (!detail) {
			return json({ error: 'not_found' }, { status: 404 });
		}
		return json(detail, {
			headers: {
				'cache-control': 'private, max-age=0, no-store',
			},
		});
	}

	const query = url.searchParams.get('q') ?? '';
	if (!query.trim()) {
		return json({ error: 'query_required' }, { status: 400 });
	}

	if (url.searchParams.get('suggest') === '1') {
		const requestedLimit = Number(url.searchParams.get('limit') ?? 5);
		const limit = Number.isFinite(requestedLimit)
			? Math.min(Math.max(Math.trunc(requestedLimit), 1), 6)
			: 5;
		const googleResults = await googlePlacesAutocompleteSuggestions(
			query,
			googlePlacesApiKey(),
			fetch,
			{
				limit,
				sessionToken: url.searchParams.get('session'),
				languageCode: 'en',
			},
		).catch(() => []);
		if (googleResults.length > 0) {
			return json(
				{ results: googleResults, attribution: 'google' },
				{
					headers: {
						'cache-control': 'private, max-age=0, no-store',
					},
				},
			);
		}

		const results = await geocodeMontrealSuggestions(query, fetch, limit);
		return json(
			{ results },
			{
				headers: {
					'cache-control': 'public, max-age=900',
				},
			},
		);
	}

	const result = await geocodeMontreal(query, fetch);
	if (!result) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	return json(result, {
		headers: {
			'cache-control': 'public, max-age=3600',
		},
	});
};

function googlePlacesApiKey(): string | undefined {
	return env.GOOGLE_MAPS_API_KEY ?? env.GOOGLE_PLACES_API_KEY ?? env.GOOGLE_MAPS_PLATFORM_API_KEY;
}

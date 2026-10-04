import { describe, expect, it, vi } from 'vitest';
import { geoCaSearchUrl, geocode, geocodeSuggestions, type GeocodeFetcher } from './geoCa';

const AREA = {
	bbox: [-74.05, 45.35, -73.35, 45.75],
	context: 'Montreal, Quebec',
	lang: 'en' as const,
};

it('queries Ottawa context and rejects Montreal candidates for Ottawa', async () => {
	const fetcher = vi.fn(async (url: URL) => {
		expect(url.searchParams.get('q')).toBe('100 Bank street Ottawa Ontario Canada');
		expect(url.searchParams.get('lang')).toBe('fr');
		return new Response(
			JSON.stringify([
				{ lat: 45.42, lng: -75.69, name: 'Bank Street', category: 'street' },
				{ lat: 45.5, lng: -73.6, name: 'Montréal', category: 'street' },
			]),
		);
	});
	const results = await geocodeSuggestions(
		'100 Bank St',
		{ bbox: [-76.05, 45.1, -75.33, 45.55], context: 'Ottawa, Ontario', lang: 'fr' },
		fetcher,
	);
	expect(results.map(({ label }) => label)).toEqual(['Bank Street']);
});

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		headers: { 'content-type': 'application/json' },
	});
}

describe('geoCaSearchUrl', () => {
	it('uses the Canadian geolocator service with bounded source keys', () => {
		const url = geoCaSearchUrl('H2X 1Y4', AREA);

		expect(url.origin).toBe('https://geolocator.api.geo.ca');
		expect(url.searchParams.get('q')).toBe('H2X 1Y4 Montreal Quebec Canada');
		expect(url.searchParams.get('lang')).toBe('en');
		expect(url.searchParams.get('keys')).toBe('locate,nominatim,fsa,geonames');
	});

	it.each([
		['1234 boul st laurent', '1234 boulevard saint laurent'],
		['rue St', 'rue saint'],
		['rue St.', 'rue saint'],
		['av St', 'avenue saint'],
		['St Laurent', 'saint Laurent'],
		['100 Bank St', '100 Bank street'],
		['100 Bank St.', '100 Bank street'],
	])('expands street intent in %s before sending to Geo.ca', (query, expected) => {
		expect(geoCaSearchUrl(query, AREA).searchParams.get('q')).toBe(
			`${expected} Montreal Quebec Canada`,
		);
	});
});

describe('geocode', () => {
	it('prefers a block-level Geo.ca candidate over a broad FSA/postal centroid', async () => {
		const fetcher = vi.fn<GeocodeFetcher>(async () =>
			jsonResponse([
				{
					key: 'locate',
					name: 'H2X',
					category: 'PostalCode',
					lat: 45.512936,
					lng: -73.567795,
					tag: ['INTERPOLATED_CENTROID'],
				},
				{
					key: 'nominatim',
					name: '1618 Rue Saint Dominique Montreal QC H2X 1Y4, Rue Saint-Dominique, Quartier des Spectacles',
					category: 'Building',
					province: 'Quebec',
					lat: 45.5112983,
					lng: -73.5657786,
					tag: ['building'],
				},
				{
					key: 'fsa',
					name: 'H2X',
					category: 'Postal Code',
					province: 'Quebec / Québec',
					lat: 45.511464,
					lng: -73.568395,
					tag: ['1.565 km^2'],
				},
			]),
		);

		await expect(geocode('H2X 1Y4', AREA, fetcher)).resolves.toEqual({
			lat: 45.5112983,
			lon: -73.5657786,
			label:
				'1618 Rue Saint Dominique Montreal QC H2X 1Y4, Rue Saint-Dominique, Quartier des Spectacles',
			source: 'geo_ca',
			precision: 'address',
		});
		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
			headers: expect.objectContaining({
				'accept-language': 'en-CA,en;q=0.8',
			}),
		});
	});

	it('returns ranked Montréal autocomplete suggestions for address searches', async () => {
		const fetcher = vi.fn<GeocodeFetcher>(async () =>
			jsonResponse([
				{
					key: 'locate',
					name: 'H2X',
					category: 'PostalCode',
					lat: 45.512936,
					lng: -73.567795,
					tag: ['INTERPOLATED_CENTROID'],
				},
				{
					key: 'nominatim',
					name: '1618 Rue Saint Dominique Montreal QC H2X 1Y4, Rue Saint-Dominique, Quartier des Spectacles',
					category: 'Building',
					province: 'Quebec',
					lat: 45.5112983,
					lng: -73.5657786,
					tag: ['building'],
				},
				{
					key: 'fsa',
					name: 'H2X',
					category: 'Postal Code',
					province: 'Quebec / Québec',
					lat: 45.511464,
					lng: -73.568395,
					tag: ['1.565 km^2'],
				},
			]),
		);

		await expect(geocodeSuggestions('H2X 1Y4', AREA, fetcher, 2)).resolves.toEqual([
			{
				lat: 45.5112983,
				lon: -73.5657786,
				label:
					'1618 Rue Saint Dominique Montreal QC H2X 1Y4, Rue Saint-Dominique, Quartier des Spectacles',
				source: 'geo_ca',
				precision: 'address',
			},
			{
				lat: 45.512936,
				lon: -73.567795,
				label: 'H2X',
				source: 'geo_ca',
				precision: 'postal',
			},
		]);
	});

	it('keeps address-intent fallback on Geo.ca when it only has a broad place', async () => {
		const fetcher = vi.fn<GeocodeFetcher>(async () => {
			return jsonResponse([
				{
					key: 'geonames',
					name: 'Montreal',
					category: 'City',
					province: 'Quebec',
					lat: 45.5031824,
					lng: -73.5698065,
				},
			]);
		});

		await expect(geocodeSuggestions('1234 boul st laurent', AREA, fetcher, 2)).resolves.toEqual([
			{
				lat: 45.5031824,
				lon: -73.5698065,
				label: 'Montreal',
				source: 'geo_ca',
				precision: 'place',
			},
		]);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher.mock.calls[0]?.[0].origin).toBe('https://geolocator.api.geo.ca');
	});

	it('uses Geo.ca interpolated street positions for full address searches', async () => {
		const fetcher = vi.fn<GeocodeFetcher>(async () =>
			jsonResponse([
				{
					key: 'locate',
					name: '5333 Avenue Casgrain, Montréal, Quebec',
					category: 'Street',
					province: 'Quebec',
					lat: 45.5256864,
					lng: -73.5947644,
					tag: ['INTERPOLATED_POSITION'],
				},
				{
					key: 'locate',
					name: 'H2T',
					category: 'PostalCode',
					lat: 45.524494,
					lng: -73.595184,
					tag: ['INTERPOLATED_CENTROID'],
				},
			]),
		);

		await expect(geocode('5333 avenue Casgrain H2T 1X3', AREA, fetcher)).resolves.toEqual({
			lat: 45.5256864,
			lon: -73.5947644,
			label: '5333 Avenue Casgrain, Montréal, Quebec',
			source: 'geo_ca',
			precision: 'address',
		});
	});

	it('classifies street-type Geo.ca labels as streets even with generic categories', async () => {
		const fetcher = vi.fn<GeocodeFetcher>(async () =>
			jsonResponse([
				{
					key: 'locate',
					name: 'Boulevard Saint-Laurent, Villeray, Montréal',
					category: 'Toponym',
					province: 'Quebec',
					lat: 45.539433,
					lng: -73.6329017,
				},
			]),
		);

		await expect(geocodeSuggestions('boul st laurent', AREA, fetcher, 1)).resolves.toEqual([
			{
				lat: 45.539433,
				lon: -73.6329017,
				label: 'Boulevard Saint-Laurent, Villeray, Montréal',
				source: 'geo_ca',
				precision: 'street',
			},
		]);
	});

	it('returns null without a public fallback when Geo.ca has no Montréal candidate', async () => {
		const fetcher = vi.fn<GeocodeFetcher>(async (url) => {
			if (url.origin === 'https://geolocator.api.geo.ca') {
				return jsonResponse([
					{
						key: 'locate',
						name: 'Montreal Lake, Saskatchewan',
						category: 'Lake',
						province: 'Saskatchewan',
						lat: 54.298197,
						lng: -105.69265,
					},
				]);
			}
			return jsonResponse([
				{
					lat: '45.5152',
					lon: '-73.5616',
					display_name: 'Berri-UQAM, Montréal, Québec, Canada',
					type: 'station',
					class: 'railway',
				},
			]);
		});

		await expect(geocode('Berri-UQAM', AREA, fetcher)).resolves.toBeNull();
		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher.mock.calls[0]?.[0].origin).toBe('https://geolocator.api.geo.ca');
	});

	it('returns null without a public fallback when Geo.ca is unavailable', async () => {
		const fetcher = vi.fn<GeocodeFetcher>(async (url) => {
			if (url.origin === 'https://geolocator.api.geo.ca') {
				throw new Error('geo.ca unavailable');
			}
			return jsonResponse([
				{
					lat: '45.5152',
					lon: '-73.5616',
					display_name: 'Berri-UQAM, Montréal, Québec, Canada',
					type: 'station',
					class: 'railway',
				},
			]);
		});

		await expect(geocode('Berri-UQAM', AREA, fetcher)).resolves.toBeNull();
		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher.mock.calls[0]?.[0].origin).toBe('https://geolocator.api.geo.ca');
	});

	it('returns no suggestions without a public fallback when Geo.ca has no Montréal candidate', async () => {
		const fetcher = vi.fn<GeocodeFetcher>(async (url) => {
			if (url.origin === 'https://geolocator.api.geo.ca') {
				return jsonResponse([
					{
						key: 'locate',
						name: 'Montreal Lake, Saskatchewan',
						category: 'Lake',
						province: 'Saskatchewan',
						lat: 54.298197,
						lng: -105.69265,
					},
				]);
			}
			return jsonResponse([
				{
					lat: '45.5152',
					lon: '-73.5616',
					display_name: 'Berri-UQAM, Montréal, Québec, Canada',
					type: 'station',
					class: 'railway',
				},
			]);
		});

		await expect(geocodeSuggestions('Berri-UQAM', AREA, fetcher)).resolves.toEqual([]);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher.mock.calls[0]?.[0].origin).toBe('https://geolocator.api.geo.ca');
	});

	it('returns null on empty or out-of-bounds geocoder responses', async () => {
		const emptyFetcher = vi.fn<GeocodeFetcher>(async () => jsonResponse([]));
		await expect(geocode('H2X', AREA, emptyFetcher)).resolves.toBeNull();

		const farFetcher = vi.fn<GeocodeFetcher>(async () =>
			jsonResponse([{ key: 'locate', name: 'Québec', lat: 46.8, lng: -71.2 }]),
		);
		await expect(geocode('G1R 5M1', AREA, farFetcher)).resolves.toBeNull();
		expect(farFetcher).toHaveBeenCalledOnce();
	});
});

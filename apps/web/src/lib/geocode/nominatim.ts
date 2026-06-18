import type { GeocodedLocation, GeocodePrecision } from './types';

export type { GeocodedLocation, GeocodePrecision } from './types';

export type GeocodeFetcher = (input: URL, init?: RequestInit) => Promise<Response>;

const MONTREAL_BOUNDS = {
	minLat: 45.35,
	maxLat: 45.75,
	minLon: -74.05,
	maxLon: -73.35,
};

const GEO_CA_KEYS = 'locate,nominatim,fsa,geonames';
const CANADIAN_POSTAL_CODE_RE =
	/\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s*(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;

interface GeoCaResult {
	key?: unknown;
	name?: unknown;
	category?: unknown;
	province?: unknown;
	lat?: unknown;
	lng?: unknown;
	tag?: unknown;
}

interface NominatimResult {
	lat?: unknown;
	lon?: unknown;
	display_name?: unknown;
	class?: unknown;
	type?: unknown;
	address?: unknown;
}

interface RankedLocation {
	location: GeocodedLocation;
	score: number;
}

export function geoCaSearchUrl(query: string): URL {
	const url = new URL('https://geolocator.api.geo.ca/');
	url.searchParams.set('q', withEnglishMontrealContext(normalizeAddressIntentInQuery(query)));
	url.searchParams.set('lang', 'en');
	url.searchParams.set('keys', GEO_CA_KEYS);
	return url;
}

export function nominatimSearchUrl(query: string): URL {
	const url = new URL('https://nominatim.openstreetmap.org/search');
	const normalized = normalizeAddressIntentInQuery(query);
	url.searchParams.set('format', 'jsonv2');
	url.searchParams.set('countrycodes', 'ca');
	url.searchParams.set('bounded', '1');
	url.searchParams.set('limit', '8');
	url.searchParams.set('addressdetails', '1');
	url.searchParams.set('viewbox', '-74.05,45.75,-73.35,45.35');
	url.searchParams.set('q', `${normalized} Montréal Québec Canada`.trim());
	return url;
}

export async function geocodeMontreal(
	query: string,
	fetcher: GeocodeFetcher = fetch,
): Promise<GeocodedLocation | null> {
	const [first] = await geocodeMontrealSuggestions(query, fetcher, 1);
	return first ?? null;
}

export async function geocodeMontrealSuggestions(
	query: string,
	fetcher: GeocodeFetcher = fetch,
	limit = 5,
): Promise<GeocodedLocation[]> {
	if (!query.trim() || limit <= 0) return [];

	const geoCaResults = await geocodeGeoCaMontreal(query, fetcher).catch(() => []);
	if (hasUsefulAutocompleteCandidates(query, geoCaResults)) return geoCaResults.slice(0, limit);

	const nominatimResults = await geocodeNominatimMontreal(query, fetcher).catch(() => []);
	if (isAddressIntentQuery(query)) {
		const usefulNominatimResults = nominatimResults.filter(isUsefulForAddressIntent);
		if (usefulNominatimResults.length > 0) return usefulNominatimResults.slice(0, limit);
	}
	if (nominatimResults.length > 0) {
		return rankLocationResults(query, [...nominatimResults, ...geoCaResults]).slice(0, limit);
	}
	return geoCaResults.slice(0, limit);
}

async function geocodeGeoCaMontreal(
	query: string,
	fetcher: GeocodeFetcher,
): Promise<GeocodedLocation[]> {
	const response = await fetcher(geoCaSearchUrl(query), {
		headers: {
			accept: 'application/json',
			'accept-language': 'en-CA,en;q=0.8',
			'user-agent': 'transit.yesid.dev citizen map (https://transit.yesid.dev)',
		},
	});
	if (!response.ok) return [];

	const payload: unknown = await response.json();
	if (!Array.isArray(payload)) return [];

	return rankedGeoCaLocations(query, payload);
}

async function geocodeNominatimMontreal(
	query: string,
	fetcher: GeocodeFetcher,
): Promise<GeocodedLocation[]> {
	const response = await fetcher(nominatimSearchUrl(query), {
		headers: {
			accept: 'application/json',
			'accept-language': 'en-CA,en;q=0.8',
			'user-agent': 'transit.yesid.dev citizen map (https://transit.yesid.dev)',
		},
	});
	if (!response.ok) return [];

	const payload: unknown = await response.json();
	if (!Array.isArray(payload)) return [];

	return rankedNominatimLocations(query, payload);
}

function rankedGeoCaLocations(query: string, payload: unknown[]): GeocodedLocation[] {
	const ranked: RankedLocation[] = [];
	for (const item of payload) {
		const result = item as GeoCaResult;
		const lat = Number(result.lat);
		const lon = Number(result.lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		if (!isInsideMontrealBounds(lat, lon)) continue;

		const label = typeof result.name === 'string' ? result.name : query.trim();
		const category = typeof result.category === 'string' ? result.category : '';
		const key = typeof result.key === 'string' ? result.key : '';
		const tags = Array.isArray(result.tag)
			? result.tag.filter((tag): tag is string => typeof tag === 'string')
			: [];
		const precision = geoCaPrecision(label, category, tags);
		ranked.push({
			location: {
				lat,
				lon,
				label,
				source: 'geo_ca',
				precision,
			},
			score: precisionScore(precision) + geoCaSourceScore(key) + geoCaRelevanceScore(query, label),
		});
	}

	return rankedLocations(ranked);
}

function rankedNominatimLocations(query: string, payload: unknown[]): GeocodedLocation[] {
	const ranked: RankedLocation[] = [];
	for (const item of payload) {
		const result = item as NominatimResult;
		const lat = Number(result.lat);
		const lon = Number(result.lon);
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
		if (!isInsideMontrealBounds(lat, lon)) continue;

		const label = typeof result.display_name === 'string' ? result.display_name : query.trim();
		const precision = nominatimPrecision(result);
		ranked.push({
			location: {
				lat,
				lon,
				label,
				source: 'nominatim',
				precision,
			},
			score: precisionScore(precision) + geoCaRelevanceScore(query, label),
		});
	}

	return rankedLocations(ranked);
}

function rankedLocations(ranked: RankedLocation[]): GeocodedLocation[] {
	return ranked
		.sort((a, b) => b.score - a.score)
		.map((item) => item.location)
		.filter(uniqueLocation);
}

function rankLocationResults(
	query: string,
	locations: readonly GeocodedLocation[],
): GeocodedLocation[] {
	return rankedLocations(
		locations.map((location) => ({
			location,
			score:
				precisionScore(location.precision) +
				geoCaRelevanceScore(query, location.label) +
				providerScore(location.source),
		})),
	);
}

function uniqueLocation(
	location: GeocodedLocation,
	index: number,
	locations: GeocodedLocation[],
): boolean {
	const key = locationKey(location);
	return locations.findIndex((item) => locationKey(item) === key) === index;
}

function locationKey(location: GeocodedLocation): string {
	return `${location.lat.toFixed(6)},${location.lon.toFixed(6)}:${normalizeSearchText(location.label)}`;
}

function geoCaPrecision(
	label: string,
	category: string,
	tags: readonly string[],
): GeocodePrecision {
	const normalizedCategory = category.toLowerCase();
	const normalizedLabel = normalizeSearchText(label);
	const tagText = tags.join(' ').toLowerCase();
	if (
		normalizedCategory.includes('building') ||
		tagText.includes('building') ||
		tagText.includes('interpolated_position') ||
		(/^\d+\s/.test(label) && normalizedCategory.includes('street'))
	) {
		return 'address';
	}
	if (
		normalizedCategory.includes('street') ||
		normalizedCategory.includes('intersection') ||
		hasStreetWord(normalizedLabel)
	) {
		return 'street';
	}
	if (normalizedCategory.includes('postal')) return 'postal';
	if (
		normalizedCategory.includes('neighbourhood') ||
		normalizedCategory.includes('neighborhood') ||
		normalizedCategory.includes('district') ||
		normalizedCategory.includes('borough')
	) {
		return 'neighbourhood';
	}
	return 'place';
}

function hasStreetWord(value: string): boolean {
	return /\b(?:rue|street|saint|sainte|boulevard|avenue|chemin|road|route)\b/.test(value);
}

function nominatimPrecision(result: NominatimResult): GeocodePrecision {
	const type = typeof result.type === 'string' ? result.type.toLowerCase() : '';
	const resultClass = typeof result.class === 'string' ? result.class.toLowerCase() : '';
	const address =
		result.address && typeof result.address === 'object'
			? (result.address as Record<string, unknown>)
			: {};

	if (
		typeof address.house_number === 'string' ||
		type.includes('house') ||
		type.includes('building') ||
		resultClass.includes('building')
	) {
		return 'address';
	}
	if (resultClass.includes('highway') || type.includes('street') || type.includes('road')) {
		return 'street';
	}
	if (type.includes('postcode')) return 'postal';
	if (
		type.includes('neighbourhood') ||
		type.includes('neighborhood') ||
		type.includes('suburb') ||
		type.includes('quarter') ||
		type.includes('borough')
	) {
		return 'neighbourhood';
	}
	return 'place';
}

function precisionScore(precision: GeocodePrecision): number {
	switch (precision) {
		case 'address':
			return 100;
		case 'street':
			return 80;
		case 'neighbourhood':
			return 65;
		case 'postal':
			return 50;
		case 'place':
			return 35;
	}
}

function geoCaSourceScore(key: string): number {
	switch (key.toLowerCase()) {
		case 'locate':
			return 8;
		case 'nominatim':
			return 6;
		case 'fsa':
			return -8;
		case 'geonames':
			return -18;
		default:
			return 0;
	}
}

function geoCaRelevanceScore(query: string, label: string): number {
	const postalCode = extractCanadianPostalCode(query);
	let score = 0;
	if (postalCode && normalizeSearchText(label).includes(normalizeSearchText(postalCode)))
		score += 18;
	if (/^\s*\d+/.test(query) && /^\s*\d+/.test(label)) score += 14;
	return score;
}

function withEnglishMontrealContext(query: string): string {
	const trimmed = normalizePostalCodeInQuery(query.trim());
	if (!trimmed) return '';

	const lower = trimmed.toLowerCase();
	const parts = [trimmed];
	if (!lower.includes('montreal') && !lower.includes('montréal')) parts.push('Montreal');
	if (!lower.includes('quebec') && !lower.includes('québec')) parts.push('Quebec');
	if (!lower.includes('canada')) parts.push('Canada');
	return parts.join(' ');
}

function normalizeAddressIntentInQuery(query: string): string {
	return normalizePostalCodeInQuery(query.trim())
		.replace(/[.]/g, ' ')
		.replace(/\b(?:boul|boulv|blvd|bd)\b/gi, 'boulevard')
		.replace(/\b(?:av|ave)\b/gi, 'avenue')
		.replace(/\bch\b/gi, 'chemin')
		.replace(/\bste\b/gi, 'sainte')
		.replace(/\bst\b/gi, 'saint')
		.replace(/\s+/g, ' ')
		.trim();
}

function hasUsefulAutocompleteCandidates(
	query: string,
	results: readonly GeocodedLocation[],
): boolean {
	if (results.length === 0) return false;
	if (!isAddressIntentQuery(query)) return true;
	return results.some(isUsefulForAddressIntent);
}

function isAddressIntentQuery(query: string): boolean {
	const normalized = normalizeSearchText(query);
	return (
		/^\s*\d{1,6}\b/.test(query) ||
		CANADIAN_POSTAL_CODE_RE.test(query) ||
		/\b(?:rue|street|saint|sainte|st|ste|boul|boulv|boulevard|blvd|bd|av|ave|avenue|ch|chemin)\b/.test(
			normalized,
		)
	);
}

function isUsefulForAddressIntent(location: GeocodedLocation): boolean {
	return (
		location.precision === 'address' ||
		location.precision === 'street' ||
		location.precision === 'postal'
	);
}

function providerScore(source: GeocodedLocation['source']): number {
	return source === 'geo_ca' ? 2 : 0;
}

function normalizePostalCodeInQuery(query: string): string {
	return query.replace(CANADIAN_POSTAL_CODE_RE, (_, fsa: string, ldu: string) => {
		return `${fsa.toUpperCase()} ${ldu.toUpperCase()}`;
	});
}

function extractCanadianPostalCode(query: string): string | null {
	const match = query.match(CANADIAN_POSTAL_CODE_RE);
	if (!match) return null;
	return `${match[1]?.toUpperCase()} ${match[2]?.toUpperCase()}`;
}

function normalizeSearchText(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

function isInsideMontrealBounds(lat: number, lon: number): boolean {
	return (
		lat >= MONTREAL_BOUNDS.minLat &&
		lat <= MONTREAL_BOUNDS.maxLat &&
		lon >= MONTREAL_BOUNDS.minLon &&
		lon <= MONTREAL_BOUNDS.maxLon
	);
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers = vi.hoisted(() => ({
	geocode: vi.fn(),
	geocodeSuggestions: vi.fn(),
}));

vi.mock('$lib/geocode/geoCa', () => ({
	geocode: providers.geocode,
	geocodeSuggestions: providers.geocodeSuggestions,
}));

import { GET } from './+server';
import { loadProviderCatalog } from '$lib/v1/providers';
import { getManifest } from '$lib/v1/repositories/manifest';
vi.mock('$lib/v1/providers', () => ({ loadProviderCatalog: vi.fn() }));
vi.mock('$lib/v1/repositories/manifest', () => ({ getManifest: vi.fn() }));
const AREA = { bbox: [-74.1, 45.25, -73.2, 45.75], context: 'Montréal, Québec', lang: 'en' };

type Handler = typeof GET;
type HeaderValue = string | null;

const ORIGIN = 'https://transit.yesid.dev';
let clientSequence = 0;

function event(
	query: string,
	options: {
		headers?: Record<string, HeaderValue>;
		ip?: string | null;
		platformEnv?: Record<string, unknown>;
	} = {},
): Parameters<Handler>[0] {
	clientSequence += 1;
	const url = new URL(`/api/geocode${query}`, ORIGIN);
	if (!url.searchParams.has('provider')) url.searchParams.set('provider', 'stm');
	const headers = new Headers({
		'sec-fetch-site': 'same-origin',
		'cf-connecting-ip': options.ip ?? `test-client-${clientSequence}`,
	});
	if (options.ip === null) headers.delete('cf-connecting-ip');
	for (const [name, value] of Object.entries(options.headers ?? {})) {
		if (value == null) headers.delete(name);
		else headers.set(name, value);
	}
	return {
		url,
		request: { headers },
		fetch: vi.fn(),
		platform: options.platformEnv ? { env: options.platformEnv } : undefined,
	} as unknown as Parameters<Handler>[0];
}

function providerCallCount(): number {
	return Object.values(providers).reduce(
		(total, provider) => total + provider.mock.calls.length,
		0,
	);
}

async function responseBody(response: Response): Promise<unknown> {
	return JSON.parse(await response.text());
}

beforeEach(() => {
	clientSequence = 0;
	vi.mocked(loadProviderCatalog).mockResolvedValue({
		providers: [
			{ id: 'stm', geocode_context: AREA.context },
			{ id: 'octranspo', geocode_context: 'Ottawa, Ontario' },
		],
	} as never);
	vi.mocked(getManifest).mockResolvedValue({ provider: 'stm', bbox: AREA.bbox } as never);
	for (const provider of Object.values(providers)) provider.mockReset();
	providers.geocode.mockResolvedValue({
		lat: 45.5,
		lon: -73.6,
		label: 'Montréal',
		source: 'geo_ca',
		precision: 'place',
	});
	providers.geocodeSuggestions.mockResolvedValue([]);
});

afterEach(() => {
	vi.useRealTimers();
});

it('resolves Ottawa geography and French language before geocoding', async () => {
	const bbox = [-76.05, 45.1, -75.33, 45.55];
	vi.mocked(getManifest).mockResolvedValueOnce({ provider: 'octranspo', bbox } as never);
	const request = event('?q=Bank+Street&provider=octranspo&lang=fr');
	expect((await GET(request)).status).toBe(200);
	expect(getManifest).toHaveBeenLastCalledWith({ providerId: 'octranspo', fetch: request.fetch });
	expect(providers.geocode).toHaveBeenCalledWith(
		'Bank Street',
		{ bbox, context: 'Ottawa, Ontario', lang: 'fr' },
		request.fetch,
	);
});

it('rejects unknown or repeated providers without geocoding', async () => {
	for (const provider of ['unknown', 'stm&provider=octranspo']) {
		expect((await GET(event(`?q=Bank&provider=${provider}`))).status).toBe(400);
	}
	expect(providerCallCount()).toBe(0);
});

it('does not borrow another city when selected provider metadata is unavailable', async () => {
	vi.mocked(getManifest).mockRejectedValueOnce(new Error('offline'));
	const response = await GET(event('?q=Bank&provider=octranspo'));
	expect(response.status).toBe(503);
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(providerCallCount()).toBe(0);
});

describe('/api/geocode provenance gate', () => {
	it.each([
		['missing all provenance headers', { 'sec-fetch-site': null }],
		['a cross-site Fetch-Metadata value', { 'sec-fetch-site': 'cross-site' }],
		['a same-site Fetch-Metadata value', { 'sec-fetch-site': 'same-site' }],
		[
			'a matching Fetch-Metadata value plus mismatched Origin',
			{ 'sec-fetch-site': 'same-origin', origin: 'https://attacker.example' },
		],
		[
			'a matching Origin plus mismatched Referer',
			{
				'sec-fetch-site': null,
				origin: ORIGIN,
				referer: 'https://attacker.example/form',
			},
		],
		[
			'a mismatched Origin plus matching Referer',
			{
				'sec-fetch-site': null,
				origin: 'https://attacker.example',
				referer: `${ORIGIN}/metrics`,
			},
		],
		['Origin:null', { 'sec-fetch-site': null, origin: 'null' }],
		['a malformed Origin', { 'sec-fetch-site': null, origin: 'not a url' }],
		['a non-exact Origin serialization', { 'sec-fetch-site': null, origin: `${ORIGIN}/` }],
		['a malformed Referer', { 'sec-fetch-site': null, referer: 'not a url' }],
	] as const)('returns 403 with zero provider calls for %s', async (_case, headers) => {
		const response = await GET(event('?q=Montr%C3%A9al', { headers }));

		expect(response.status).toBe(403);
		expect(providerCallCount()).toBe(0);
	});

	it.each([
		['Origin', { origin: ORIGIN }],
		['Referer', { referer: `${ORIGIN}/metrics?from=nav` }],
	] as const)('accepts exact same-origin fallback provenance from %s', async (_case, fallback) => {
		const response = await GET(
			event('?q=Montr%C3%A9al', {
				headers: { 'sec-fetch-site': null, ...fallback },
			}),
		);

		expect(response.status).toBe(200);
		expect(providers.geocode).toHaveBeenCalledOnce();
	});

	it('runs provenance before mode parsing or the native rate decision', async () => {
		const limit = vi.fn().mockResolvedValue({ success: true });
		const response = await GET(
			event('?q=&placeId=legacy', {
				headers: { 'sec-fetch-site': null },
				platformEnv: { GEOCODE_RATE_LIMITER: { limit } },
			}),
		);

		expect(response.status).toBe(403);
		expect(limit).not.toHaveBeenCalled();
		expect(providerCallCount()).toBe(0);
	});
});

describe('/api/geocode input contract', () => {
	it.each([
		['neither mode', ''],
		['the removed placeId mode', '?placeId=ChIJabc'],
		['mixed q/placeId modes', '?q=Montr%C3%A9al&placeId=ChIJabc'],
		['a repeated q mode', '?q=Montr%C3%A9al&q=Laval'],
		['an empty query', '?q='],
		['a 161-code-point query', `?q=${'a'.repeat(161)}`],
		[
			'a query whose raw length exceeds the bound using surrounding whitespace',
			`?q=${encodeURIComponent(`${' '.repeat(160)}a`)}`,
		],
		['a query containing a control character', `?q=${encodeURIComponent('rue\nBerri')}`],
		['the removed session parameter', '?q=Montr%C3%A9al&session=legacy'],
	] as const)('returns 400 with zero provider calls for %s', async (_case, query) => {
		const response = await GET(event(query));

		expect(response.status).toBe(400);
		expect(providerCallCount()).toBe(0);
	});

	it('preserves a printable Unicode query through validation', async () => {
		const query = 'École Polytechnique 🚌';
		const response = await GET(event(`?q=${encodeURIComponent(query)}`));

		expect(response.status).toBe(200);
		expect(providers.geocode).toHaveBeenCalledWith(query, AREA, expect.any(Function));
	});

	it('accepts the exact query upper bound', async () => {
		const queryResponse = await GET(event(`?q=${'é'.repeat(160)}`));

		expect(queryResponse.status).toBe(200);
	});

	it('serves Geo.ca suggestions without a provider session', async () => {
		providers.geocodeSuggestions.mockResolvedValueOnce([
			{
				lat: 45.5,
				lon: -73.6,
				label: 'Montréal',
				source: 'geo_ca',
				precision: 'place',
			},
		]);

		const response = await GET(event('?q=Montr%C3%A9al&suggest=1&limit=4'));

		expect(response.status).toBe(200);
		expect(providers.geocodeSuggestions).toHaveBeenCalledWith(
			'Montréal',
			AREA,
			expect.any(Function),
			4,
		);
		expect(await responseBody(response)).toEqual({
			results: [
				{
					lat: 45.5,
					lon: -73.6,
					label: 'Montréal',
					source: 'geo_ca',
					precision: 'place',
				},
			],
		});
	});

	it('runs exact-mode parsing and validation before the native rate decision', async () => {
		const limit = vi.fn().mockResolvedValue({ success: true });
		const response = await GET(
			event('?q=&placeId=legacy', {
				platformEnv: { GEOCODE_RATE_LIMITER: { limit } },
			}),
		);

		expect(response.status).toBe(400);
		expect(await responseBody(response)).toEqual({ error: 'invalid_mode' });
		expect(limit).not.toHaveBeenCalled();
		expect(providerCallCount()).toBe(0);
	});
});

describe('/api/geocode privacy cache contract', () => {
	it('marks Geo.ca suggestions private and non-cacheable', async () => {
		providers.geocodeSuggestions.mockResolvedValueOnce([
			{
				lat: 45.5,
				lon: -73.6,
				label: 'Montréal',
				source: 'geo_ca',
				precision: 'place',
			},
		]);

		const response = await GET(event('?q=Montr%C3%A9al&suggest=1'));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('marks a missing text-geocode result private and non-cacheable', async () => {
		providers.geocode.mockResolvedValueOnce(null);

		const response = await GET(event('?q=Montr%C3%A9al'));

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('marks a resolved text-geocode result private and non-cacheable', async () => {
		const response = await GET(event('?q=Montr%C3%A9al'));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});
});

describe('/api/geocode limiter', () => {
	it.each([
		{ cadenceMs: 121, acceptedCalls: 61, deniedCall: 62, ip: '198.51.100.80' },
		{ cadenceMs: 251, acceptedCalls: 71, deniedCall: 72, ip: '198.51.100.82' },
	])(
		'denies call $deniedCall at $cadenceMs ms with no provider call and the 429 contract',
		async ({ cadenceMs, acceptedCalls, ip }) => {
			vi.useFakeTimers();
			const startedMs = Date.parse('2026-07-30T12:00:00Z');

			for (let index = 0; index < acceptedCalls; index += 1) {
				vi.setSystemTime(startedMs + index * cadenceMs);
				const response = await GET(event('?q=Montr%C3%A9al', { ip }));
				expect(response.status).toBe(200);
			}
			const callsBeforeDenial = providerCallCount();
			vi.setSystemTime(startedMs + acceptedCalls * cadenceMs);

			const denied = await GET(event('?q=Montr%C3%A9al', { ip }));

			expect(denied.status).toBe(429);
			expect(await responseBody(denied)).toEqual({ error: 'rate_limited' });
			expect(denied.headers.get('retry-after')).toBe('1');
			expect(denied.headers.get('cache-control')).toBe('no-store');
			expect(providerCallCount()).toBe(callsBeforeDenial);
		},
	);

	it('uses the conservative shared bucket when CF-Connecting-IP is missing', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-30T12:00:00Z'));

		for (let index = 0; index < 24; index += 1) {
			const response = await GET(event('?q=Montr%C3%A9al', { ip: null }));
			expect(response.status).toBe(200);
		}
		const callsBeforeDenial = providerCallCount();

		const denied = await GET(event('?q=Montr%C3%A9al', { ip: null }));

		expect(denied.status).toBe(429);
		expect(denied.headers.get('retry-after')).toBe('4');
		expect(providerCallCount()).toBe(callsBeforeDenial);
	});

	it('uses the ready native binding seam instead of the isolate bucket when configured', async () => {
		const limit = vi.fn().mockResolvedValue({ success: false });

		const response = await GET(
			event('?q=Montr%C3%A9al', {
				ip: '198.51.100.81',
				platformEnv: { GEOCODE_RATE_LIMITER: { limit } },
			}),
		);

		expect(response.status).toBe(429);
		expect(limit).toHaveBeenCalledWith({ key: '198.51.100.81' });
		expect(response.headers.get('retry-after')).toBe('60');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(providerCallCount()).toBe(0);
	});

	it('routes a missing IP through the shared native binding and key', async () => {
		const limit = vi.fn().mockResolvedValue({ success: false });

		const response = await GET(
			event('?q=Montr%C3%A9al', {
				ip: null,
				platformEnv: { GEOCODE_SHARED_RATE_LIMITER: { limit } },
			}),
		);

		expect(response.status).toBe(429);
		expect(limit).toHaveBeenCalledWith({ key: '__missing_cf_connecting_ip__' });
		expect(response.headers.get('retry-after')).toBe('60');
		expect(providerCallCount()).toBe(0);
	});
});

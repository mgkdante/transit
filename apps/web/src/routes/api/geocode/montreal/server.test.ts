import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers = vi.hoisted(() => ({
	geocodeMontreal: vi.fn(),
	geocodeMontrealSuggestions: vi.fn(),
}));

vi.mock('$lib/geocode/geoCa', () => ({
	geocodeMontreal: providers.geocodeMontreal,
	geocodeMontrealSuggestions: providers.geocodeMontrealSuggestions,
}));

import { GET } from './+server';

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
	const url = new URL(`/api/geocode/montreal${query}`, ORIGIN);
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
	for (const provider of Object.values(providers)) provider.mockReset();
	providers.geocodeMontreal.mockResolvedValue({
		lat: 45.5,
		lon: -73.6,
		label: 'Montréal',
		source: 'geo_ca',
		precision: 'place',
	});
	providers.geocodeMontrealSuggestions.mockResolvedValue([]);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('/api/geocode/montreal provenance gate', () => {
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
		expect(providers.geocodeMontreal).toHaveBeenCalledOnce();
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

describe('/api/geocode/montreal input contract', () => {
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
		expect(providers.geocodeMontreal).toHaveBeenCalledWith(query, expect.any(Function));
	});

	it('accepts the exact query upper bound', async () => {
		const queryResponse = await GET(event(`?q=${'é'.repeat(160)}`));

		expect(queryResponse.status).toBe(200);
	});

	it('serves Geo.ca suggestions without a provider session', async () => {
		providers.geocodeMontrealSuggestions.mockResolvedValueOnce([
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
		expect(providers.geocodeMontrealSuggestions).toHaveBeenCalledWith(
			'Montréal',
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

describe('/api/geocode/montreal privacy cache contract', () => {
	it('marks Geo.ca suggestions private and non-cacheable', async () => {
		providers.geocodeMontrealSuggestions.mockResolvedValueOnce([
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
		providers.geocodeMontreal.mockResolvedValueOnce(null);

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

describe('/api/geocode/montreal limiter', () => {
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

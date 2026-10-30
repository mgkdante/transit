import { beforeEach, describe, expect, it, vi } from 'vitest';
import catalog from '../../../e2e/providers.json';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

const getRoutesIndex = vi.fn();
const getStopsIndex = vi.fn();
const loadProviderCatalog = vi.fn();

vi.mock('$lib/v1/providers', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/v1/providers')>()),
	loadProviderCatalog: (...args: unknown[]) => loadProviderCatalog(...args),
}));

vi.mock('$lib/v1/repositories/static', () => ({
	getRoutesIndex: (...args: unknown[]) => getRoutesIndex(...args),
	getStopsIndex: (...args: unknown[]) => getStopsIndex(...args),
}));

vi.mock('$lib/site/config', () => ({
	readPublicSiteConfig: () => ({ siteOrigin: 'https://transit.yesid.dev', indexing: true }),
}));

import { GET } from './+server';

type Handler = typeof GET;

const ORIGIN = 'https://transit.yesid.dev';

function event(opts: { binding?: unknown; snapshots?: unknown; search?: string } = {}) {
	const env = {
		...(opts.binding === undefined ? {} : { DATA: opts.binding }),
		...(opts.snapshots === undefined ? {} : { SNAPSHOTS: opts.snapshots }),
	};
	return {
		fetch: vi.fn(),
		locals: {},
		url: new URL(`${ORIGIN}/sitemap.xml${opts.search ?? ''}`),
		platform: Object.keys(env).length === 0 ? undefined : { env },
	} as unknown as Parameters<Handler>[0];
}

async function bodyOf(response: Response): Promise<string> {
	return await response.text();
}

beforeEach(() => {
	getRoutesIndex.mockReset();
	getStopsIndex.mockReset();
	loadProviderCatalog.mockReset();
	loadProviderCatalog.mockResolvedValue(catalog);
});

describe('sitemap.xml handler', () => {
	it('carries validated OC identity into every entity and alternate URL', async () => {
		getRoutesIndex.mockResolvedValue({ routes: [{ id: '5' }] });
		getStopsIndex.mockResolvedValue({ stops: [{ id: 'OC1' }] });
		const response = await GET(
			event({ snapshots: { get: vi.fn() }, search: '?provider=octranspo' }),
		);
		const xml = await response.text();
		expect(xml).toContain(`<loc>${ORIGIN}/lines/5?provider=octranspo</loc>`);
		expect(xml).toContain(`hreflang="fr" href="${ORIGIN}/fr/lines/5?provider=octranspo"`);
		expect(getRoutesIndex.mock.calls[0]?.[0]).toMatchObject({ providerId: 'octranspo' });
	});

	it('normalizes an invalid provider before reading that namespace', async () => {
		const response = await GET(event({ snapshots: { get: vi.fn() }, search: '?provider=unknown' }));
		expect(response.status).toBe(307);
		expect(response.headers.get('location')).toBe('/sitemap.xml?provider=stm');
		expect(getRoutesIndex).not.toHaveBeenCalled();
	});

	it('(a) direct R2 snapshot binding + indexing on: enumerates entity URLs', async () => {
		getRoutesIndex.mockResolvedValue({
			generated_utc: '2026-06-20T07:00:00Z',
			routes: [{ id: '11' }, { id: '747' }],
		});
		getStopsIndex.mockResolvedValue({
			generated_utc: '2026-06-20T07:00:00Z',
			stops: [{ id: '10001' }],
		});

		const res = await GET(event({ snapshots: { get: vi.fn() } }));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/xml');
		const xml = await bodyOf(res);

		expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
		expect(xml).toContain(`<loc>${ORIGIN}/lines/11</loc>`);
		expect(xml).toContain(`<loc>${ORIGIN}/fr/lines/11</loc>`);
		expect(xml).toContain(`<loc>${ORIGIN}/lines/747</loc>`);
		expect(xml).toContain(`<loc>${ORIGIN}/stop/10001</loc>`);
		expect(xml).toContain(`<lastmod>${new Date('2026-06-20T07:00:00Z').toISOString()}</lastmod>`);
		expect(getRoutesIndex).toHaveBeenCalledTimes(1);
		expect(getStopsIndex).toHaveBeenCalledTimes(1);
	});

	it('(b) a thrown index fetch: degrades to static-only, no 500', async () => {
		getRoutesIndex.mockRejectedValue(new Error('data-proxy down'));
		getStopsIndex.mockResolvedValue({ generated_utc: null, stops: [{ id: '10001' }] });

		const res = await GET(event({ binding: { fetch: vi.fn() } }));
		expect(res.status).toBe(200);
		const xml = await bodyOf(res);

		expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
		expect(xml).not.toContain('/lines/');
		expect(xml).not.toContain('/stop/');
	});

	it('(c) no binding: static-only sitemap, loaders never called', async () => {
		const res = await GET(event());
		expect(res.status).toBe(200);
		const xml = await bodyOf(res);

		expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
		expect(xml).not.toContain('/lines/');
		expect(xml).not.toContain('/stop/');
		expect(getRoutesIndex).not.toHaveBeenCalled();
		expect(getStopsIndex).not.toHaveBeenCalled();
	});
});

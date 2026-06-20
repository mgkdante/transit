import { beforeEach, describe, expect, it, vi } from 'vitest';

// Handler test for the DYNAMIC sitemap endpoint. The pure builders are covered
// in src/lib/site/seoFiles.test.ts; here we exercise the wiring + fail-soft:
//   (a) binding present + indexing on  -> entity URLs appear,
//   (b) a thrown index fetch           -> degrades to static-only (no 500),
//   (c) no binding                     -> static-only.
//
// We mock the v1 loaders ($lib/v1) and the binding wrapper ($lib/v1/binding) so
// no real fetch happens, and pin indexing on via $lib/site/config.

const getRoutesIndex = vi.fn();
const getStopsIndex = vi.fn();

vi.mock('$lib/v1', () => ({
	getRoutesIndex: (...args: unknown[]) => getRoutesIndex(...args),
	getStopsIndex: (...args: unknown[]) => getStopsIndex(...args),
}));

// bindingFetch must NOT touch a real binding in the test — return a throwing
// stub fetch (the handler never calls it directly; the mocked loaders do).
vi.mock('$lib/v1/binding', () => ({
	bindingFetch: () => () => {
		throw new Error('no network in tests');
	},
}));

// Pin indexing on with a known origin (avoids depending on env in the harness).
vi.mock('$lib/site/config', () => ({
	readPublicSiteConfig: () => ({ siteOrigin: 'https://transit.yesid.dev', indexing: true }),
}));

import { GET } from './+server';

type Handler = typeof GET;

const ORIGIN = 'https://transit.yesid.dev';

/** Minimal RequestEvent shape the handler reads: `url` + `platform.env.DATA`. */
function event(opts: { binding?: unknown } = {}) {
	return {
		url: new URL(`${ORIGIN}/sitemap.xml`),
		platform: opts.binding === undefined ? undefined : { env: { DATA: opts.binding } },
	} as unknown as Parameters<Handler>[0];
}

async function bodyOf(response: Response): Promise<string> {
	return await response.text();
}

beforeEach(() => {
	getRoutesIndex.mockReset();
	getStopsIndex.mockReset();
});

describe('sitemap.xml handler', () => {
	it('(a) binding present + indexing on: enumerates entity URLs', async () => {
		getRoutesIndex.mockResolvedValue({
			generated_utc: '2026-06-20T07:00:00Z',
			routes: [{ id: '11' }, { id: '747' }],
		});
		getStopsIndex.mockResolvedValue({
			generated_utc: '2026-06-20T07:00:00Z',
			stops: [{ id: '10001' }],
		});

		const res = await GET(event({ binding: { fetch: vi.fn() } }));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/xml');
		const xml = await bodyOf(res);

		// Static surfaces survive AND the entity URLs appear in both locales.
		expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
		expect(xml).toContain(`<loc>${ORIGIN}/route/11</loc>`);
		expect(xml).toContain(`<loc>${ORIGIN}/fr/route/11</loc>`);
		expect(xml).toContain(`<loc>${ORIGIN}/route/747</loc>`);
		expect(xml).toContain(`<loc>${ORIGIN}/stop/10001</loc>`);
		// lastmod sourced from the index generated_utc (never fabricated).
		expect(xml).toContain(`<lastmod>${new Date('2026-06-20T07:00:00Z').toISOString()}</lastmod>`);
		// Both index loaders ran (and no third manifest fetch is wired here).
		expect(getRoutesIndex).toHaveBeenCalledTimes(1);
		expect(getStopsIndex).toHaveBeenCalledTimes(1);
	});

	it('(b) a thrown index fetch: degrades to static-only, no 500', async () => {
		getRoutesIndex.mockRejectedValue(new Error('data-proxy down'));
		getStopsIndex.mockResolvedValue({ generated_utc: null, stops: [{ id: '10001' }] });

		const res = await GET(event({ binding: { fetch: vi.fn() } }));
		expect(res.status).toBe(200); // never a 500
		const xml = await bodyOf(res);

		// Static URLs survive; entity URLs are absent (fail-soft never invents them).
		expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
		expect(xml).not.toContain('/route/');
		expect(xml).not.toContain('/stop/');
	});

	it('(c) no binding: static-only sitemap, loaders never called', async () => {
		const res = await GET(event()); // platform undefined
		expect(res.status).toBe(200);
		const xml = await bodyOf(res);

		expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
		expect(xml).not.toContain('/route/');
		expect(xml).not.toContain('/stop/');
		expect(getRoutesIndex).not.toHaveBeenCalled();
		expect(getStopsIndex).not.toHaveBeenCalled();
	});
});

import { describe, expect, it } from 'vitest';
import { GET, HEAD } from './+server';

// The legacy /route/[id] -> /lines/[id] redirect (S6 consolidation). SvelteKit 2
// `redirect()` throws an internal Redirect ({ status, location }); we catch it and
// assert the status + Location, mirroring the locale-prefix + query-preserving
// + id-encoding contract the handler promises.

type Handler = typeof GET;

function event(opts: { lang?: string; id: string; search?: string }) {
	const prefix = opts.lang ? `/${opts.lang}` : '';
	const encoded = encodeURIComponent(opts.id);
	return {
		params: { lang: opts.lang, id: opts.id },
		url: new URL(`https://transit.yesid.dev${prefix}/route/${encoded}${opts.search ?? ''}`),
	} as unknown as Parameters<Handler>[0];
}

function caughtRedirect(fn: () => unknown): { status: number; location: string } {
	try {
		fn();
	} catch (thrown) {
		return thrown as { status: number; location: string };
	}
	throw new Error('expected GET to throw a redirect');
}

describe('legacy /route/[id] -> /lines/[id] redirect', () => {
	it('301-redirects the EN (unprefixed) path to the new canonical detail path', () => {
		const r = caughtRedirect(() => GET(event({ id: '161' })));
		expect(r.status).toBe(301);
		expect(r.location).toBe('/lines/161');
	});

	it('preserves the /fr locale prefix and any query string', () => {
		const r = caughtRedirect(() => GET(event({ lang: 'fr', id: '161', search: '?tab=schedule' })));
		expect(r.status).toBe(301);
		expect(r.location).toBe('/fr/lines/161?tab=schedule');
	});

	it('percent-encodes an id with a space, matching routeFor()', () => {
		const r = caughtRedirect(() => GET(event({ id: '10 A' })));
		expect(r.location).toBe('/lines/10%20A');
	});

	it('also 301-redirects HEAD (endpoint routes do not synthesize HEAD from GET)', () => {
		const r = caughtRedirect(() => HEAD(event({ id: '161' })));
		expect(r.status).toBe(301);
		expect(r.location).toBe('/lines/161');
	});
});

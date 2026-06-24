import { describe, expect, it } from 'vitest';
import {
	cacheNameFor,
	DATA_PATH_PREFIX,
	isDataRequest,
	isKillFlagRequest,
	isNavigationRequest,
	isShellAsset,
	KILL_FLAG_PATH,
	precachePathnames,
	shouldHandle,
	shouldKill,
} from './swPolicy';

const ORIGIN = 'https://transit.yesid.dev';
const u = (path: string) => new URL(path, ORIGIN);

describe('isDataRequest — live data NEVER cached', () => {
	it('matches the /data/* mount', () => {
		expect(isDataRequest(u('/data/v1/stm/live/network.json'))).toBe(true);
		expect(isDataRequest(u('/data/v1/stm/manifest.json'))).toBe(true);
		expect(isDataRequest(u('/data'))).toBe(true);
	});

	it('matches any /v1/ snapshot segment defensively', () => {
		expect(isDataRequest(u('/v1/stm/live/network.json'))).toBe(true);
		expect(isDataRequest(u('/somebase/v1/stm/static/routes/97.json'))).toBe(true);
	});

	it('does not match shell/static paths', () => {
		expect(isDataRequest(u('/_app/immutable/chunk.abc123.js'))).toBe(false);
		expect(isDataRequest(u('/fonts/inter.woff2'))).toBe(false);
		expect(isDataRequest(u('/'))).toBe(false);
		expect(isDataRequest(u('/lines/97'))).toBe(false);
	});

	it('exposes the canonical data prefix constant', () => {
		expect(DATA_PATH_PREFIX).toBe('/data/');
	});
});

describe('isKillFlagRequest', () => {
	it('matches exactly the kill-flag path', () => {
		expect(isKillFlagRequest(u(KILL_FLAG_PATH))).toBe(true);
		expect(isKillFlagRequest(u('/sw-kill.json'))).toBe(true);
		expect(isKillFlagRequest(u('/sw-kill.json.bak'))).toBe(false);
		expect(isKillFlagRequest(u('/'))).toBe(false);
	});
});

describe('isShellAsset — cache-first only for hashed/static shell', () => {
	const precache = new Set(['/favicon.svg', '/offline.html', '/fonts/inter.woff2']);

	it('treats /_app/immutable/* as a shell asset', () => {
		expect(isShellAsset(u('/_app/immutable/entry/start.abc.js'), precache)).toBe(true);
	});

	it('treats precached static files as shell assets', () => {
		expect(isShellAsset(u('/favicon.svg'), precache)).toBe(true);
		expect(isShellAsset(u('/offline.html'), precache)).toBe(true);
		expect(isShellAsset(u('/fonts/inter.woff2'), precache)).toBe(true);
	});

	it('NEVER treats data or kill-flag as shell assets', () => {
		expect(isShellAsset(u('/data/v1/stm/live/network.json'), precache)).toBe(false);
		expect(isShellAsset(u('/sw-kill.json'), precache)).toBe(false);
	});

	it('does not treat arbitrary paths as shell assets', () => {
		expect(isShellAsset(u('/lines/97'), precache)).toBe(false);
		expect(isShellAsset(u('/some-random.js'), precache)).toBe(false);
	});
});

describe('isNavigationRequest — network-first targets', () => {
	it('matches mode=navigate', () => {
		expect(isNavigationRequest({ mode: 'navigate' })).toBe(true);
	});

	it('matches Accept: text/html', () => {
		expect(
			isNavigationRequest({
				mode: 'cors',
				headers: { get: (n) => (n.toLowerCase() === 'accept' ? 'text/html,*/*' : null) },
			}),
		).toBe(true);
	});

	it('does not match a plain asset request', () => {
		expect(
			isNavigationRequest({
				mode: 'cors',
				headers: { get: () => 'application/javascript' },
			}),
		).toBe(false);
	});
});

describe('shouldHandle — scope guard', () => {
	const headers = (h: Record<string, string> = {}) => ({
		get: (n: string) => h[n.toLowerCase()] ?? null,
	});

	it('handles same-origin GET non-range non-data', () => {
		expect(shouldHandle({ method: 'GET', headers: headers() }, u('/lines/97'), ORIGIN)).toBe(true);
	});

	it('skips non-GET', () => {
		expect(shouldHandle({ method: 'POST', headers: headers() }, u('/lines/97'), ORIGIN)).toBe(
			false,
		);
	});

	it('skips cross-origin', () => {
		expect(
			shouldHandle(
				{ method: 'GET', headers: headers() },
				new URL('https://protomaps.github.io/x.pbf'),
				ORIGIN,
			),
		).toBe(false);
	});

	it('skips Range requests (pmtiles / partial content)', () => {
		expect(
			shouldHandle(
				{ method: 'GET', headers: headers({ range: 'bytes=0-1023' }) },
				u('/something.pmtiles'),
				ORIGIN,
			),
		).toBe(false);
	});

	it('skips the data origin (passthrough)', () => {
		expect(
			shouldHandle(
				{ method: 'GET', headers: headers() },
				u('/data/v1/stm/live/network.json'),
				ORIGIN,
			),
		).toBe(false);
	});

	it('skips the kill-flag (the SW fetches it directly)', () => {
		expect(shouldHandle({ method: 'GET', headers: headers() }, u('/sw-kill.json'), ORIGIN)).toBe(
			false,
		);
	});
});

describe('shouldKill — remote kill-switch decision', () => {
	it('kills only on explicit disabled:true', () => {
		expect(shouldKill({ disabled: true })).toBe(true);
	});

	it('fail-open: does not kill on false / missing / null', () => {
		expect(shouldKill({ disabled: false })).toBe(false);
		expect(shouldKill({})).toBe(false);
		expect(shouldKill(null)).toBe(false);
		expect(shouldKill(undefined)).toBe(false);
	});
});

describe('cacheNameFor', () => {
	it('produces a versioned cache name', () => {
		expect(cacheNameFor('1718900000000')).toBe('transit-shell-1718900000000');
		expect(cacheNameFor('abc')).not.toBe(cacheNameFor('def'));
	});
});

describe('precachePathnames', () => {
	it('normalizes build/static URLs to pathnames and includes the offline page', () => {
		const set = precachePathnames(
			['/_app/immutable/start.abc.js', './favicon.svg', `${ORIGIN}/fonts/inter.woff2`],
			ORIGIN,
			'/offline.html',
		);
		expect(set.has('/_app/immutable/start.abc.js')).toBe(true);
		expect(set.has('/favicon.svg')).toBe(true);
		expect(set.has('/fonts/inter.woff2')).toBe(true);
		expect(set.has('/offline.html')).toBe(true);
	});

	it('skips unparseable entries without throwing', () => {
		const set = precachePathnames(['://://bad', '/ok.js'], ORIGIN, '/offline.html');
		expect(set.has('/ok.js')).toBe(true);
		expect(set.has('/offline.html')).toBe(true);
	});
});

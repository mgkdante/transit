// @vitest-environment node
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Cookies } from '@sveltejs/kit';
import { describe, expect, expectTypeOf, it } from 'vitest';

const require = createRequire(import.meta.url);
const kitDirectory = dirname(require.resolve('@sveltejs/kit/package.json'));
const kitCookies = await import(
	pathToFileURL(join(kitDirectory, 'src/runtime/server/cookie.js')).href
);
const wranglerRequire = createRequire(require.resolve('wrangler/package.json'));
const miniflareRequire = createRequire(wranglerRequire.resolve('miniflare'));
const { Youch } = await import(pathToFileURL(miniflareRequire.resolve('youch')).href);

describe('cookie override compatibility', () => {
	it('preserves SvelteKit cookie types, decoding and response serialization', () => {
		expectTypeOf<Parameters<Cookies['set']>[2]['maxAge']>().toEqualTypeOf<number | undefined>();
		const url = new URL('https://transit.example/lines/24');
		const request = new Request(url, { headers: { cookie: 'locale=fr; note=hello%20world' } });
		const state = kitCookies.get_cookies(request, url);
		state.set_trailing_slash('never');
		const cookies: Cookies = state.cookies;

		expect(cookies.get('note')).toBe('hello world');
		expect(cookies.getAll()).toEqual([
			{ name: 'locale', value: 'fr' },
			{ name: 'note', value: 'hello world' },
		]);
		cookies.set('view', 'map', { path: '/', maxAge: 60 });
		expect(cookies.get('view')).toBe('map');
		expect(cookies.serialize('note', 'hello world', { path: '/' })).toBe(
			'note=hello%20world; Path=/; HttpOnly; Secure; SameSite=Lax',
		);
		cookies.delete('view', { path: '/' });
		expect(cookies.get('view')).toBeUndefined();
		const headers = new Headers();
		kitCookies.add_cookies_to_headers(headers, Array.from(state.new_cookies.values()));
		expect(headers.get('set-cookie')).toContain('view=; Max-Age=0; Path=/');
	});

	it('renders Youch request-cookie metadata through Wrangler’s dependency graph', async () => {
		const error = new Error('Preview compatibility check');
		error.stack = '';
		const html = await new Youch().toHTML(error, {
			request: { method: 'GET', url: '/map', headers: { cookie: 'locale=fr; note=hello%20world' } },
		});
		expect(html).toContain('Preview compatibility check');
		expect(html).toContain('locale');
		expect(html).toContain('hello world');
	});
});

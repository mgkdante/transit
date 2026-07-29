import { describe, expect, it } from 'vitest';
import { match } from '../../params/locale';
import { isPrefixLocale, type Locale } from './index';
import {
	delocalizePath,
	isLocaleSwitch,
	localizeHref,
	localizeUrl,
	pathLocale,
	stripLocaleSegment,
} from './routing';

// localizeHref's non-prefix-locale branch is deliberately uncovered with 'de':
// Locale is 'en' | 'fr', so that call is uninhabited without a cast.

describe('Transit locale routing wrapper', () => {
	it('preserves locale levers and core path behavior', () => {
		const pathLocaleFixtures: readonly [string, Locale][] = [
			['', 'en'],
			['/', 'en'],
			['/fr', 'fr'],
			['/fr/about', 'fr'],
			['/france', 'en'],
			['/es/about', 'en'],
		];
		const delocalizeFixtures: readonly [string, string][] = [
			['', '/'],
			['/fr', '/'],
			['/fr/', '/'],
			['/fr//', '//'],
			['/fr/about', '/about'],
			['/es/about', '/es/about'],
			['/fr/fr/about', '/fr/about'],
		];
		const localizeFixtures: readonly [string, Locale, string][] = [
			['/about', 'en', '/about'],
			['/about', 'fr', '/fr/about'],
			['/fr/about', 'en', '/about'],
			['/fr/about', 'fr', '/fr/about'],
		];
		const switchFixtures: readonly [string, string, boolean][] = [
			['/about', '/fr/about', true],
			['/fr/about', '/about', true],
			['/about', '/about', false],
			['/about', '/blog/some-post', false],
			['/about', '/fr/blog/some-post', false],
		];

		for (const [pathname, expected] of pathLocaleFixtures) {
			expect(pathLocale(pathname)).toBe(expected);
		}
		for (const [pathname, expected] of delocalizeFixtures) {
			expect(delocalizePath(pathname)).toBe(expected);
		}
		for (const [href, locale, expected] of localizeFixtures) {
			expect(localizeHref(href, locale)).toBe(expected);
		}
		for (const [fromPathname, toPathname, expected] of switchFixtures) {
			expect(isLocaleSwitch(fromPathname, toPathname)).toBe(expected);
		}
	});

	it('preserves universal and Transit-specific exemption behavior', () => {
		const fixtures: readonly [string, string][] = [
			['#section', '#section'],
			['mailto:a@b.c', 'mailto:a@b.c'],
			['tel:+1', 'tel:+1'],
			['https://x.com/y', 'https://x.com/y'],
			['//cdn.example/f.js', '//cdn.example/f.js'],
			['about', 'about'],
			['./about', './about'],
			['../about', '../about'],
			['/api/', '/api/'],
			['/api/weather', '/api/weather'],
			['/sitemap.xml', '/sitemap.xml'],
			['/robots.txt', '/robots.txt'],
			['/manifest.webmanifest', '/manifest.webmanifest'],
			['/v1/network.json', '/v1/network.json'],
			['/A.PNG', '/A.PNG'],
			['/api', '/fr/api'],
			['/work', '/fr/work'],
			['/sitemap.xml/', '/fr/sitemap.xml/'],
		];

		for (const [href, expected] of fixtures) {
			expect(localizeHref(href, 'fr')).toBe(expected);
		}
	});

	it('preserves search and hash while localizing URL pathnames', () => {
		const fixtures: readonly [string, Locale, string][] = [
			['/x?y=1#h', 'fr', '/fr/x?y=1#h'],
			['/fr/x?y=1#h', 'en', '/x?y=1#h'],
			['/api/weather?a=1', 'fr', '/api/weather?a=1'],
			['/work?a=1', 'fr', '/fr/work?a=1'],
			['/sitemap.xml?a=1', 'fr', '/sitemap.xml?a=1'],
			['/og/d.png#z', 'fr', '/og/d.png#z'],
			['/v1/n.json?a=1', 'fr', '/v1/n.json?a=1'],
		];

		for (const [href, locale, expected] of fixtures) {
			expect(localizeUrl(new URL(href, 'https://example.test'), locale)).toBe(expected);
		}
	});

	it('preserves route-id stripping, the barrel predicate, and matcher wiring', () => {
		const routeIdFixtures: readonly [string, string][] = [
			['/', '/'],
			['/[[lang=locale]]', '/'],
			['/[[lang=locale]]/about', '/about'],
			['/[[lang=locale]]/a/[id]', '/a/[id]'],
			['/[[lang=locale]]x', '/[[lang=locale]]x'],
			['/[[lang=locale]]/', '/'],
			['/__error', '/__error'],
			['/og/[type]/[slug].png', '/og/[type]/[slug].png'],
		];
		const matcherFixtures: readonly [string, boolean][] = [
			['fr', true],
			['es', false],
			['en', false],
			['', false],
			['FR', false],
			['france', false],
			['about', false],
			['/fr', false],
			['de', false],
		];

		for (const [routeId, expected] of routeIdFixtures) {
			expect(stripLocaleSegment(routeId)).toBe(expected);
		}
		for (const [segment, expected] of matcherFixtures) {
			expect(isPrefixLocale(segment)).toBe(expected);
			expect(match(segment)).toBe(expected);
		}
	});
});

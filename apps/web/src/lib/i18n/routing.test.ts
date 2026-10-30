import { describe, expect, it } from 'vitest';
import { match } from '../../params/locale';
import { isPrefixLocale } from './index';
import { localizeHref } from './routing';

describe('Transit locale routing wrapper', () => {
	it('retains the provider on internal links without changing external or API destinations', () => {
		expect(localizeHref('/map?vehicle=42#details', 'fr', 'octranspo')).toBe(
			'/fr/map?vehicle=42&provider=octranspo#details',
		);
		expect(localizeHref('/fr/lines?provider=stm', 'en', 'octranspo')).toBe(
			'/lines?provider=octranspo',
		);
		for (const href of ['https://yesid.dev', '/api/stops/slim', '#details']) {
			expect(localizeHref(href, 'en', 'octranspo')).toBe(href);
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

	it('preserves route-id stripping, the barrel predicate, and matcher wiring', () => {
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

		for (const [segment, expected] of matcherFixtures) {
			expect(isPrefixLocale(segment)).toBe(expected);
			expect(match(segment)).toBe(expected);
		}
	});
});

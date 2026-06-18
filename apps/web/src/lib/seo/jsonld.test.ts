import { describe, it, expect } from 'vitest';
import { websiteJsonLd } from './jsonld';

const ORIGIN = 'https://transit.yesid.dev';
const NAME = 'Transit · STM Analytics';

describe('websiteJsonLd', () => {
	it('is a schema.org WebSite node carrying name + url + inLanguage', () => {
		const node = websiteJsonLd({ siteOrigin: ORIGIN, siteName: NAME });
		expect(node['@context']).toBe('https://schema.org');
		expect(node['@type']).toBe('WebSite');
		expect(node.name).toBe(NAME);
		expect(node.url).toBe(ORIGIN);
		expect(node.inLanguage).toBe('en');
	});

	it('threads the active locale into inLanguage', () => {
		expect(websiteJsonLd({ siteOrigin: ORIGIN, siteName: NAME, locale: 'fr' }).inLanguage).toBe(
			'fr',
		);
	});

	it('exposes a SearchAction whose target template is the in-site search with {query}', () => {
		const action = websiteJsonLd({ siteOrigin: ORIGIN, siteName: NAME }).potentialAction as {
			'@type': string;
			target: { '@type': string; urlTemplate: string };
			'query-input': string;
		};
		expect(action['@type']).toBe('SearchAction');
		expect(action.target.urlTemplate).toBe(`${ORIGIN}/search?q={query}`);
		expect(action['query-input']).toBe('required name=query');
	});

	it('round-trips through JSON.stringify/parse unchanged', () => {
		const node = websiteJsonLd({ siteOrigin: ORIGIN, siteName: NAME });
		expect(JSON.parse(JSON.stringify(node))).toEqual(node);
	});
});

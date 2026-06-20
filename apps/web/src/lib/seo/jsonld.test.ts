import { describe, it, expect } from 'vitest';
import {
	websiteJsonLd,
	breadcrumbJsonLd,
	organizationJsonLd,
	datasetJsonLd,
	DATASET_LICENSE_URL,
} from './jsonld';

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

describe('breadcrumbJsonLd', () => {
	it('returns null for an empty trail', () => {
		expect(breadcrumbJsonLd([])).toBeNull();
	});

	it('builds a 1-based ListItem chain in order', () => {
		const node = breadcrumbJsonLd([
			{ name: 'Home', url: `${ORIGIN}/` },
			{ name: 'Lines', url: `${ORIGIN}/lines` },
			{ name: '165', url: `${ORIGIN}/route/165` },
		]);
		expect(node?.['@type']).toBe('BreadcrumbList');
		const items = node?.itemListElement as Array<{
			'@type': string;
			position: number;
			name: string;
			item: string;
		}>;
		expect(items).toHaveLength(3);
		expect(items[0]).toMatchObject({ position: 1, name: 'Home', item: `${ORIGIN}/` });
		expect(items[2]).toMatchObject({ position: 3, name: '165', item: `${ORIGIN}/route/165` });
	});
});

describe('organizationJsonLd', () => {
	it('is an Organization node with a stable @id anchored to the origin', () => {
		const node = organizationJsonLd({ siteOrigin: ORIGIN, siteName: NAME });
		expect(node['@type']).toBe('Organization');
		expect(node['@id']).toBe(`${ORIGIN}#organization`);
		expect(node.name).toBe(NAME);
		expect(node.url).toBe(ORIGIN);
	});
});

describe('datasetJsonLd', () => {
	it('is a CC BY 4.0 Dataset crediting the Organization by @id', () => {
		const node = datasetJsonLd({
			siteOrigin: ORIGIN,
			siteName: NAME,
			name: 'Open transit dataset',
			description: 'Open reliability data.',
			locale: 'fr',
		});
		expect(node['@type']).toBe('Dataset');
		expect(node.license).toBe(DATASET_LICENSE_URL);
		expect(node.inLanguage).toBe('fr');
		expect(node.isAccessibleForFree).toBe(true);
		expect((node.creator as { '@id': string })['@id']).toBe(`${ORIGIN}#organization`);
	});

	it('defaults inLanguage to en', () => {
		const node = datasetJsonLd({
			siteOrigin: ORIGIN,
			siteName: NAME,
			name: 'n',
			description: 'd',
		});
		expect(node.inLanguage).toBe('en');
	});
});

import { describe, expect, it } from 'vitest';
import { normalizeV1BaseUrl, resolveUrl } from './config';

describe('normalizeV1BaseUrl', () => {
	it('keeps absolute URL bases and same-origin absolute paths stable', () => {
		expect(normalizeV1BaseUrl('https://transit.yesid.dev/data/v1')).toBe(
			'https://transit.yesid.dev/data/v1',
		);
		expect(normalizeV1BaseUrl('/data/v1/')).toBe('/data/v1');
	});

	it('promotes bare relative data bases to root-relative paths', () => {
		expect(normalizeV1BaseUrl('data/v1')).toBe('/data/v1');
		expect(normalizeV1BaseUrl('')).toBe('/data/v1');
	});

	it('does not rebase absolute manifest pointers', () => {
		expect(resolveUrl('https://transit.yesid.dev/data/v1/stm/static/basemap.json')).toBe(
			'https://transit.yesid.dev/data/v1/stm/static/basemap.json',
		);
	});
});

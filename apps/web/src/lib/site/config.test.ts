import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_ORIGIN, normalizeSiteOrigin, parsePublicBoolean } from './config';

describe('public site config', () => {
	it('defaults to the production origin', () => {
		expect(normalizeSiteOrigin(undefined)).toBe(DEFAULT_SITE_ORIGIN);
		expect(normalizeSiteOrigin('')).toBe(DEFAULT_SITE_ORIGIN);
	});

	it('normalizes configured origins to origin-only values', () => {
		expect(normalizeSiteOrigin('https://dev.transit.yesid.dev/path/')).toBe(
			'https://dev.transit.yesid.dev',
		);
	});

	it('parses public boolean env flags conservatively', () => {
		expect(parsePublicBoolean(undefined, true)).toBe(true);
		expect(parsePublicBoolean('false', true)).toBe(false);
		expect(parsePublicBoolean('0', true)).toBe(false);
		expect(parsePublicBoolean('yes', false)).toBe(true);
		expect(parsePublicBoolean('surprise', true)).toBe(true);
	});
});

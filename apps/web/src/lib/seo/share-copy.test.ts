import { expect, it } from 'vitest';
import { resolveRouteSeo } from './routeSeo';
import { shareCopy, withShareCta } from './share-copy';
const paths = [
	'/',
	'/map',
	'/lines',
	'/stops',
	'/network',
	'/search',
	'/metrics',
	'/status',
	'/hotspots',
	'/receipt',
	'/repeat-offenders',
	'/alerts',
	'/privacy',
	'/terms',
	'/accessibility',
	'/lines/new',
	'/stop/new',
	'/trip/new',
];
it('keeps each description short, searchable and closed with its destination CTA', () => {
	for (const locale of ['en', 'fr'] as const)
		for (const path of paths) {
			const seo = resolveRouteSeo(path, locale);
			const copy = shareCopy(path, locale);
			expect(seo.description.length, path).toBeGreaterThanOrEqual(50);
			expect(seo.description.length, path).toBeLessThanOrEqual(110);
			expect(seo.description.endsWith(copy.cta + '.'), path).toBe(true);
			expect(seo.description).not.toContain('—');
		}
});
it('appends without truncation or duplication', () => {
	expect(withShareCta('A'.repeat(200), 'View the map')).toBe('A'.repeat(200) + '. View the map.');
	expect(withShareCta('Reports. View the map.', 'View the map')).toBe('Reports. View the map.');
});

it('adds the CTA to discovered provider copy without losing the identity', () => {
	for (const locale of ['en', 'fr'] as const)
		for (const identity of [
			{ id: 'stm', shortName: 'STM', city: 'Montréal' },
			{ id: 'octranspo', shortName: 'OC Transpo', city: 'Ottawa' },
		]) {
			const seo = resolveRouteSeo('/?provider=' + identity.id, locale, identity);
			expect(seo.description).toContain(identity.shortName);
			expect(seo.description).toContain(identity.city);
			expect(seo.description.length).toBeLessThanOrEqual(110);
			expect(seo.description.endsWith(shareCopy('/', locale).cta + '.')).toBe(true);
		}
});

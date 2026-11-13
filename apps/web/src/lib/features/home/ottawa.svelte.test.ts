import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import HomeExplore from './HomeExplore.svelte';
import { homeCadence, homeCopy, homeGroups } from './home.copy';
import MapFilters from '../map/MapFilters.svelte';
import { createFilterStore, emptyFilterState } from '#lib/filters/index.ts';
import { hasOccupancy } from '#lib/site/transitDisplay.ts';
import { providerHasAlerts } from '#lib/v1/providers.ts';
import { searchExamples } from '../search/search.copy';

describe.each(['en', 'fr'] as const)('provider cosmetics in %s', (locale) => {
	it.each(['octranspo', 'stm'])('%s exposes only available filters', (provider) => {
		const supported = provider === 'stm';
		const { container } = render(MapFilters, {
			props: {
				locale,
				store: createFilterStore(emptyFilterState(), () => {}),
				occupancyAvailable: hasOccupancy(provider, []),
				alertsAvailable: supported,
			},
		});
		expect(container.querySelector('[data-filter-group="crowding"]') != null).toBe(supported);
		expect(container.querySelector('[data-filter-group="alerts"]') != null).toBe(supported);
	});
	it.each(['octranspo', 'stm'])(
		'%s home map copy reflects alerts availability',
		async (provider) => {
			const available = providerHasAlerts({
				id: provider,
				labels: {
					en: { city: provider, operator: provider },
					fr: { city: provider, operator: provider },
				},
				inputs: { i3_alerts: provider === 'stm', service_alerts: provider === 'stm' },
				alert_links: {},
			});
			render(HomeExplore, {
				props: { locale, copy: homeCopy[locale], alertsAvailable: available },
			});
			// The map's directory entry appears once its question is selected; the strip owns the shortcut.
			await fireEvent.click(screen.getByRole('radio', { name: homeCopy[locale].qWhere }));
			const entry = homeGroups(homeCopy[locale], available)[0]!.entries[0]!;
			expect(screen.getByRole('link', { name: new RegExp(entry.title[locale]) })).toHaveTextContent(
				entry.desc[locale],
			);
			expect(
				entry.desc[locale].includes(locale === 'en' ? 'service alerts' : 'avis de service'),
			).toBe(available);
		},
	);
	it('states the live refresh rate a network declares and assumes none otherwise', () => {
		expect(homeCadence(locale, 20)).toContain(
			locale === 'en' ? 'every 20 seconds' : 'les 20 secondes',
		);
		expect(homeCadence(locale, null)).toBe(homeCopy[locale].cadence);
		expect(homeCadence(locale, undefined)).not.toMatch(/\d/);
	});
	it('uses local search examples and a neutral fallback', () => {
		expect(searchExamples('octranspo', locale)).toContain('Rideau');
		expect(searchExamples('stm', locale)).toEqual(['747', 'Berri-UQAM', 'Métro']);
		expect(searchExamples('unknown', locale).join(' ')).not.toMatch(/Montréal|Berri|747/);
	});
});

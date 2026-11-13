import { render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { STATUS_GLYPH } from '#lib/components/dataviz/tokens.ts';
import { STATUS_LABELS } from '#lib/v1/enumLabels.ts';
import { STATUS_CODES } from '#lib/v1/schemas/types.ts';
import { copy } from './map.copy';
import MapLegend from './MapLegend.svelte';

describe('MapLegend', () => {
	it.each(['en', 'fr'] as const)(
		'lists every status from the marker tables and explains the not-reporting badge (%s)',
		(locale) => {
			const view = render(MapLegend, { props: { locale } });
			const list = view.getByRole('list', { name: copy[locale].legend.title });
			const groups = list.querySelectorAll('[data-legend-group]');
			expect(Array.from(groups, (group) => group.getAttribute('data-legend-group'))).toEqual([
				'status',
				'symbols',
			]);
			const entries = Array.from(list.querySelectorAll<HTMLLIElement>('[data-legend-entry]'));
			expect(groups[0].querySelectorAll('[data-legend-entry]')).toHaveLength(STATUS_CODES.length);
			expect(
				Array.from(groups[1].querySelectorAll('[data-legend-entry]'), (entry) =>
					entry.getAttribute('data-legend-entry'),
				),
			).toEqual(['heading', 'not-reporting', 'stop']);
			const labels = STATUS_CODES.map((code) => STATUS_LABELS[locale][code]);

			expect(entries.slice(0, STATUS_CODES.length).map((entry) => entry.textContent)).toEqual(
				STATUS_CODES.map((code, index) => expect.stringContaining(labels[index])),
			);
			for (const [index, code] of STATUS_CODES.entries()) {
				expect(entries[index]).toHaveAttribute('data-status', code);
				expect(entries[index]).toHaveTextContent(STATUS_GLYPH[code]);
			}

			const legend = copy[locale].legend;
			for (const text of [legend.heading, legend.notReporting, legend.stop]) {
				expect(entries).toContain(within(list).getByText(text).closest('li'));
			}
			expect(entries).toHaveLength(STATUS_CODES.length + 3);
			// Badges are drawn only once zoomed in; the legend says so at every zoom.
			expect(view.getByText(legend.zoomBadges)).toBeVisible();
		},
	);

	it('shows the sentence under the title as its first line only when asked', () => {
		const lead = copy.fr.headingLead;
		expect(render(MapLegend, { props: { locale: 'fr' } }).queryByText(lead)).toBeNull();
		const view = render(MapLegend, { props: { locale: 'fr', lead: true } });
		const first = view.container.firstElementChild;
		expect(first).toHaveTextContent(lead);
	});
});

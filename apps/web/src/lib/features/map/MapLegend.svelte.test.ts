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
			const entries = within(list).getAllByRole('listitem');
			const labels = STATUS_CODES.map((code) => STATUS_LABELS[locale][code]);

			expect(entries.slice(0, STATUS_CODES.length).map((entry) => entry.textContent)).toEqual(
				STATUS_CODES.map((code, index) => expect.stringContaining(labels[index])),
			);
			for (const [index, code] of STATUS_CODES.entries()) {
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

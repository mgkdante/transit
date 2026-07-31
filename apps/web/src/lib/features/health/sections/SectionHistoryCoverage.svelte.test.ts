import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SectionHistoryCoverage from './SectionHistoryCoverage.svelte';
import { copy } from '../health.copy';
import type { HistoryCoverageFamilyView } from '../selectors/historyCoverage';

const row: HistoryCoverageFamilyView = {
	key: 'alerts',
	published: true,
	selectionMode: null,
	firstDate: null,
	lastDate: null,
	gaps: [],
	metrics: [],
	currentOnlySections: [],
};

describe('SectionHistoryCoverage empty values', () => {
	it('renders the coverage DataTable with one caption and the complete frame dialect', () => {
		const { container } = render(SectionHistoryCoverage, {
			props: { rows: [row], copy: copy.fr, locale: 'fr' },
		});

		const table = within(container).getByRole('table', {
			name: copy.fr.historyCoverage.tableLabel,
		});
		const frame = table.parentElement;
		expect(table.querySelectorAll('caption')).toHaveLength(1);
		expect(table.querySelector('caption')).toHaveTextContent(copy.fr.historyCoverage.tableLabel);
		expect(table).not.toHaveAttribute('aria-label');
		expect(table).not.toHaveAttribute('aria-labelledby');
		expect(frame).toHaveAttribute('data-responsive', 'stack');
		expect(frame).toHaveAttribute('data-stack-at', 'tablet');
		expect(frame).toHaveAttribute('data-frame', 'card');
		expect(frame).toHaveAttribute('data-collapse', 'separate');
		expect(frame).toHaveAttribute('data-frame-radius', 'true');
		expect(frame).toHaveAttribute('data-header-band', 'none');

		const columnHeaders = within(table).getAllByRole('columnheader');
		expect(
			columnHeaders.map((header) => ({
				text: header.textContent?.trim(),
				column: header.getAttribute('data-column'),
				width: header.getAttribute('style'),
			})),
		).toEqual([
			{ text: 'Famille de pages', column: 'family', width: 'width: 15%;' },
			{ text: 'Fenêtre publiée', column: 'window', width: 'width: 18%;' },
			{ text: 'Mode de consultation', column: 'selection', width: 'width: 17%;' },
			{ text: 'Détails de couverture', column: 'details', width: null },
		]);

		const bodyCells = Array.from(table.querySelectorAll('tbody tr > th, tbody tr > td'));
		expect(bodyCells[0]).toHaveAttribute('scope', 'row');
		expect(bodyCells.map((cell) => cell.getAttribute('data-column'))).toEqual([
			'family',
			'window',
			'selection',
			'details',
		]);
		expect(bodyCells.map((cell) => cell.getAttribute('data-col'))).toEqual([
			'Famille de pages',
			'Fenêtre publiée',
			'Mode de consultation',
			'Détails de couverture',
		]);
		for (const cell of bodyCells) {
			expect(cell.querySelectorAll(':scope > .data-table-cell-content')).toHaveLength(1);
			expect(cell.children).toHaveLength(1);
		}
	});

	it('uses shared compact notices and keeps no declared gaps as a healthy zero', () => {
		render(SectionHistoryCoverage, {
			props: { rows: [row], copy: copy.en, locale: 'en' },
		});

		const healthy = screen.getByText('No gaps declared').closest('[data-component="state-notice"]');
		expect(healthy).toHaveAttribute('data-presentation', 'pill');
		expect(healthy).toHaveAttribute('data-tone', 'positive');

		for (const message of [
			'No retained dates reported',
			'Not published in this history index',
			'No per-metric inventory published',
		]) {
			const matches = screen.getAllByText(message);
			expect(matches.length).toBeGreaterThan(0);
			for (const match of matches) {
				expect(match.closest('[data-component="state-notice"]')).toHaveAttribute(
					'data-presentation',
					'pill',
				);
			}
		}
	});

	it('keeps an omitted gap inventory neutral instead of declaring a healthy zero', () => {
		render(SectionHistoryCoverage, {
			props: { rows: [{ ...row, gaps: null }], copy: copy.en, locale: 'en' },
		});

		const unknown = screen
			.getByText('No gap inventory published')
			.closest('[data-component="state-notice"]');
		expect(unknown).toHaveAttribute('data-tone', 'neutral');
		expect(screen.queryByText('No gaps declared')).not.toBeInTheDocument();
	});
});

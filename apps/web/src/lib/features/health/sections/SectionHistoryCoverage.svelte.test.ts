import { render, screen } from '@testing-library/svelte';
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

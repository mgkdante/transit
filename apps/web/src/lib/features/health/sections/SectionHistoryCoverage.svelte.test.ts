import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HistoricAvailabilityIndex, IsoUtc } from '$lib/v1/schemas';
import { selectHistoryCoverage } from '../selectors/historyCoverage';
import SectionHistoryCoverage from './SectionHistoryCoverage.svelte';
import { copy } from '../health.copy';

const iso = (value: string) => value as unknown as IsoUtc;

const inventory: HistoricAvailabilityIndex = {
	generated_utc: iso('2026-07-14T12:00:00Z'),
	families: [
		{
			family: 'alerts',
			selection_mode: 'range',
			index_path: 'historic/alerts/index.json',
			first_available_date: '2026-05-20',
			last_available_date: '2026-07-14',
			gaps: [{ start_date: '2026-06-02', end_date: '2026-06-03', reason: 'source outage' }],
		},
		{
			family: 'network',
			selection_mode: 'range',
			index_path: 'historic/history/network/index.json',
			first_available_date: '2026-05-01',
			last_available_date: '2026-07-13',
			metrics: [
				{
					metric: 'delay',
					aggregation: 'additive',
					first_available_date: '2026-05-01',
					last_available_date: '2026-07-13',
				},
				{
					metric: 'delay_percentiles',
					aggregation: 'daily_only',
					first_available_date: '2026-05-04',
					last_available_date: '2026-07-12',
					gaps: [{ start_date: '2026-06-10', end_date: '2026-06-10', reason: null }],
				},
				{
					metric: 'vehicles',
					aggregation: 'daily_only',
					first_available_date: '2026-05-01',
					last_available_date: '2026-07-13',
				},
			],
		},
	],
};

describe('SectionHistoryCoverage', () => {
	it('renders a semantic seven-family inventory with real windows, gaps, metrics, and current-only limitations', () => {
		const { container } = render(SectionHistoryCoverage, {
			props: { rows: selectHistoryCoverage(inventory), copy: copy.en, locale: 'en' },
		});
		const table = screen.getByRole('table', { name: copy.en.historyCoverage.tableLabel });

		expect(within(table).getAllByRole('row')).toHaveLength(8);
		expect(within(table).getByText(copy.en.historyCoverage.families.alerts)).toBeInTheDocument();
		expect(within(table).getByText(copy.en.historyCoverage.families.receipts)).toBeInTheDocument();
		expect(within(table).getByText('May 20 – Jul 14')).toBeInTheDocument();
		expect(within(table).getByText('Jun 2 – Jun 3')).toBeInTheDocument();
		expect(within(table).getByText('source outage')).toBeInTheDocument();
		expect(
			within(table).getByText(copy.en.historyCoverage.aggregation.additive),
		).toBeInTheDocument();
		expect(within(table).getAllByText(copy.en.historyCoverage.aggregation.daily_only)).toHaveLength(
			2,
		);
		expect(within(table).getAllByText(copy.en.historyCoverage.currentOnlySections)).toHaveLength(3);
		expect(
			within(table).getAllByText(copy.en.historyCoverage.currentOnlySectionLabels.live_status),
		).toHaveLength(3);
		expect(within(table).getAllByText(copy.en.historyCoverage.unavailable).length).toBeGreaterThan(
			0,
		);
		expect(container).not.toHaveTextContent('730 days available');
		expect(container).not.toHaveTextContent('730 jours disponibles');
	});

	it('localizes French labels, date keys, selection mode, and honest missing-family copy', () => {
		render(SectionHistoryCoverage, {
			props: { rows: selectHistoryCoverage(inventory), copy: copy.fr, locale: 'fr' },
		});
		const table = screen.getByRole('table', { name: copy.fr.historyCoverage.tableLabel });

		expect(
			within(table).getByText(copy.fr.historyCoverage.families.repeat_offenders),
		).toBeVisible();
		expect(
			within(table).getAllByText(copy.fr.historyCoverage.selection.range).length,
		).toBeGreaterThan(0);
		expect(within(table).getByText('20 mai – 14 juill.')).toBeInTheDocument();
		expect(within(table).getAllByText(copy.fr.historyCoverage.unavailable).length).toBeGreaterThan(
			0,
		);
		expect(within(table).getAllByText(copy.fr.historyCoverage.currentOnlySections)).toHaveLength(3);
	});

	it('does not label live vehicles current-only when the published metric is daily-only', () => {
		render(SectionHistoryCoverage, {
			props: { rows: selectHistoryCoverage(inventory), copy: copy.en, locale: 'en' },
		});
		const vehicles = document.querySelector('[data-metric="vehicles"]') as HTMLElement;

		expect(vehicles).toHaveAttribute('data-aggregation', 'daily_only');
		expect(
			within(vehicles).getByText(copy.en.historyCoverage.aggregation.daily_only),
		).toBeVisible();
		expect(
			within(vehicles).queryByText(copy.en.historyCoverage.aggregation.current_only),
		).toBeNull();
	});

	it('reflows rows without a control-level horizontal scroller or page-width overflow', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/health/sections/SectionHistoryCoverage.svelte'),
			'utf8',
		);

		expect(source).toMatch(/\.coverage-table\s*\{[^}]*width:\s*100%;[^}]*table-layout:\s*fixed;/s);
		expect(source).toMatch(/overflow-wrap:\s*anywhere/);
		expect(source).toMatch(/@media\s*\(max-width:\s*1023px\)/);
		expect(source).not.toMatch(/overflow-x:\s*(?:auto|scroll)/);
	});

	it('scopes fixed table-column widths to desktop so tablet family headers can use auto width', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/health/sections/SectionHistoryCoverage.svelte'),
			'utf8',
		);
		const desktopStart = source.indexOf('@media (min-width: 1024px)');

		expect(desktopStart).toBeGreaterThan(-1);
		for (const selector of [
			'.coverage-table th:nth-child(1)',
			'.coverage-table th:nth-child(2)',
			'.coverage-table th:nth-child(3)',
		]) {
			expect(source.indexOf(selector)).toBeGreaterThan(desktopStart);
		}
		expect(source).toMatch(
			/@media\s*\(max-width:\s*1023px\)[\s\S]*?\.coverage-table th,[\s\S]*?\.coverage-table td\s*\{[^}]*width:\s*auto;/,
		);
	});
});

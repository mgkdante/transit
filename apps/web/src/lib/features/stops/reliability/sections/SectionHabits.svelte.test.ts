import { render, fireEvent, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SectionHabits from './SectionHabits.svelte';
import { stopReliabilityCopy } from '../stops-reliability.copy';

describe('stop relative heatmap meaning', () => {
	it.each(['en', 'fr'] as const)(
		'uses one stop-wide relative scale in its legend, table and help (%s)',
		async (locale) => {
			const matrix: (number | null)[][] = Array.from({ length: 7 }, () => Array(24).fill(null));
			matrix[0].splice(0, 8, 0, 0.2499, 0.25, 0.5, 0.7499, 0.75, 1, null);
			const { container } = render(SectionHabits, {
				props: { matrix, locale, copy: stopReliabilityCopy[locale] },
			});
			const block = container.querySelector('[data-slot="stop-habits"]') as HTMLElement;
			const labels =
				locale === 'en'
					? [
							'Low relative score',
							'Moderate relative score',
							'High relative score',
							'Very high relative score',
						]
					: [
							'Score relatif faible',
							'Score relatif modéré',
							'Score relatif élevé',
							'Score relatif très élevé',
						];
			const cells = [...block.querySelectorAll('table tbody tr:first-child td')]
				.slice(0, 8)
				.map((cell) => cell.textContent?.trim());
			expect
				.soft(cells)
				.toEqual([
					labels[0],
					labels[0],
					labels[1],
					labels[2],
					labels[2],
					`◆ ${labels[3]}`,
					`◆ ${labels[3]}`,
					locale === 'en' ? 'No data' : 'Aucune donnée',
				]);
			const caption = block.querySelector('.stop-reliability-habits-caption')?.textContent ?? '';
			expect.soft(caption).toMatch(locale === 'en' ? /0.75.*maximum/ : /0,75.*maximum/);
			expect
				.soft(caption)
				.not.toMatch(/how often|within each day|au sein de chaque journée|revient souvent/);
			const legendLabels = [...block.querySelectorAll('[data-slot="chart-legend"] li')].map(
				(item) => item.textContent?.trim(),
			);
			expect
				.soft(legendLabels)
				.toEqual([
					...labels.slice(0, 3),
					`${labels[3]} ◆`,
					locale === 'en' ? 'No data' : 'Aucune donnée',
				]);
			await fireEvent.click(within(block).getByRole('button', { name: /about|propos/i }));
			const help = block.querySelector('.metric-info__tip')?.textContent ?? '';
			expect.soft(help).toMatch(locale === 'en' ? /relative score/i : /score relatif/i);
		},
	);
});

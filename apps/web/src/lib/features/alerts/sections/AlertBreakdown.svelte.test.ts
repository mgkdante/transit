import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { alertHistoryCopy } from '../alerts.copy';
import AlertBreakdown from './AlertBreakdown.svelte';

describe('AlertBreakdown French assistive labels', () => {
	it('passes the active locale to ranked alert rows', () => {
		render(AlertBreakdown, {
			props: {
				causeRows: [
					{
						key: 'construction',
						rank: 1,
						title: 'Travaux',
						severity: 'high',
						value: 1,
						display: '2 avis',
						subtitle: undefined,
					},
				],
				effectRows: [],
				severityRows: [],
				hasBreakdown: true,
				copy: alertHistoryCopy.fr,
				locale: 'fr',
			},
		});

		expect(screen.getByRole('progressbar')).toHaveAttribute(
			'aria-label',
			'Rang 1 : Travaux, Élevé',
		);
		expect(screen.getByRole('img', { name: 'aucune donnée de variation' })).toBeInTheDocument();
	});
});

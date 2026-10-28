import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { intl } from '$lib/i18n';
import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';
import ReliabilityBadge from './ReliabilityBadge.svelte';

function snap(partial: Partial<ReliabilitySnapshot>): ReliabilitySnapshot {
	return { phase: 'idle', otpPct: null, verdict: null, series: [], ...partial };
}

describe('ReliabilityBadge', () => {
	it.each([
		['en', 'on time in the latest daily summary'],
		['fr', 'à l’heure dans le dernier bilan quotidien'],
	] as const)(
		'reports the daily percentage once without a competing verdict in %s',
		(locale, description) => {
			const pct = intl.number(locale, { style: 'unit', unit: 'percent' }).format(83);
			const label = `${pct} ${description}`;
			const { container } = render(ReliabilityBadge, {
				props: { snapshot: snap({ phase: 'ready', otpPct: 83, verdict: 'late' }), locale },
			});
			const badges = screen.getAllByRole('img');
			expect(badges).toHaveLength(1);
			expect(badges[0]).toHaveAccessibleName(label);
			expect(badges[0]).toHaveAttribute('title', label);
			expect(screen.getByText(pct, { normalizer: (text) => text })).toHaveAttribute(
				'aria-hidden',
				'true',
			);
			expect(container.querySelector('[data-verdict]')).toBeNull();
		},
	);

	it.each(['loading', 'empty'] as const)('shows no percentage for a %s snapshot', (phase) => {
		const { container } = render(ReliabilityBadge, {
			props: { snapshot: snap({ phase }), locale: 'en' },
		});
		expect(screen.queryByRole('img')).toBeNull();
		expect(container.textContent).toBe('');
	});
});

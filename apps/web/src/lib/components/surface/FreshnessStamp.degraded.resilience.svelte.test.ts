import { render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import FreshnessStamp from './FreshnessStamp.svelte';

describe('FreshnessStamp degraded live truth', () => {
	it('renders a caution verdict instead of green while an active family is degraded', () => {
		render(FreshnessStamp, {
			props: {
				variant: 'live',
				generatedUtc: '2026-07-30T12:00:00Z',
				ageSeconds: 12,
				isStale: false,
				degraded: true,
				locale: 'en',
			},
		});

		const stamp = document.querySelector('[data-slot="freshness-stamp"]') as HTMLElement;
		expect(stamp).toHaveAttribute('data-degraded', 'true');
		expect(stamp).toHaveAttribute('data-age-seconds', '12');
		expect(stamp.querySelector('[data-slot="status-dot"]')).toHaveClass(
			'bg-[var(--signal-caution)]',
		);
		expect(stamp.querySelector('[data-slot="status-dot"]')).not.toHaveClass(
			'bg-dataviz-status-on-time',
		);
		// Degraded is family health, not fabricated global staleness.
		expect(within(stamp).queryByText(/stale/)).not.toBeInTheDocument();
	});
});

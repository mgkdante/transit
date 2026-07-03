import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';
import ReliabilityBadge from './ReliabilityBadge.svelte';

function snap(partial: Partial<ReliabilitySnapshot>): ReliabilitySnapshot {
	return { phase: 'idle', otpPct: null, verdict: null, series: [], ...partial };
}

describe('ReliabilityBadge', () => {
	it('renders the OTP% + a status dot when a verdict has loaded', () => {
		const { container } = render(ReliabilityBadge, {
			props: { snapshot: snap({ phase: 'ready', otpPct: 82, verdict: 'late' }), locale: 'en' },
		});
		expect(screen.getByText('82%')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="reliability-badge"]')).not.toBeNull();
		// The status mark carries the verdict band as a data attribute.
		expect(container.querySelector('[data-verdict="late"]')).not.toBeNull();
	});

	it('announces the reading exactly ONCE — one accessible name on the badge, visible parts hidden', () => {
		const { container } = render(ReliabilityBadge, {
			props: { snapshot: snap({ phase: 'ready', otpPct: 82, verdict: 'late' }), locale: 'en' },
		});
		// The badge wrapper is the single role=img carrying the whole composed name;
		// no separate sr-only span, no second img from the inner dot.
		const imgs = screen.getAllByRole('img');
		expect(imgs).toHaveLength(1);
		expect(imgs[0]).toHaveAttribute('data-slot', 'reliability-badge');
		expect(imgs[0]).toHaveAccessibleName('Late · 82% on time');
		// The visible pct + the inner status dot are removed from the a11y tree.
		expect(container.querySelector('.reliability-badge-pct')).toHaveAttribute(
			'aria-hidden',
			'true',
		);
		expect(container.querySelector('.reliability-badge-mark')).toHaveAttribute(
			'aria-hidden',
			'true',
		);
		// No standalone sr-only echo of the reading remains.
		expect(container.querySelector('.sr-only')).toBeNull();
	});

	it('renders NOTHING while loading (no spinner, no badge)', () => {
		const { container } = render(ReliabilityBadge, {
			props: { snapshot: snap({ phase: 'loading' }), locale: 'en' },
		});
		expect(container.querySelector('[data-slot="reliability-badge"]')).toBeNull();
	});

	it('renders NOTHING for a no-data (empty) snapshot — never a fabricated 0%', () => {
		const { container } = render(ReliabilityBadge, {
			props: { snapshot: snap({ phase: 'empty' }), locale: 'en' },
		});
		expect(container.querySelector('[data-slot="reliability-badge"]')).toBeNull();
		expect(screen.queryByText('0%')).toBeNull();
	});

	// P5.2: the decorative inline sparkline path was removed with the legacy
	// Sparkline primitive (it was never enabled by any consumer).

	it('localizes the percent grouping in FR', () => {
		render(ReliabilityBadge, {
			props: { snapshot: snap({ phase: 'ready', otpPct: 82, verdict: 'late' }), locale: 'fr' },
		});
		// FR puts a space before the percent sign (vs EN "82%").
		const pct = document.querySelector('.reliability-badge-pct');
		expect(pct?.textContent).toMatch(/82\s%/u);
	});
});

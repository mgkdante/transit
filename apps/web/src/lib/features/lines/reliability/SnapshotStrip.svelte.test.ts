// SnapshotStrip.svelte.test.ts — DOM gate for the slice-S6 top metric cards.
//
// The strip is the zero-interaction headline. After the S6 redesign it renders
// the seven metrics as wide two-column "explained" cards (ExplainedMetricCard),
// grouped into two rows. These tests pin the behaviours the doctrine demands:
//   1. POPULATED — the seven cards render across the two rows with their values,
//      the CoV as a plain regular/irregular reading, NO inline explanation column
//      (context is hover-only), the (i) affordance, and ramp-in on the two ramp-in
//      cards (and nowhere else).
//   2. HONEST EMPTY — an all-null VM renders the styled honest-absence note and
//      does NOT crash (no fabricated 0, no wall of empties).

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import SnapshotStrip from './SnapshotStrip.svelte';
import { reliabilityCopy } from './reliability.copy';
import { toReliabilityClusters } from './clusters';
import type { RouteReliability } from '$lib/v1';

const copyEn = reliabilityCopy.en;

/** A populated contract: every strip metric carries a value; CoV reads regular. */
const POPULATED: RouteReliability = {
	periods: [{ grain: 'day', otp_pct: 82, avg_delay_min: 3.2, p50_min: 2, p90_min: 8.5 }],
	headway: [
		{ shift: 'am_peak_dir0', scheduled_min: 6, observed_min: 6.4, cov: 0.31, bunched_pct: 8 },
	],
	cancellations: [
		{ grain: 'day', cancellation_rate_pct: 1.4, canceled_trip_days: 2, total_trip_days: 140 },
	],
	skipped_stops: [
		{ skipped_stop_rate_pct: 0.6, skipped_stop_count: 3, stop_time_update_count: 500 },
	],
} as RouteReliability;

describe('SnapshotStrip', () => {
	it('renders the seven metric cards across two rows with values + the CoV reading', () => {
		const { strip } = toReliabilityClusters(POPULATED, { grain: 'day' });
		const { container } = render(SnapshotStrip, {
			props: { vm: strip, locale: 'en', copy: copyEn },
		});

		// Seven wide cards in total (no metric silently dropped).
		expect(container.querySelectorAll('[data-slot="explained-metric-card"]')).toHaveLength(7);

		// Row 1 — the four headline rates.
		const row1 = container.querySelector('[data-slot="snapshot-row-1"]') as HTMLElement;
		expect(row1).not.toBeNull();
		expect(row1.querySelectorAll('[data-slot="explained-metric-card"]')).toHaveLength(4);
		expect(within(row1).getByText(copyEn.strip.otpPct)).toBeInTheDocument();
		expect(within(row1).getByText(copyEn.strip.avgDelayMin)).toBeInTheDocument();
		expect(within(row1).getByText(copyEn.strip.cancellationRatePct)).toBeInTheDocument();
		expect(within(row1).getByText(copyEn.strip.skippedStopRatePct)).toBeInTheDocument();

		// Row 2 — the three delay-distribution reads.
		const row2 = container.querySelector('[data-slot="snapshot-row-2"]') as HTMLElement;
		expect(row2).not.toBeNull();
		expect(row2.querySelectorAll('[data-slot="explained-metric-card"]')).toHaveLength(3);
		expect(within(row2).getByText(copyEn.strip.headwayRegularityCov)).toBeInTheDocument();
		expect(within(row2).getByText(copyEn.strip.p90Min)).toBeInTheDocument();
		expect(within(row2).getByText(copyEn.strip.p50Min)).toBeInTheDocument();

		// Real values render (never fabricated zeros).
		expect(screen.getByText('82%')).toBeInTheDocument();
		expect(screen.getByText('3.2 min')).toBeInTheDocument();
		expect(screen.getByText('2 min')).toBeInTheDocument();
		expect(screen.getByText('8.5 min')).toBeInTheDocument();

		// CoV is expressed as a plain reading — caption, not a raw number dump.
		// cov 0.31 < 0.5 → "Regular arrivals".
		expect(screen.getByText(copyEn.strip.regularity.regular)).toBeInTheDocument();
		expect(screen.queryByText(copyEn.strip.regularity.irregular)).not.toBeInTheDocument();

		// Hero tiles drop the inline explanation column (col2) — the per-metric context
		// lives in the (i) hover ONLY (the operator's "just hover context" call).
		expect(container.querySelectorAll('[data-slot="explained-metric-text"]')).toHaveLength(0);

		// Ramp-in note present on BOTH ramp-in cards, and nowhere else.
		expect(screen.getAllByText(copyEn.strip.rampInNote)).toHaveLength(2);

		// No honest-empty note when data is present.
		expect(screen.queryByText(copyEn.strip.noDataNote)).not.toBeInTheDocument();
	});

	it('renders the (i) explainer affordance inside every card (col1)', () => {
		const { strip } = toReliabilityClusters(POPULATED, { grain: 'day' });
		const { container } = render(SnapshotStrip, {
			props: { vm: strip, locale: 'en', copy: copyEn },
		});

		// One (i) affordance per card, seated in col1 (the figure), so the deep link
		// to /metrics is always one interaction away from each metric.
		const badges = container.querySelectorAll(
			'[data-slot="explained-metric-figure"] [data-slot="explained-metric-info"]',
		);
		expect(badges).toHaveLength(7);
		for (const badge of badges) {
			expect(badge.querySelector('.metric-info__trigger')).not.toBeNull();
		}
	});

	it('renders the honest empty state for an all-null VM without crashing', () => {
		// An empty contract → every strip headline is null → vm.isEmpty.
		const { strip } = toReliabilityClusters({} as RouteReliability);
		expect(strip.isEmpty).toBe(true);

		const { container } = render(SnapshotStrip, {
			props: { vm: strip, locale: 'en', copy: copyEn },
		});

		// The styled honest-absence chip (says WHY) is shown — never a fabricated 0.
		expect(
			container.querySelector('[data-slot="empty-note"] [data-slot="absent-value"]'),
		).not.toBeNull();
		expect(screen.queryByText('0%')).not.toBeInTheDocument();

		// And the cards are not rendered (collapsed to the single note).
		expect(container.querySelector('[data-slot="explained-metric-card"]')).toBeNull();
		expect(screen.queryByText(copyEn.strip.otpPct)).not.toBeInTheDocument();
	});
});

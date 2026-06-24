// SnapshotStrip.svelte.test.ts — DOM gate for the slice-9.6 snapshot strip.
//
// The strip is the zero-interaction headline row. These tests pin the two
// load-bearing behaviours the doctrine demands:
//   1. POPULATED — renders the six metric values for the selected grain, with
//      the CoV expressed as a plain regular/irregular reading (not a raw dump)
//      and the ramp-in affordance present on the two ramp-in tiles.
//   2. HONEST EMPTY — an all-null VM renders the explicit no-data note and does
//      NOT crash (no fabricated 0, no wall of em-dashes).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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
	it('renders the six metric tiles, the CoV regular/irregular reading, and ramp-in affordances', () => {
		const { strip } = toReliabilityClusters(POPULATED, { grain: 'day' });
		render(SnapshotStrip, { props: { vm: strip, locale: 'en', copy: copyEn } });

		// Every metric label is present (the seven headline tiles rendered — p50 was
		// added alongside p90 per A4).
		expect(screen.getByText(copyEn.strip.otpPct)).toBeInTheDocument();
		expect(screen.getByText(copyEn.strip.avgDelayMin)).toBeInTheDocument();
		expect(screen.getByText(copyEn.strip.p50Min)).toBeInTheDocument();
		expect(screen.getByText(copyEn.strip.p90Min)).toBeInTheDocument();
		expect(screen.getByText(copyEn.strip.headwayRegularityCov)).toBeInTheDocument();
		expect(screen.getByText(copyEn.strip.cancellationRatePct)).toBeInTheDocument();
		expect(screen.getByText(copyEn.strip.skippedStopRatePct)).toBeInTheDocument();

		// Headline values are the real numbers (not fabricated zeros).
		expect(screen.getByText('82%')).toBeInTheDocument();
		expect(screen.getByText('3.2 min')).toBeInTheDocument();
		// p50 = 2 min (typical delay) and p90 = 8.5 min (worst-case) both render.
		expect(screen.getByText('2 min')).toBeInTheDocument();
		expect(screen.getByText('8.5 min')).toBeInTheDocument();

		// CoV is expressed as a plain reading — caption, not a raw number dump.
		// cov 0.31 < 0.5 → "Regular arrivals".
		expect(screen.getByText(copyEn.strip.regularity.regular)).toBeInTheDocument();
		expect(screen.queryByText(copyEn.strip.regularity.irregular)).not.toBeInTheDocument();

		// Ramp-in affordance present on BOTH ramp-in tiles, and nowhere else.
		expect(screen.getAllByText(copyEn.strip.rampInNote)).toHaveLength(2);

		// No honest-empty note when data is present.
		expect(screen.queryByText(copyEn.strip.noDataNote)).not.toBeInTheDocument();
	});

	it('anchors each tile (i) badge in the corner with the label as a sibling that can wrap (C1)', () => {
		const { strip } = toReliabilityClusters(POPULATED, { grain: 'day' });
		const { container } = render(SnapshotStrip, {
			props: { vm: strip, locale: 'en', copy: copyEn },
		});

		// Every tile owns a corner-anchored (i) badge (the .snapshot-tile__info hook
		// the CSS pins to inset-block-start/inset-inline-end), seated INSIDE the tile
		// — not in a header bar above the label, so the label can wrap to its left.
		const tiles = container.querySelectorAll('.snapshot-tile');
		expect(tiles.length).toBeGreaterThan(0);
		for (const tile of tiles) {
			const badge = tile.querySelector('.snapshot-tile__info');
			expect(badge).not.toBeNull();
			// The badge is a direct child of the tile (corner-anchored sibling of the
			// metric label), and the tile carries a metric-display whose label wraps.
			expect(badge!.parentElement).toBe(tile);
			expect(tile.querySelector('[data-slot="metric-display"] .label-metric')).not.toBeNull();
		}
	});

	it('groups the headline pair + secondary tiles in the redesigned strip, keeping every data-slot (C)', () => {
		const { strip } = toReliabilityClusters(POPULATED, { grain: 'day' });
		const { container } = render(SnapshotStrip, {
			props: { vm: strip, locale: 'en', copy: copyEn },
		});

		// The redesign splits the flat 7-up row into a weighted headline pair + a
		// calmer secondary grid (deliberate hierarchy, not a flat number row).
		const headline = container.querySelector('[data-slot="snapshot-headline"]');
		const secondary = container.querySelector('[data-slot="snapshot-secondary"]');
		expect(headline).not.toBeNull();
		expect(secondary).not.toBeNull();

		// On-time % + Avg delay are the weighted headline cards.
		expect(headline!.querySelector('[data-slot="otp"]')).not.toBeNull();
		expect(headline!.querySelector('[data-slot="avg-delay"]')).not.toBeNull();
		expect(headline!.querySelectorAll('.snapshot-tile--headline')).toHaveLength(2);

		// The remaining five read as secondary tiles.
		for (const slot of ['p50', 'p90', 'regularity', 'cancellation', 'skipped']) {
			expect(secondary!.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
		}
		expect(secondary!.querySelectorAll('.snapshot-tile--secondary')).toHaveLength(5);

		// Every metric data-slot survives the regroup (no tile silently dropped).
		for (const slot of [
			'otp',
			'avg-delay',
			'p50',
			'p90',
			'regularity',
			'cancellation',
			'skipped',
		]) {
			expect(container.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
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

		// And the tiles are not rendered (collapsed to the single note).
		expect(screen.queryByText(copyEn.strip.otpPct)).not.toBeInTheDocument();
	});
});

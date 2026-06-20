import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkFile, TrendPoint } from '$lib/v1';
import type { IsoUtc } from '$lib/v1/schemas';
import NetworkHealth from './NetworkHealth.svelte';

const { openSurface, network, trendSeries } = vi.hoisted(() => ({
	openSurface: vi.fn(),
	network: {
		generated_utc: '2026-06-16T02:00:00Z' as IsoUtc,
		vehicles_in_service: 10,
		on_time_pct: 80,
		status_dist: {
			early: 0,
			on_time: 8,
			late: 2,
			severe: 0,
			unknown: 0,
		},
		delay_p50_min: 1,
		delay_p90_min: 6,
		non_responding: 3,
		feed_freshness_s: 20,
		coverage_pct: 95,
		occupancy_mix: null,
		// `satisfies` keeps the compile-time contract check on the literal; the
		// trailing `as NetworkFile` widens the (otherwise narrowed) inferred type
		// back to the mutable contract type so a test may flip e.g. occupancy_mix.
	} satisfies NetworkFile as NetworkFile,
	// A small daily trend carrying all seven NetworkTrend fields, including a
	// cancellation rate and a per-day occupancy mix on the latest day only. Typed
	// as TrendPoint[] (each element `satisfies TrendPoint`) so a longer fixture
	// with null cancellation/occupancy can be spliced in for the re-slice test.
	trendSeries: [
		{
			date: '2026-06-14',
			otp_pct: 78,
			avg_delay_min: 2.1,
			p90_min: 5,
			vehicles: 9,
			cancellation_rate: 1.2,
			occupancy_mix: null,
		},
		{
			date: '2026-06-15',
			otp_pct: 81,
			avg_delay_min: 1.8,
			p90_min: 6,
			vehicles: 11,
			cancellation_rate: 2.6,
			occupancy_mix: {
				empty: 0.1,
				many_seats: 0.4,
				few_seats: 0.3,
				standing: 0.15,
				full: 0.05,
			},
		},
	] satisfies TrendPoint[] as TrendPoint[],
}));

vi.mock('$lib/nav', async () => {
	return {
		layout: { isDesktop: true },
		openSurface,
	};
});

vi.mock('$lib/v1', async () => {
	return {
		STATUS_CODES: ['early', 'on_time', 'late', 'severe', 'unknown'],
		OCCUPANCY_CODES: ['empty', 'many_seats', 'few_seats', 'standing', 'full'],
		getV1Context: () => ({ manifest: { files: { live: { ttl_s: 30 } } }, labels: {}, lang: 'en' }),
		createLiveStore: () => ({
			vehicles: null,
			trips: null,
			departures: null,
			alerts: null,
			network,
			index: {
				vehiclesById: new Map(),
				vehiclesByRoute: new Map(),
				vehiclesByTrip: new Map(),
				stopsById: new Map(),
				tripsById: new Map(),
				alertsById: new Map(),
			},
			generatedUtc: network.generated_utc,
			ageSeconds: 20,
			isStale: false,
			loading: false,
			error: null,
			start: vi.fn(),
			stop: vi.fn(),
			refresh: vi.fn(),
		}),
		getNetworkTrend: vi.fn(),
		getProvenance: vi.fn(),
	};
});

// createResource is shared by the trend + provenance ports. We branch on the
// loader's source so the trend resource carries the rich series while provenance
// stays null (its badge renders nothing — supplementary, never blocking).
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: (loader: () => unknown) => {
		const src = loader.toString();
		const isProvenance = src.includes('Provenance') || src.includes('provenance');
		return {
			data: isProvenance ? { conformance: null } : { series: trendSeries },
			error: null,
			loading: false,
			settled: true,
			reload: vi.fn(),
		};
	},
}));

describe('NetworkHealth drilldown', () => {
	it('opens the live map with a status filter when a status segment is selected', async () => {
		openSurface.mockClear();
		render(NetworkHealth);

		await fireEvent.click(screen.getByRole('img', { name: 'Late: 20%' }));

		expect(openSurface).toHaveBeenCalledExactlyOnceWith({ kind: 'map', search: 'status=late' });
	});
});

describe('NetworkHealth live tiles', () => {
	it('renders the non-responding "Not reporting" tile beside Vehicles in service', () => {
		render(NetworkHealth);
		const tile = screen.getByText('Not reporting').closest('[data-slot="metric-display"]');
		expect(tile).not.toBeNull();
		expect(within(tile as HTMLElement).getByText('3')).toBeInTheDocument();
	});

	it('surfaces the worker-feed-age chip near LiveFreshness', () => {
		render(NetworkHealth);
		const chip = screen.getByText('FEED').closest('[data-slot="feed-age"]');
		expect(chip).not.toBeNull();
		// A human age string (formatRelativeSeconds), never a raw "20".
		expect((chip as HTMLElement).getAttribute('aria-label')).toContain('Worker feed updated');
	});
});

describe('NetworkHealth crowding cross-filter', () => {
	it('opens the live map with an occupancy filter when a crowding segment is selected', async () => {
		// The live occupancy bar is null this cycle, but the per-day crowding
		// small-multiple carries a day with telemetry — its mini-bar is static
		// (non-interactive). The LIVE crowding bar wiring is covered by the
		// mapSearchFor occupancy unit test; here we assert the live bar is wired by
		// rendering a live occupancy mix.
		network.occupancy_mix = {
			empty: 0.2,
			many_seats: 0.3,
			few_seats: 0.2,
			standing: 0.2,
			full: 0.1,
		};
		openSurface.mockClear();
		render(NetworkHealth);

		// The standing band is 20% of the live mix.
		await fireEvent.click(screen.getByRole('img', { name: 'Standing: 20%' }));

		expect(openSurface).toHaveBeenCalledExactlyOnceWith({
			kind: 'map',
			search: 'occupancy=standing',
		});
		network.occupancy_mix = null;
	});
});

describe('NetworkHealth trend window + series', () => {
	it('offers a 7/30/90-day trend window selector', () => {
		render(NetworkHealth);
		const group = screen.getByRole('radiogroup', { name: 'Trend window' });
		expect(within(group).getByRole('radio', { name: '7d' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: '30d' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: '90d' })).toBeInTheDocument();
	});

	it('disables a window longer than the available series (2 days → 30d/90d disabled)', () => {
		render(NetworkHealth);
		const group = screen.getByRole('radiogroup', { name: 'Trend window' });
		// 7d is always enabled; 30/90 exceed the 2-day series → disabled.
		expect(within(group).getByRole('radio', { name: '7d' })).not.toBeDisabled();
		expect(within(group).getByRole('radio', { name: '30d' })).toBeDisabled();
		expect(within(group).getByRole('radio', { name: '90d' })).toBeDisabled();
	});

	it('offers a delay-series toggle (slowest 10% vs typical)', () => {
		render(NetworkHealth);
		const group = screen.getByRole('radiogroup', { name: 'Delay series' });
		expect(within(group).getByRole('radio', { name: 'Slowest 10%' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: 'Typical' })).toBeInTheDocument();
	});

	it('switches the retard channel from p90 to the avg/median series when "Typical" is picked', async () => {
		const { container } = render(NetworkHealth);

		// The delay TrendLine figure (its summary aria-label scopes us to it, away
		// from the cancellation chart's own per-index targets).
		const figure = container.querySelector(
			'[data-slot="trend-line"][aria-label*="chosen delay series"]',
		) as HTMLElement;
		expect(figure).not.toBeNull();

		// Per-index focus targets read both series at each x-index. Default = p90:
		// the latest day's retard reads the p90 series (6 min) under its p90 label.
		const targetsP90 = within(figure).getAllByRole('img');
		const lastP90 = targetsP90[targetsP90.length - 1];
		expect(lastP90.getAttribute('aria-label')).toContain('Slowest 10% (min) 6 min');
		expect(lastP90.getAttribute('aria-label')).not.toContain('Median delay');

		// Pick "Typical" → the retard channel re-feeds the avg-delay series + its
		// label flips to the median label, and the plotted value changes (1.8 min).
		await fireEvent.click(screen.getByRole('radio', { name: 'Typical' }));

		const targetsAvg = within(figure).getAllByRole('img');
		const lastAvg = targetsAvg[targetsAvg.length - 1];
		expect(lastAvg.getAttribute('aria-label')).toContain('Median delay 1.8 min');
		expect(lastAvg.getAttribute('aria-label')).not.toContain('Slowest 10% (min)');
	});
});

describe('NetworkHealth cancellation trend', () => {
	it('renders the cancellation block with the latest value when the series carries data', () => {
		render(NetworkHealth);
		// Latest day cancellation_rate = 2.6 → "2.6%". The label is the honest
		// latest-CLOSED-day meaning, never "today" (the DB rollup excludes today).
		const tile = screen.getByText('Canceled (latest day)').closest('[data-slot="metric-display"]');
		expect(tile).not.toBeNull();
		expect(within(tile as HTMLElement).getByText('2.6%')).toBeInTheDocument();
	});
});

describe('NetworkHealth per-day crowding', () => {
	it('renders a per-day crowding small-multiple skipping days with no telemetry', () => {
		render(NetworkHealth);
		const list = screen.getByRole('list', { name: /Crowding band mix per day/i });
		// Only 2026-06-15 carries occupancy telemetry; 2026-06-14 is skipped. The
		// date renders as a localized short day-key (UTC, so it never shifts): the
		// 06-15 key shows "Jun 15"; the skipped 06-14 key's "Jun 14" is absent.
		expect(within(list).getByText('Jun 15')).toBeInTheDocument();
		expect(within(list).queryByText('Jun 14')).toBeNull();
	});
});

describe('NetworkHealth trend window re-slice', () => {
	// Swap the shared (hoisted) series for a 40-day run so 30d is ENABLED and
	// distinct from 90d (which still exceeds 40 → disabled). The hoisted `trendSeries`
	// is read by reference inside the createResource mock, so mutating its contents
	// in place changes what the next render sees. Restore the 2-day fixture after.
	const original = trendSeries.slice();
	const longSeries = Array.from({ length: 40 }, (_, i) => ({
		date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
		otp_pct: 70 + (i % 20),
		avg_delay_min: 1 + (i % 5),
		p90_min: 4 + (i % 6),
		vehicles: 100 + i,
		cancellation_rate: null,
		occupancy_mix: null,
	}));

	beforeEach(() => {
		trendSeries.splice(0, trendSeries.length, ...longSeries);
	});
	afterEach(() => {
		trendSeries.splice(0, trendSeries.length, ...original);
	});

	it('re-slices the trend to fewer plotted days when 7d is picked after the 30d default', async () => {
		const { container } = render(NetworkHealth);

		const figureFor = () =>
			container.querySelector(
				'[data-slot="trend-line"][aria-label*="chosen delay series"]',
			) as HTMLElement;

		// 40-day series → richest-fit default is 30d (90d exceeds 40 → disabled).
		const group = screen.getByRole('radiogroup', { name: 'Trend window' });
		expect(within(group).getByRole('radio', { name: '30d' })).not.toBeDisabled();
		expect(within(group).getByRole('radio', { name: '90d' })).toBeDisabled();

		// One per-index focus target per plotted day → 30 at the default window.
		expect(within(figureFor()).getAllByRole('img')).toHaveLength(30);

		// Narrow to 7d → exactly 7 plotted days (the slice happens once, shared).
		await fireEvent.click(within(group).getByRole('radio', { name: '7d' }));
		expect(within(figureFor()).getAllByRole('img')).toHaveLength(7);
	});
});

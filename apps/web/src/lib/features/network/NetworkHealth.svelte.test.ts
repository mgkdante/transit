import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkFile, NetworkShift, TrendPoint } from '$lib/v1';
import type { IsoUtc } from '$lib/v1/schemas';
import NetworkHealth from './NetworkHealth.svelte';

const { openSurface, live, network, trendSeries, weeklySeries, monthlySeries, byShift, byDaytype } =
	vi.hoisted(() => ({
		openSurface: vi.fn(),
		// Mutable live-store harness: `ageSeconds` is the ticking shared-clock delta a
		// test can advance to prove the feed age (feed_freshness_s + ageSeconds) ticks.
		live: { ageSeconds: 20 as number | null },
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
			// The 8 fixed signed-minute buckets (the same trip-level delays that power
			// p50/p90). Distinct counts so the bars + a11y values are observable; the
			// 2..5 bucket is the tallest (proportional fill anchor). Mutable so a test
			// can null it to assert the section stands down.
			delay_histogram: [
				{ lo_min: null, hi_min: -5, count: 1 },
				{ lo_min: -5, hi_min: -2, count: 4 },
				{ lo_min: -2, hi_min: 0, count: 12 },
				{ lo_min: 0, hi_min: 2, count: 20 },
				{ lo_min: 2, hi_min: 5, count: 30 },
				{ lo_min: 5, hi_min: 10, count: 9 },
				{ lo_min: 10, hi_min: 15, count: 3 },
				{ lo_min: 15, hi_min: null, count: 2 },
			],
			// Per-route silent-trip counts, ordered count DESC / route_id ASC by the
			// builder. SUM(count)=3 equals the scalar non_responding above. Mutable so a
			// test can null/empty it to assert the section stands down.
			non_responding_by_route: [
				{ route_id: '51', count: 2 },
				{ route_id: '105', count: 1 },
			],
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
		// Additive coarser-grain series. Week-start / month-start dated; p90_min +
		// vehicles are null (14d-daily-only) — honest gaps. Distinct OTP values from
		// the daily fixture so the plotted-series swap is observable. Mutable so the
		// "stands down when empty" test can clear them.
		weeklySeries: [
			{ date: '2026-06-01', otp_pct: 75, avg_delay_min: 2.4, p90_min: null, vehicles: null },
			{ date: '2026-06-08', otp_pct: 77, avg_delay_min: 2.2, p90_min: null, vehicles: null },
			{ date: '2026-06-15', otp_pct: 83, avg_delay_min: 1.6, p90_min: null, vehicles: null },
		] satisfies TrendPoint[] as TrendPoint[],
		monthlySeries: [
			{ date: '2026-04-01', otp_pct: 72, avg_delay_min: 2.8, p90_min: null, vehicles: null },
			{ date: '2026-05-01', otp_pct: 76, avg_delay_min: 2.5, p90_min: null, vehicles: null },
		] satisfies TrendPoint[] as TrendPoint[],
		// Network-wide by-shift readout: the HEADLINE is the real OTP %, ranked
		// worst-PUNCTUALITY first (lowest OTP first) → pm_peak (79%) precedes am_peak
		// (88%). `night` carries a null OTP AND null severe share → it is DROPPED
		// (honesty: never a fabricated 0). Mutable for the empty test.
		byShift: [
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'pm_peak', otp_pct: 79, avg_delay_min: 2.6, severe_pct: 7.4 },
			{ grain: 'night', otp_pct: null, avg_delay_min: null, severe_pct: null },
		] satisfies NetworkShift[] as NetworkShift[],
		// Weekday (84%) vs weekend (81% — worst punctuality) → weekend ranks first.
		byDaytype: [
			{ grain: 'weekday', otp_pct: 84, avg_delay_min: 1.9, severe_pct: 4.1 },
			{ grain: 'weekend', otp_pct: 81, avg_delay_min: 2.3, severe_pct: 6.2 },
		] satisfies NetworkShift[] as NetworkShift[],
	}));

vi.mock('$lib/nav', async () => {
	return {
		layout: { isDesktop: true },
		openSurface,
		// The non-responding-by-route rows deep-link to /route/[id]; mirror the real
		// routeFor's line-detail mapping (kind:'line' → /route/{id}) so the link href
		// assertions exercise the same canonical shape the surface uses in prod.
		routeFor: (t: { kind: string; id?: string }) =>
			t.kind === 'line' && t.id ? `/route/${encodeURIComponent(t.id)}` : '/lines',
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
			get ageSeconds() {
				return live.ageSeconds;
			},
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
			data: isProvenance
				? { conformance: null }
				: {
						series: trendSeries,
						weekly: weeklySeries,
						monthly: monthlySeries,
						by_shift: byShift,
						by_daytype: byDaytype,
					},
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

	it('surfaces the worker-feed-age chip near the FreshnessStamp', () => {
		render(NetworkHealth);
		const chip = screen.getByText('FEED').closest('[data-slot="feed-age"]');
		expect(chip).not.toBeNull();
		// A human age string (formatRelativeSeconds), never a raw "20".
		expect((chip as HTMLElement).getAttribute('aria-label')).toContain('Worker feed updated');
	});

	it('ticks the feed age between polls by adding the live shared-clock delta', () => {
		// feed_freshness_s = 20 (as of the snapshot) + live.ageSeconds = 40 elapsed
		// since the snapshot was generated → the displayed feed age is 60s, NOT the
		// frozen 20s. Proving the chip advances with the shared clock between polls.
		live.ageSeconds = 40;
		render(NetworkHealth);
		const chip = screen.getByText('FEED').closest('[data-slot="feed-age"]') as HTMLElement;
		// 20 + 40 = 60s → "a minute ago" (Intl numeric:auto), never "20 seconds ago".
		const value = chip.querySelector('.network-feed-age-value')?.textContent ?? '';
		expect(value).toMatch(/minute/i);
		expect(value).not.toMatch(/20 seconds/i);
		live.ageSeconds = 20;
	});

	it('keeps the feed age null (no chip) when feed_freshness_s is null', () => {
		network.feed_freshness_s = null;
		render(NetworkHealth);
		expect(document.querySelector('[data-slot="feed-age"]')).toBeNull();
		network.feed_freshness_s = 20;
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

describe('NetworkHealth delay distribution', () => {
	it('renders the 8-bucket histogram with per-bucket counts and edge labels', () => {
		render(NetworkHealth);
		const list = screen.getByRole('list', { name: /Distribution of trip-average delays/i });
		// 8 fixed buckets always emit (zeros included) when the field is present.
		const rows = within(list).getAllByRole('listitem');
		expect(rows).toHaveLength(8);
		// Each row's accessible name carries its edge label + count ("<bucket> min: <n> trips").
		expect(within(list).getByLabelText('< -5 min: 1 trip')).toBeInTheDocument();
		expect(within(list).getByLabelText('2 to 5 min: 30 trips')).toBeInTheDocument();
		expect(within(list).getByLabelText('15+ min: 2 trips')).toBeInTheDocument();
	});

	it('stands the histogram down when delay_histogram is null', () => {
		network.delay_histogram = null;
		render(NetworkHealth);
		expect(screen.queryByRole('list', { name: /Distribution of trip-average delays/i })).toBeNull();
		expect(document.querySelector('[data-slot="delay-histogram"]')).toBeNull();
		network.delay_histogram = [
			{ lo_min: null, hi_min: -5, count: 1 },
			{ lo_min: -5, hi_min: -2, count: 4 },
			{ lo_min: -2, hi_min: 0, count: 12 },
			{ lo_min: 0, hi_min: 2, count: 20 },
			{ lo_min: 2, hi_min: 5, count: 30 },
			{ lo_min: 5, hi_min: 10, count: 9 },
			{ lo_min: 10, hi_min: 15, count: 3 },
			{ lo_min: 15, hi_min: null, count: 2 },
		];
	});
});

describe('NetworkHealth non-responding by route', () => {
	it('renders a ranked list of silent lines, each deep-linking to /route/[id]', () => {
		render(NetworkHealth);
		const list = screen.getByRole('list', {
			name: /scheduled trips currently running with no live vehicle/i,
		});
		// Two routes, worst (count DESC) first → 51 (2) before 105 (1).
		const links = within(list).getAllByRole('link');
		expect(links).toHaveLength(2);
		expect(links[0]).toHaveAttribute('href', '/route/51');
		expect(links[0]).toHaveAttribute('aria-label', 'View line 51');
		expect(links[1]).toHaveAttribute('href', '/route/105');
		// The per-route silent-trip count reads in the row display.
		expect(within(list).getByText('2 trips')).toBeInTheDocument();
		expect(within(list).getByText('1 trip')).toBeInTheDocument();
	});

	it('uses the list > listitem > link a11y shape (li owns the listitem role)', () => {
		render(NetworkHealth);
		const list = screen.getByRole('list', {
			name: /scheduled trips currently running with no live vehicle/i,
		});
		// Each <li> is the listitem; the inner RankedRow is `bare` (no self role).
		const items = within(list).getAllByRole('listitem');
		expect(items).toHaveLength(2);
	});

	it('renders the silent-trips block as its OWN full-width row, not inside the distribution grid (C2)', () => {
		render(NetworkHealth);
		// The block is lifted into its own section beneath the distribution board.
		const section = document.querySelector('[data-slot="non-responding-section"]');
		expect(section).not.toBeNull();
		const list = document.querySelector('[data-slot="non-responding-by-route"]');
		expect(list).not.toBeNull();
		// The list is contained by the dedicated section…
		expect(section!.contains(list)).toBe(true);
		// …and crucially NOT nested inside any DashboardGrid cell (it is no longer a
		// cramped, mis-sized cell beside the status/crowding/histogram tiles).
		expect(list!.closest('[data-slot="dashboard-grid"]')).toBeNull();
	});

	it('lifts the delay distribution into its OWN full-width row, not inside the distribution grid (D)', () => {
		render(NetworkHealth);
		// The histogram is now its own deliberate full-width section beneath the grid,
		// the way the silent-trips tile was lifted (C2) — no longer a cramped cell.
		const section = document.querySelector('[data-slot="delay-histogram-section"]');
		expect(section).not.toBeNull();
		const hist = document.querySelector('[data-slot="delay-histogram"]');
		expect(hist).not.toBeNull();
		// The histogram lives inside the dedicated section…
		expect(section!.contains(hist)).toBe(true);
		// …and is NOT nested inside any DashboardGrid cell anymore.
		expect(hist!.closest('[data-slot="dashboard-grid"]')).toBeNull();
	});

	it('stands the section down when non_responding_by_route is null', () => {
		network.non_responding_by_route = null;
		render(NetworkHealth);
		expect(
			screen.queryByRole('list', {
				name: /scheduled trips currently running with no live vehicle/i,
			}),
		).toBeNull();
		expect(document.querySelector('[data-slot="non-responding-by-route"]')).toBeNull();
		network.non_responding_by_route = [
			{ route_id: '51', count: 2 },
			{ route_id: '105', count: 1 },
		];
	});

	it('stands the section down when non_responding_by_route is an empty list', () => {
		network.non_responding_by_route = [];
		render(NetworkHealth);
		expect(document.querySelector('[data-slot="non-responding-by-route"]')).toBeNull();
		network.non_responding_by_route = [
			{ route_id: '51', count: 2 },
			{ route_id: '105', count: 1 },
		];
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

describe('NetworkHealth trend grain (day/week/month)', () => {
	const weeklyOriginal = weeklySeries.slice();
	const monthlyOriginal = monthlySeries.slice();
	afterEach(() => {
		weeklySeries.splice(0, weeklySeries.length, ...weeklyOriginal);
		monthlySeries.splice(0, monthlySeries.length, ...monthlyOriginal);
	});

	/** The day-grain delay TrendLine (scoped by its summary aria-label). */
	const trendFigure = (container: HTMLElement) =>
		container.querySelector(
			'[data-slot="trend-line"][aria-label*="chosen delay series"]',
		) as HTMLElement;

	it('offers a day/week/month grain picker when the coarse series carry data', () => {
		render(NetworkHealth);
		const group = screen.getByRole('radiogroup', { name: 'Trend grain' });
		expect(within(group).getByRole('radio', { name: 'Day' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: 'Week' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: 'Month' })).toBeInTheDocument();
	});

	it('switches the plotted series from daily to weekly when "Week" is picked', async () => {
		const { container } = render(NetworkHealth);

		// Day grain: 2 daily points, OTP 78/81 — the latest reads the p90 series.
		const dayTargets = within(trendFigure(container)).getAllByRole('img');
		expect(dayTargets).toHaveLength(2);
		expect(dayTargets[dayTargets.length - 1].getAttribute('aria-label')).toContain('On-time % 81%');

		// Pick Week → the weekly series (3 points, OTP 75/77/83) feeds the chart.
		await fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
		const weekTargets = within(trendFigure(container)).getAllByRole('img');
		expect(weekTargets).toHaveLength(3);
		expect(weekTargets[weekTargets.length - 1].getAttribute('aria-label')).toContain(
			'On-time % 83%',
		);
	});

	it('switches the plotted series to monthly when "Month" is picked', async () => {
		const { container } = render(NetworkHealth);
		await fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
		const monthTargets = within(trendFigure(container)).getAllByRole('img');
		// Monthly fixture carries 2 month-start points.
		expect(monthTargets).toHaveLength(2);
		expect(monthTargets[monthTargets.length - 1].getAttribute('aria-label')).toContain(
			'On-time % 76%',
		);
	});

	it('hides the daily-only marks under week/month (window picker, vehicles spark, per-day crowding)', async () => {
		render(NetworkHealth);
		// Day grain shows the window picker + per-day crowding small-multiple.
		expect(screen.getByRole('radiogroup', { name: 'Trend window' })).toBeInTheDocument();
		expect(screen.getByRole('list', { name: /Crowding band mix per day/i })).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('radio', { name: 'Week' }));

		// Week grain: window picker stands down; per-day crowding small-multiple gone;
		// the vehicles context caption (daily-only) is gone.
		expect(screen.queryByRole('radiogroup', { name: 'Trend window' })).toBeNull();
		expect(screen.queryByRole('list', { name: /Crowding band mix per day/i })).toBeNull();
		expect(screen.queryByText('Vehicles reporting each day')).toBeNull();
	});

	it('disables the p90 delay segment on week/month (p90 is null there) and reads avg', async () => {
		const { container } = render(NetworkHealth);
		await fireEvent.click(screen.getByRole('radio', { name: 'Week' }));

		// p90 ("Slowest 10%") is disabled on the coarse grain; the retard channel
		// reads the avg-delay series under the median label (never a flat-null line).
		const delayGroup = screen.getByRole('radiogroup', { name: 'Delay series' });
		expect(within(delayGroup).getByRole('radio', { name: 'Slowest 10%' })).toBeDisabled();

		const targets = within(trendFigure(container)).getAllByRole('img');
		const last = targets[targets.length - 1];
		// Latest weekly avg_delay_min = 1.6 → reads under the median label, not p90.
		expect(last.getAttribute('aria-label')).toContain('Median delay 1.6 min');
		expect(last.getAttribute('aria-label')).not.toContain('Slowest 10% (min)');
	});

	it('stands the grain picker down when no coarse series carries data', () => {
		weeklySeries.splice(0, weeklySeries.length);
		monthlySeries.splice(0, monthlySeries.length);
		render(NetworkHealth);
		// Only the daily series exists → a lone "Day" chip is a dead control → no picker.
		expect(screen.queryByRole('radiogroup', { name: 'Trend grain' })).toBeNull();
		// The daily trend still renders (the window picker is present).
		expect(screen.getByRole('radiogroup', { name: 'Trend window' })).toBeInTheDocument();
	});

	it('offers the grain picker when only weekly data exists (monthly empty)', () => {
		monthlySeries.splice(0, monthlySeries.length);
		render(NetworkHealth);
		const group = screen.getByRole('radiogroup', { name: 'Trend grain' });
		expect(within(group).getByRole('radio', { name: 'Week' })).not.toBeDisabled();
		// Month carries no data → its segment is disabled (never a dead pick).
		expect(within(group).getByRole('radio', { name: 'Month' })).toBeDisabled();
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

describe('NetworkHealth by time of day + weekday/weekend', () => {
	afterEach(() => {
		// Restore the default fixtures after the empty-section mutations below.
		byShift.splice(
			0,
			byShift.length,
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'pm_peak', otp_pct: 79, avg_delay_min: 2.6, severe_pct: 7.4 },
			{ grain: 'night', otp_pct: null, avg_delay_min: null, severe_pct: null },
		);
		byDaytype.splice(
			0,
			byDaytype.length,
			{ grain: 'weekday', otp_pct: 84, avg_delay_min: 1.9, severe_pct: 4.1 },
			{ grain: 'weekend', otp_pct: 81, avg_delay_min: 2.3, severe_pct: 6.2 },
		);
	});

	it('leads each by-time-of-day row with the real OTP %, ranked worst-punctuality first', () => {
		render(NetworkHealth);
		const list = screen.getByRole('list', { name: /ranked by time of day/i });
		const rows = within(list).getAllByText(/peak/i);
		// Worst punctuality first: pm_peak (OTP 79%) precedes am_peak (OTP 88%).
		expect(rows[0]).toHaveTextContent('PM peak');
		expect(rows[1]).toHaveTextContent('AM peak');
		// The HEADLINE per row is the real OTP %, not the severe share.
		expect(within(list).getByText('79%')).toBeInTheDocument();
		expect(within(list).getByText('88%')).toBeInTheDocument();
		// The severe share + avg delay survive as the secondary subtitle reading.
		expect(within(list).getByText(/avg delay 2\.6 min · severe 7\.4%/i)).toBeInTheDocument();
		expect(within(list).getByText(/avg delay 1\.4 min · severe 3\.0%/i)).toBeInTheDocument();
	});

	it('drops a shift grain with no OTP and no severe share (no fabricated 0)', () => {
		render(NetworkHealth);
		const list = screen.getByRole('list', { name: /ranked by time of day/i });
		// `night` carries otp_pct:null AND severe_pct:null → dropped entirely (honesty).
		expect(within(list).queryByText('Night')).toBeNull();
	});

	it('keeps a null-OTP grain (with a real severe share) and shows honest no-data, never a fake 0%', () => {
		// midday has NO otp but a real severe share → it stays (ordered after the
		// OTP-known grains) and its headline reads the localized no-data string.
		byShift.splice(
			0,
			byShift.length,
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'midday', otp_pct: null, avg_delay_min: 2.0, severe_pct: 9.0 },
		);
		render(NetworkHealth);
		const list = screen.getByRole('list', { name: /ranked by time of day/i });
		const midday = within(list).getByText('Midday').closest('[data-slot="ranked-row"]');
		expect(midday).not.toBeNull();
		// Honest no-data headline (never "0%") for the OTP-unknown grain.
		expect(within(midday as HTMLElement).getByText('no data')).toBeInTheDocument();
		expect(within(midday as HTMLElement).queryByText('0%')).toBeNull();
		// The OTP-known am_peak grain sorts BEFORE the OTP-unknown midday grain.
		const am = within(list).getByText('AM peak');
		expect(
			am.compareDocumentPosition(within(list).getByText('Midday')) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it('renders the weekday-vs-weekend list worst-punctuality first (weekend before weekday)', () => {
		render(NetworkHealth);
		const list = screen.getByRole('list', { name: /weekdays versus weekends/i });
		const weekend = within(list).getByText('Weekend');
		const weekday = within(list).getByText('Weekday');
		expect(weekend).toBeInTheDocument();
		expect(weekday).toBeInTheDocument();
		// Weekend (OTP 81%) ranks ahead of weekday (OTP 84%) in DOM order.
		expect(
			weekend.compareDocumentPosition(weekday) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		// Both lead with the real OTP % headline.
		expect(within(list).getByText('81%')).toBeInTheDocument();
		expect(within(list).getByText('84%')).toBeInTheDocument();
	});

	it('prints the honest trailing-window caveat under the readout', () => {
		render(NetworkHealth);
		const caveat = document.querySelector('[data-slot="shift-caveat"]');
		expect(caveat).not.toBeNull();
		expect((caveat as HTMLElement).textContent).toMatch(/not certified/i);
	});

	it('stands the whole section down when by_shift + by_daytype are both empty', () => {
		byShift.splice(0, byShift.length);
		byDaytype.splice(0, byDaytype.length);
		render(NetworkHealth);
		expect(screen.queryByText('By time of day')).toBeNull();
		expect(screen.queryByText('Weekday vs weekend')).toBeNull();
		expect(document.querySelector('[data-slot="network-shift"]')).toBeNull();
	});

	it('shows only the day-type list when by_shift is empty but by_daytype has data', () => {
		byShift.splice(0, byShift.length);
		render(NetworkHealth);
		expect(screen.queryByText('By time of day')).toBeNull();
		expect(screen.getByText('Weekday vs weekend')).toBeInTheDocument();
		// The section as a whole stays up (the day-type group still carries data).
		expect(document.querySelector('[data-slot="network-shift"]')).not.toBeNull();
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

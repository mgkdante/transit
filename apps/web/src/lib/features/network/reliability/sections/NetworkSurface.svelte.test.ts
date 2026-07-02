import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkFile, NetworkShift, TrendPoint } from '$lib/v1';
import type { IsoUtc } from '$lib/v1/schemas';
import NetworkSurface from './NetworkSurface.svelte';

const { openSurface, live, network, trendSeries, weeklySeries, monthlySeries, byShift, byDaytype } =
	vi.hoisted(() => ({
		openSurface: vi.fn(),
		live: { ageSeconds: 20 as number | null },
		network: {
			generated_utc: '2026-06-16T02:00:00Z' as IsoUtc,
			vehicles_in_service: 10,
			on_time_pct: 80,
			status_dist: { early: 0, on_time: 8, late: 2, severe: 0, unknown: 0 },
			delay_p50_min: 1,
			delay_p90_min: 6,
			non_responding: 3,
			feed_freshness_s: 20,
			coverage_pct: 95,
			occupancy_mix: null,
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
			non_responding_by_route: [
				{ route_id: '51', count: 2 },
				{ route_id: '105', count: 1 },
			],
		} satisfies NetworkFile as NetworkFile,
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
		weeklySeries: [
			{ date: '2026-06-01', otp_pct: 75, avg_delay_min: 2.4, p90_min: null, vehicles: null },
			{ date: '2026-06-08', otp_pct: 77, avg_delay_min: 2.2, p90_min: null, vehicles: null },
			{ date: '2026-06-15', otp_pct: 83, avg_delay_min: 1.6, p90_min: null, vehicles: null },
		] satisfies TrendPoint[] as TrendPoint[],
		monthlySeries: [
			{ date: '2026-04-01', otp_pct: 72, avg_delay_min: 2.8, p90_min: null, vehicles: null },
			{ date: '2026-05-01', otp_pct: 76, avg_delay_min: 2.5, p90_min: null, vehicles: null },
		] satisfies TrendPoint[] as TrendPoint[],
		byShift: [
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'pm_peak', otp_pct: 79, avg_delay_min: 2.6, severe_pct: 7.4 },
			{ grain: 'night', otp_pct: null, avg_delay_min: null, severe_pct: null },
		] satisfies NetworkShift[] as NetworkShift[],
		byDaytype: [
			{ grain: 'weekday', otp_pct: 84, avg_delay_min: 1.9, severe_pct: 4.1 },
			{ grain: 'weekend', otp_pct: 81, avg_delay_min: 2.3, severe_pct: 6.2 },
		] satisfies NetworkShift[] as NetworkShift[],
	}));

vi.mock('$lib/nav', async () => {
	return {
		layout: { isDesktop: true },
		openSurface,
		routeFor: (t: { kind: string; id?: string }) =>
			t.kind === 'line' && t.id ? `/lines/${encodeURIComponent(t.id)}` : '/lines',
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

describe('NetworkSurface drilldown', () => {
	it('opens the live map with a status filter when a status segment is selected', async () => {
		openSurface.mockClear();
		render(NetworkSurface);
		await fireEvent.click(screen.getByRole('img', { name: 'Late: 20%' }));
		expect(openSurface).toHaveBeenCalledExactlyOnceWith({ kind: 'map', search: 'status=late' });
	});

	it('opens the live map with an occupancy filter when a crowding segment is selected', async () => {
		network.occupancy_mix = {
			empty: 0.2,
			many_seats: 0.3,
			few_seats: 0.2,
			standing: 0.2,
			full: 0.1,
		};
		openSurface.mockClear();
		render(NetworkSurface);
		await fireEvent.click(screen.getByRole('img', { name: 'Standing: 20%' }));
		expect(openSurface).toHaveBeenCalledExactlyOnceWith({
			kind: 'map',
			search: 'occupancy=standing',
		});
		network.occupancy_mix = null;
	});
});

describe('NetworkSurface live cards (S9C)', () => {
	it('renders the four headline scalars as ExplainedMetricCards with the (i) affordance', () => {
		render(NetworkSurface);
		// The four glance cards each render an ExplainedMetricCard wrapper + the (i) info affordance.
		const cards = document.querySelectorAll('[data-slot="explained-metric-card"]');
		// four headline + two reporting + one cancellation latest = at least the four headline.
		expect(cards.length).toBeGreaterThanOrEqual(4);
		expect(
			document.querySelectorAll('[data-slot="explained-metric-info"]').length,
		).toBeGreaterThanOrEqual(4);
		// The on-time headline reads its real value inside a card's inner MetricDisplay.
		const otpTile = screen.getByText('Median delay').closest('[data-slot="explained-metric-card"]');
		expect(otpTile).not.toBeNull();
	});

	it('renders the styled honest-absence chip (not a plain "no data") for a null live tile', () => {
		network.delay_p50_min = null;
		render(NetworkSurface);
		const tile = screen
			.getByText('Median delay')
			.closest('[data-slot="metric-display"]') as HTMLElement;
		expect(tile).not.toBeNull();
		const chip = tile.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect((chip as HTMLElement).getAttribute('aria-label')).toMatch(
			/not reported in the live feed/i,
		);
		expect(within(tile).queryByText('no data')).toBeNull();
		network.delay_p50_min = 1;
	});

	it('keeps a real measured 0% as a real value (never an absence chip)', () => {
		network.coverage_pct = 0;
		render(NetworkSurface);
		const tile = screen
			.getByText('Coverage')
			.closest('[data-slot="metric-display"]') as HTMLElement;
		expect(within(tile).getByText('0%')).toBeInTheDocument();
		expect(tile.querySelector('[data-slot="absent-value"]')).toBeNull();
		network.coverage_pct = 95;
	});

	it('surfaces the worker-feed-age chip near the FreshnessStamp', () => {
		render(NetworkSurface);
		const chip = screen.getByText('FEED').closest('[data-slot="feed-age"]');
		expect(chip).not.toBeNull();
		expect((chip as HTMLElement).getAttribute('aria-label')).toContain('Worker feed updated');
	});

	it('ticks the feed age between polls by adding the live shared-clock delta', () => {
		live.ageSeconds = 40;
		render(NetworkSurface);
		const chip = screen.getByText('FEED').closest('[data-slot="feed-age"]') as HTMLElement;
		const value = chip.querySelector('.network-feed-age-value')?.textContent ?? '';
		expect(value).toMatch(/minute/i);
		expect(value).not.toMatch(/20 seconds/i);
		live.ageSeconds = 20;
	});

	it('keeps the feed age null (no chip) when feed_freshness_s is null', () => {
		network.feed_freshness_s = null;
		render(NetworkSurface);
		expect(document.querySelector('[data-slot="feed-age"]')).toBeNull();
		network.feed_freshness_s = 20;
	});
});

describe('NetworkSurface reporting row (S9C vehicles-reporting own row)', () => {
	it('groups vehicles-in-service + non_responding + the silent-lines list under its own section', () => {
		render(NetworkSurface);
		const section = document.querySelector('[data-slot="reporting-section"]') as HTMLElement;
		expect(section).not.toBeNull();
		// The non_responding total card + the vehicles card live in the reporting row.
		expect(within(section).getByText('Vehicles in service')).toBeInTheDocument();
		expect(within(section).getByText('Not reporting')).toBeInTheDocument();
		// The silent-by-route list lives inside the same section.
		const list = within(section).getByRole('list', {
			name: /scheduled trips currently running with no live vehicle/i,
		});
		expect(list).not.toBeNull();
	});

	it('states the global-signal caveat (per-line tally, not identifiable buses)', () => {
		render(NetworkSurface);
		const caveat = document.querySelector('[data-slot="reporting-caveat"]');
		expect(caveat).not.toBeNull();
		expect((caveat as HTMLElement).textContent).toMatch(/not identifiable buses/i);
	});

	it('renders a ranked list of silent lines, each deep-linking to /lines/[id]', () => {
		render(NetworkSurface);
		const list = screen.getByRole('list', {
			name: /scheduled trips currently running with no live vehicle/i,
		});
		const links = within(list).getAllByRole('link');
		expect(links).toHaveLength(2);
		expect(links[0]).toHaveAttribute('href', '/lines/51');
		expect(links[0]).toHaveAttribute('aria-label', 'View line 51');
		expect(links[1]).toHaveAttribute('href', '/lines/105');
		expect(within(list).getByText('2 trips')).toBeInTheDocument();
		expect(within(list).getByText('1 trip')).toBeInTheDocument();
	});

	it('stands the silent list down when non_responding_by_route is null (scalar total remains)', () => {
		network.non_responding_by_route = null;
		render(NetworkSurface);
		expect(document.querySelector('[data-slot="non-responding-by-route"]')).toBeNull();
		// The reporting section still stands (the non_responding scalar card carries the total).
		expect(document.querySelector('[data-slot="reporting-section"]')).not.toBeNull();
		network.non_responding_by_route = [
			{ route_id: '51', count: 2 },
			{ route_id: '105', count: 1 },
		];
	});
});

describe('NetworkSurface delay distribution (ChartSpec re-seat)', () => {
	it('renders the histogram through the Chart kernel (its own mark slot) inside its full-width section', () => {
		render(NetworkSurface);
		const section = document.querySelector('[data-slot="delay-histogram-section"]');
		expect(section).not.toBeNull();
		const canvas = document.querySelector('[data-slot="delay-histogram"]');
		expect(canvas).not.toBeNull();
		// The Chart renders the A1 HistogramMark (not the old hand-rolled /max <ul>).
		expect(canvas!.querySelector('[data-slot="histogram-mark"]')).not.toBeNull();
		// The section is NOT nested inside a DashboardGrid cell (its own deliberate row).
		expect(canvas!.closest('[data-slot="dashboard-grid"]')).toBeNull();
	});

	it('carries all 8 signed-minute buckets in the mark sr-only table', () => {
		render(NetworkSurface);
		const mark = document.querySelector('[data-slot="histogram-mark"]') as HTMLElement;
		// The AT-fallback table carries EVERY bucket (incl. the clipped 15+ overflow bin).
		const rows = mark.querySelectorAll('table tbody tr');
		expect(rows).toHaveLength(8);
	});

	it('stands the histogram section down when delay_histogram is null', () => {
		network.delay_histogram = null;
		render(NetworkSurface);
		expect(document.querySelector('[data-slot="delay-histogram-section"]')).toBeNull();
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

describe('NetworkSurface trend window + series', () => {
	it('offers a 7/30/90-day trend window selector', () => {
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Trend window' });
		expect(within(group).getByRole('radio', { name: '7d' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: '30d' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: '90d' })).toBeInTheDocument();
	});

	it('disables a window longer than the available series (2 days → 30d/90d disabled)', () => {
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Trend window' });
		expect(within(group).getByRole('radio', { name: '7d' })).not.toBeDisabled();
		expect(within(group).getByRole('radio', { name: '30d' })).toBeDisabled();
		expect(within(group).getByRole('radio', { name: '90d' })).toBeDisabled();
	});

	it('offers a delay-series toggle (slowest 10% vs typical)', () => {
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Delay series' });
		expect(within(group).getByRole('radio', { name: 'Slowest 10%' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: 'Typical' })).toBeInTheDocument();
	});

	it('switches the retard channel from p90 to the avg/median series when "Typical" is picked', async () => {
		const { container } = render(NetworkSurface);
		const figure = container.querySelector(
			'[data-slot="trend-line"][aria-label*="chosen delay series"]',
		) as HTMLElement;
		expect(figure).not.toBeNull();
		const targetsP90 = within(figure).getAllByRole('img');
		const lastP90 = targetsP90[targetsP90.length - 1];
		expect(lastP90.getAttribute('aria-label')).toContain('Slowest 10% (min) 6 min');

		await fireEvent.click(screen.getByRole('radio', { name: 'Typical' }));
		const targetsAvg = within(figure).getAllByRole('img');
		const lastAvg = targetsAvg[targetsAvg.length - 1];
		expect(lastAvg.getAttribute('aria-label')).toContain('Median delay 1.8 min');
		expect(lastAvg.getAttribute('aria-label')).not.toContain('Slowest 10% (min)');
	});
});

describe('NetworkSurface trend grain (day/week/month)', () => {
	const weeklyOriginal = weeklySeries.slice();
	const monthlyOriginal = monthlySeries.slice();
	afterEach(() => {
		weeklySeries.splice(0, weeklySeries.length, ...weeklyOriginal);
		monthlySeries.splice(0, monthlySeries.length, ...monthlyOriginal);
	});

	const trendFigure = (container: HTMLElement) =>
		container.querySelector(
			'[data-slot="trend-line"][aria-label*="chosen delay series"]',
		) as HTMLElement;

	it('offers a day/week/month grain picker when the coarse series carry data', () => {
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Trend grain' });
		expect(within(group).getByRole('radio', { name: 'Day' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: 'Week' })).toBeInTheDocument();
		expect(within(group).getByRole('radio', { name: 'Month' })).toBeInTheDocument();
	});

	it('switches the plotted series from daily to weekly when "Week" is picked (never flattened)', async () => {
		const { container } = render(NetworkSurface);
		const dayTargets = within(trendFigure(container)).getAllByRole('img');
		expect(dayTargets).toHaveLength(2);
		expect(dayTargets[dayTargets.length - 1].getAttribute('aria-label')).toContain('On-time % 81%');

		await fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
		const weekTargets = within(trendFigure(container)).getAllByRole('img');
		expect(weekTargets).toHaveLength(3);
		expect(weekTargets[weekTargets.length - 1].getAttribute('aria-label')).toContain(
			'On-time % 83%',
		);
	});

	it('switches the plotted series to monthly when "Month" is picked', async () => {
		const { container } = render(NetworkSurface);
		await fireEvent.click(screen.getByRole('radio', { name: 'Month' }));
		const monthTargets = within(trendFigure(container)).getAllByRole('img');
		expect(monthTargets).toHaveLength(2);
		expect(monthTargets[monthTargets.length - 1].getAttribute('aria-label')).toContain(
			'On-time % 76%',
		);
	});

	it('hides the daily-only marks under week/month (window picker, vehicles row, per-day crowding)', async () => {
		render(NetworkSurface);
		expect(screen.getByRole('radiogroup', { name: 'Trend window' })).toBeInTheDocument();
		expect(screen.getByRole('list', { name: /Crowding band mix per day/i })).toBeInTheDocument();
		expect(screen.getByText('Vehicles reporting each day')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
		expect(screen.queryByRole('radiogroup', { name: 'Trend window' })).toBeNull();
		expect(screen.queryByRole('list', { name: /Crowding band mix per day/i })).toBeNull();
		expect(screen.queryByText('Vehicles reporting each day')).toBeNull();
	});

	it('disables the p90 delay segment on week/month (p90 is null there) and reads avg', async () => {
		const { container } = render(NetworkSurface);
		await fireEvent.click(screen.getByRole('radio', { name: 'Week' }));
		const delayGroup = screen.getByRole('radiogroup', { name: 'Delay series' });
		expect(within(delayGroup).getByRole('radio', { name: 'Slowest 10%' })).toBeDisabled();
		const targets = within(trendFigure(container)).getAllByRole('img');
		const last = targets[targets.length - 1];
		expect(last.getAttribute('aria-label')).toContain('Median delay 1.6 min');
		expect(last.getAttribute('aria-label')).not.toContain('Slowest 10% (min)');
	});

	it('stands the grain picker down when no coarse series carries data', () => {
		weeklySeries.splice(0, weeklySeries.length);
		monthlySeries.splice(0, monthlySeries.length);
		render(NetworkSurface);
		expect(screen.queryByRole('radiogroup', { name: 'Trend grain' })).toBeNull();
		expect(screen.getByRole('radiogroup', { name: 'Trend window' })).toBeInTheDocument();
	});

	it('offers the grain picker when only weekly data exists (monthly empty)', () => {
		monthlySeries.splice(0, monthlySeries.length);
		render(NetworkSurface);
		const group = screen.getByRole('radiogroup', { name: 'Trend grain' });
		expect(within(group).getByRole('radio', { name: 'Week' })).not.toBeDisabled();
		expect(within(group).getByRole('radio', { name: 'Month' })).toBeDisabled();
	});
});

describe('NetworkSurface cancellation trend', () => {
	it('renders the cancellation block with the latest value when the series carries data', () => {
		render(NetworkSurface);
		const tile = screen.getByText('Canceled (latest day)').closest('[data-slot="metric-display"]');
		expect(tile).not.toBeNull();
		expect(within(tile as HTMLElement).getByText('2.6%')).toBeInTheDocument();
	});
});

describe('NetworkSurface per-day crowding', () => {
	it('renders a per-day crowding small-multiple skipping days with no telemetry', () => {
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /Crowding band mix per day/i });
		expect(within(list).getByText('Jun 15')).toBeInTheDocument();
		expect(within(list).queryByText('Jun 14')).toBeNull();
	});
});

describe('NetworkSurface by time of day + weekday/weekend', () => {
	afterEach(() => {
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
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /ranked by time of day/i });
		const rows = within(list).getAllByText(/peak/i);
		expect(rows[0]).toHaveTextContent('PM peak');
		expect(rows[1]).toHaveTextContent('AM peak');
		expect(within(list).getByText('79%')).toBeInTheDocument();
		expect(within(list).getByText('88%')).toBeInTheDocument();
		expect(within(list).getByText(/avg delay 2\.6 min · severe 7\.4%/i)).toBeInTheDocument();
	});

	it('drops a shift grain with no OTP and no severe share (no fabricated 0)', () => {
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /ranked by time of day/i });
		expect(within(list).queryByText('Night')).toBeNull();
	});

	it('keeps a null-OTP grain (real severe share) and shows the styled honest-absence chip, never a fake 0%', () => {
		byShift.splice(
			0,
			byShift.length,
			{ grain: 'am_peak', otp_pct: 88, avg_delay_min: 1.4, severe_pct: 3.0 },
			{ grain: 'midday', otp_pct: null, avg_delay_min: 2.0, severe_pct: 9.0 },
		);
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /ranked by time of day/i });
		const midday = within(list)
			.getByText('Midday')
			.closest('[data-slot="ranked-row"]') as HTMLElement;
		expect(midday).not.toBeNull();
		const chip = midday.querySelector('[data-slot="absent-value"]');
		expect(chip).not.toBeNull();
		expect((chip as HTMLElement).getAttribute('aria-label')).toMatch(/not enough readings/i);
		expect(within(midday).queryByText('0%')).toBeNull();
	});

	it('renders the weekday-vs-weekend list worst-punctuality first (weekend before weekday)', () => {
		render(NetworkSurface);
		const list = screen.getByRole('list', { name: /weekdays versus weekends/i });
		const weekend = within(list).getByText('Weekend');
		const weekday = within(list).getByText('Weekday');
		expect(
			weekend.compareDocumentPosition(weekday) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(within(list).getByText('81%')).toBeInTheDocument();
		expect(within(list).getByText('84%')).toBeInTheDocument();
	});

	it('prints the honest trailing-window caveat under the readout', () => {
		render(NetworkSurface);
		const caveat = document.querySelector('[data-slot="shift-caveat"]');
		expect(caveat).not.toBeNull();
		expect((caveat as HTMLElement).textContent).toMatch(/not certified/i);
	});

	it('stands the whole section down when by_shift + by_daytype are both empty', () => {
		byShift.splice(0, byShift.length);
		byDaytype.splice(0, byDaytype.length);
		render(NetworkSurface);
		expect(screen.queryByText('By time of day')).toBeNull();
		expect(screen.queryByText('Weekday vs weekend')).toBeNull();
		expect(document.querySelector('[data-slot="network-shift"]')).toBeNull();
	});

	it('shows only the day-type list when by_shift is empty but by_daytype has data', () => {
		byShift.splice(0, byShift.length);
		render(NetworkSurface);
		expect(screen.queryByText('By time of day')).toBeNull();
		expect(screen.getByText('Weekday vs weekend')).toBeInTheDocument();
		expect(document.querySelector('[data-slot="network-shift"]')).not.toBeNull();
	});
});

describe('NetworkSurface trend window re-slice', () => {
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
		const { container } = render(NetworkSurface);
		const figureFor = () =>
			container.querySelector(
				'[data-slot="trend-line"][aria-label*="chosen delay series"]',
			) as HTMLElement;

		const group = screen.getByRole('radiogroup', { name: 'Trend window' });
		expect(within(group).getByRole('radio', { name: '30d' })).not.toBeDisabled();
		expect(within(group).getByRole('radio', { name: '90d' })).toBeDisabled();
		expect(within(figureFor()).getAllByRole('img')).toHaveLength(30);

		await fireEvent.click(within(group).getByRole('radio', { name: '7d' }));
		expect(within(figureFor()).getAllByRole('img')).toHaveLength(7);
	});
});

describe('NetworkSurface OTP trend zoom (S9B min-span domain + reference)', () => {
	it('hands the on-time TrendLine a floored zoom domain (span >= 8) with the 80% reference', () => {
		const { container } = render(NetworkSurface);
		const figure = container.querySelector(
			'[data-slot="trend-line"][aria-label*="chosen delay series"]',
		) as HTMLElement;
		expect(figure).not.toBeNull();
		// The left y-tick gutter carries the clipped bounds (true values, not a normalized 0/100).
		// The daily fixture is otp 78/81 → padded+floored to an 8-pt window inside [0,100].
		const ticks = Array.from(figure.querySelectorAll('.dv-trendline-tick')).map(
			(t) => t.textContent ?? '',
		);
		const pctTicks = ticks
			.filter((t) => t.endsWith('%'))
			.map((t) => Number(t.replace('%', '')))
			.filter((n) => !Number.isNaN(n));
		expect(pctTicks.length).toBeGreaterThanOrEqual(2);
		const span = Math.max(...pctTicks) - Math.min(...pctTicks);
		expect(span).toBeGreaterThanOrEqual(8);
		expect(Math.min(...pctTicks)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...pctTicks)).toBeLessThanOrEqual(100);
	});
});

describe('NetworkSurface service completeness (S9B GC2 ramp-in)', () => {
	const original = trendSeries.slice();
	afterEach(() => {
		trendSeries.splice(0, trendSeries.length, ...original);
	});

	it('renders the completeness tile WITH its honest-absence note when every rate is null (B4)', () => {
		// The base fixture carries no service_completeness_rate → the tile stays rendered
		// and says why the value is absent (no data + why, never a missing section).
		render(NetworkSurface);
		const tile = document.querySelector('[data-slot="completeness-section"]') as HTMLElement;
		expect(tile).not.toBeNull();
		expect(tile.textContent).toContain('No data yet');
	});

	it('stands the completeness tile UP with the latest served rate when data accrues', () => {
		trendSeries.splice(
			0,
			trendSeries.length,
			{ ...original[0], service_completeness_rate: 91 },
			{ ...original[1], service_completeness_rate: 94.2 },
		);
		render(NetworkSurface);
		const tile = document.querySelector('[data-slot="completeness-section"]') as HTMLElement;
		expect(tile).not.toBeNull();
		expect(within(tile).getByText('Scheduled service delivered')).toBeInTheDocument();
		expect(within(tile).getByText('94.2%')).toBeInTheDocument();
		// The always-visible explainer carries the silent-trip framing.
		expect(within(tile).getByText(/never appears in the live feed/i)).toBeInTheDocument();
	});
});

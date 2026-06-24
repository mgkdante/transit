import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import RouteReliabilityClusters from './RouteReliabilityClusters.svelte';
import { reliabilityCopy } from './reliability.copy';
import type { RouteReliability, IsoUtc } from '$lib/v1';

const copy = reliabilityCopy.en;

/** Brand a plain string as IsoUtc for fixture literals (mirrors clusters.test.ts). */
const utc = (value: string): IsoUtc => value as IsoUtc;

// A fully-populated archive: every cluster has a signal, so all five bands and
// the snapshot strip render their data (not their empty state). The 'day' and
// 'week' periods carry DIFFERENT OTP so a grain switch is observable in the strip.
const populated: RouteReliability = {
	id: '141',
	generated_utc: utc('2026-06-19T02:00:00Z'),
	periods: [
		{
			grain: 'day',
			date: '2026-06-19',
			otp_pct: 82,
			avg_delay_min: 3.2,
			p50_min: 2,
			p90_min: 9,
			severe_pct: 4,
		},
		{
			grain: 'week',
			date: '2026-06-15',
			otp_pct: 77,
			avg_delay_min: 4.1,
			p50_min: 3,
			p90_min: 12,
			severe_pct: 7,
		},
		{
			grain: 'month',
			date: '2026-06',
			otp_pct: 79,
			avg_delay_min: 3.8,
			p50_min: 3,
			p90_min: 11,
			severe_pct: 6,
		},
	],
	headway: [
		{
			shift: 'AM peak',
			scheduled_min: 6,
			observed_min: 7.5,
			excess_wait_min: 1.5,
			cov: 0.32,
			bunched_pct: 12,
		},
		{
			shift: 'PM peak',
			scheduled_min: 6,
			observed_min: 8.2,
			excess_wait_min: 2.2,
			cov: 0.61,
			bunched_pct: 28,
		},
	],
	service_spans: [
		{
			date: '2026-06-19',
			first_trip_utc: utc('2026-06-19T09:30:00Z'),
			last_trip_utc: utc('2026-06-20T04:10:00Z'),
			service_span_min: 1120,
			first_trip_delay_min: 0.5,
			last_trip_delay_min: 1.2,
			trip_count: 214,
		},
	],
	cancellations: [
		{
			grain: 'day',
			date: '2026-06-18',
			cancellation_rate_pct: 1.4,
			canceled_trip_days: 3,
			total_trip_days: 214,
		},
		{
			grain: 'day',
			date: '2026-06-19',
			cancellation_rate_pct: 2.1,
			canceled_trip_days: 4,
			total_trip_days: 190,
		},
	],
	skipped_stops: [
		{
			date: '2026-06-19',
			skipped_stop_rate_pct: 0.8,
			skipped_stop_count: 12,
			stop_time_update_count: 1500,
		},
	],
	occupancy_mix: { empty: 0.1, many_seats: 0.2, few_seats: 0.15, standing: 0.45, full: 0.1 },
	habits: {
		scale: 'repeat_problem_relative',
		matrix: [
			[0.1, 0.2, null, 0.4],
			[null, 0.3, 0.5, 0.6],
		],
	},
	day_of_week: [
		{ day_of_week_iso: 1, avg_delay_min: 3.1, severe_pct: 4, observation_count: 500 },
		{ day_of_week_iso: 5, avg_delay_min: 6.4, severe_pct: 9, observation_count: 480 },
	],
	weak_stops: [
		{ id: 's1', name: 'Berri-UQAM', avg_delay_min: 8.2 },
		{ id: 's2', name: 'Pie-IX', avg_delay_min: 5.1 },
	],
};

describe('RouteReliabilityClusters', () => {
	it('renders all five numbered cluster overlines + the snapshot strip with populated data', () => {
		render(RouteReliabilityClusters, { props: { data: populated, locale: 'en' } });

		// All five numbered cluster overlines present, in surface order.
		expect(screen.getByText(copy.clusters.punctuality)).toBeInTheDocument();
		expect(screen.getByText(copy.clusters.waitRegularity)).toBeInTheDocument();
		expect(screen.getByText(copy.clusters.serviceDelivered)).toBeInTheDocument();
		expect(screen.getByText(copy.clusters.crowding)).toBeInTheDocument();
		expect(screen.getByText(copy.clusters.habits)).toBeInTheDocument();

		// Snapshot strip rendered its grid (not the single empty note): the default
		// 'day' grain OTP (82%) is the headline.
		expect(screen.getAllByText('82%').length).toBeGreaterThan(0);

		// The control spine offers the three discrete grains.
		expect(screen.getByText(copy.controls.today)).toBeInTheDocument();
		expect(screen.getByText(copy.controls.thisWeek)).toBeInTheDocument();
		expect(screen.getByText(copy.controls.thisMonth)).toBeInTheDocument();
	});

	it('renders every band honestly empty (no crash, no dropped section) with an empty contract', () => {
		// A minimal valid contract: only the two required identity fields, no data
		// arrays — every cluster must fall to its honest empty state.
		const empty: RouteReliability = { id: '141', generated_utc: utc('2026-06-19T02:00:00Z') };
		const { container } = render(RouteReliabilityClusters, {
			props: { data: empty, locale: 'en' },
		});

		// Bands are NEVER silently dropped: all five overlines still anchor their bands.
		expect(screen.getByText(copy.clusters.punctuality)).toBeInTheDocument();
		expect(screen.getByText(copy.clusters.waitRegularity)).toBeInTheDocument();
		expect(screen.getByText(copy.clusters.serviceDelivered)).toBeInTheDocument();
		expect(screen.getByText(copy.clusters.crowding)).toBeInTheDocument();
		expect(screen.getByText(copy.clusters.habits)).toBeInTheDocument();

		// The styled honest-absence chip appears (strip + bands all fall to it, each
		// saying WHY data is missing), never a fabricated value.
		expect(container.querySelectorAll('[data-slot="absent-value"]').length).toBeGreaterThan(0);
	});

	it('refines the snapshot strip when the grain control changes', async () => {
		// SPEC CHANGE (foundation): the grain control drives the SNAPSHOT STRIP (the
		// canonical grain-aware headline). Cluster01's three tiles are day-scoped
		// (latest closed day), so they keep showing the day value in any grain — we
		// therefore scope the grain-switch assertions to the strip, not the page.
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});
		const strip = () => {
			const el = container.querySelector('[data-slot="snapshot-strip"]');
			if (!el) throw new Error('snapshot strip not found');
			return within(el as HTMLElement);
		};

		// Default grain ('day') → strip OTP 82%; the week OTP (77%) is not yet shown.
		expect(strip().getAllByText('82%').length).toBeGreaterThan(0);
		expect(strip().queryByText('77%')).not.toBeInTheDocument();

		// Switch to "This week" → the strip re-answers for the week period (77%).
		await fireEvent.click(screen.getByRole('radio', { name: copy.controls.thisWeek }));

		expect(strip().getAllByText('77%').length).toBeGreaterThan(0);
		expect(strip().queryByText('82%')).not.toBeInTheDocument();
	});

	it('honours the FR canonical voice for the cluster overlines', () => {
		render(RouteReliabilityClusters, { props: { data: populated, locale: 'fr' } });

		expect(screen.getByText(reliabilityCopy.fr.clusters.punctuality)).toBeInTheDocument();
		expect(screen.getByText(reliabilityCopy.fr.clusters.crowding)).toBeInTheDocument();
		expect(screen.getByText(reliabilityCopy.fr.controls.today)).toBeInTheDocument();
	});

	it('offers a Date range segment when the contract carries dated day-periods', () => {
		render(RouteReliabilityClusters, { props: { data: populated, locale: 'en' } });
		expect(screen.getByRole('radio', { name: copy.controls.dateRange })).toBeInTheDocument();
	});

	it('aggregates a multi-day range into a mean headline + an honest caption', async () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: multiDay, locale: 'en' },
		});

		// Switch to "Date range" → the start + end pair appears.
		await fireEvent.click(screen.getByRole('radio', { name: copy.controls.dateRange }));
		await tick();
		const startSelect = screen.getByLabelText(
			`${copy.controls.dateRange} · ${copy.controls.rangeStart}`,
		);
		const endSelect = screen.getByLabelText(
			`${copy.controls.dateRange} · ${copy.controls.rangeEnd}`,
		);

		// Pick the full 3-day window: mean OTP = round((80+82+84)/3) = 82.
		await fireEvent.change(startSelect, { target: { value: '2026-06-16' } });
		await fireEvent.change(endSelect, { target: { value: '2026-06-18' } });
		await tick();

		// The active-window caption reflects the aggregate (no em dash; "to" joins).
		expect(
			screen.getByText(copy.controls.activeWindow.range(3, '2026-06-16', '2026-06-18')),
		).toBeInTheDocument();

		// The strip's mean OTP headline (82%) shows; percentiles fall to "—" (multi-day).
		const strip = container.querySelector('[data-slot="snapshot-strip"]') as HTMLElement;
		expect(within(strip).getAllByText('82%').length).toBeGreaterThan(0);
	});

	it('keeps a single-day range exact (start == end shows that day, not an average)', async () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: multiDay, locale: 'en' },
		});

		await fireEvent.click(screen.getByRole('radio', { name: copy.controls.dateRange }));
		await tick();
		const startSelect = screen.getByLabelText(
			`${copy.controls.dateRange} · ${copy.controls.rangeStart}`,
		);
		const endSelect = screen.getByLabelText(
			`${copy.controls.dateRange} · ${copy.controls.rangeEnd}`,
		);

		// A single day (06-16, OTP 80%) reads exact + uses the single-day caption.
		await fireEvent.change(startSelect, { target: { value: '2026-06-16' } });
		await fireEvent.change(endSelect, { target: { value: '2026-06-16' } });
		await tick();

		expect(
			screen.getByText(copy.controls.activeWindow.singleDay('2026-06-16')),
		).toBeInTheDocument();
		const strip = container.querySelector('[data-slot="snapshot-strip"]') as HTMLElement;
		expect(within(strip).getAllByText('80%').length).toBeGreaterThan(0);
	});
});

// A multi-day archive (three dated day-periods, contract order newest→oldest) so
// the date-range aggregation + single-day path can be exercised end-to-end.
const multiDay: RouteReliability = {
	id: '10',
	generated_utc: utc('2026-06-19T02:00:00Z'),
	periods: [
		{
			grain: 'day',
			date: '2026-06-18',
			otp_pct: 84,
			avg_delay_min: 1.9,
			p50_min: 0.4,
			p90_min: 5.5,
		},
		{
			grain: 'day',
			date: '2026-06-16',
			otp_pct: 80,
			avg_delay_min: 2.4,
			p50_min: 0.6,
			p90_min: 6.4,
		},
		{
			grain: 'day',
			date: '2026-06-17',
			otp_pct: 82,
			avg_delay_min: 2.1,
			p50_min: 0.5,
			p90_min: 6.0,
		},
	],
};

describe('RouteReliabilityClusters — mobile control collapse (S7)', () => {
	it('renders a summary toggle that flips aria-expanded + the open class', async () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});
		const toggle = container.querySelector('[data-slot="controls-toggle"]') as HTMLButtonElement;
		const body = container.querySelector('[data-slot="controls-body"]') as HTMLElement;
		expect(toggle).not.toBeNull();
		expect(body).not.toBeNull();
		// Collapsed by default (the mobile media query hides the body until opened).
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(body.classList.contains('reliability-control-body--open')).toBe(false);
		// The summary names the active window so a collapsed mobile rail still shows it.
		expect(toggle.textContent).toContain(copy.controls.today);

		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		expect(body.classList.contains('reliability-control-body--open')).toBe(true);
	});
});

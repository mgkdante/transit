import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import RouteReliabilityClusters from './RouteReliabilityClusters.svelte';
import { reliabilityCopy } from './reliability.copy';
import type { RouteReliability, IsoUtc } from '$lib/v1';

const copy = reliabilityCopy.en;

/** Brand a plain string as IsoUtc for fixture literals (mirrors clusters.test.ts). */
const utc = (value: string): IsoUtc => value as IsoUtc;

// A fully-populated archive: every section has a signal, so all five rider-question
// sections render their data (not their empty state). The 'day' and 'week' periods
// carry DIFFERENT OTP so a grain switch is observable.
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

/** The active-window caption text, the structure-independent grain/range readout. */
const activeWindowText = (container: HTMLElement): string =>
	container.querySelector('[data-slot="active-window"]')?.textContent?.trim() ?? '';

describe('RouteReliabilityClusters', () => {
	it('renders all five rider-question section overlines + the §0 headline with populated data', () => {
		render(RouteReliabilityClusters, { props: { data: populated, locale: 'en' } });

		// All five rider-question section overlines present, in surface order.
		expect(screen.getAllByText(copy.sections.verdict.label)[0]).toBeInTheDocument();
		expect(screen.getAllByText(copy.sections.whenToRide.label)[0]).toBeInTheDocument();
		expect(screen.getAllByText(copy.sections.theWait.label)[0]).toBeInTheDocument();
		expect(screen.getAllByText(copy.sections.runAndFit.label)[0]).toBeInTheDocument();
		expect(screen.getAllByText(copy.sections.worstStops.label)[0]).toBeInTheDocument();

		// §0 Verdict rendered its KPI tiles: the default 'day' grain OTP (82%) headline.
		expect(screen.getAllByText('82%').length).toBeGreaterThan(0);

		// The control spine offers the three discrete grains.
		expect(screen.getAllByText(copy.controls.today).length).toBeGreaterThan(0);
		expect(screen.getByText(copy.controls.thisWeek)).toBeInTheDocument();
		expect(screen.getByText(copy.controls.thisMonth)).toBeInTheDocument();
	});

	it('renders every section honestly empty (no crash, no dropped section) with an empty contract', () => {
		// A minimal valid contract: only the two required identity fields, no data
		// arrays — every section must fall to its honest empty state.
		const empty: RouteReliability = { id: '141', generated_utc: utc('2026-06-19T02:00:00Z') };
		const { container } = render(RouteReliabilityClusters, {
			props: { data: empty, locale: 'en' },
		});

		// Sections are NEVER silently dropped: all five overlines still anchor their sections.
		expect(screen.getAllByText(copy.sections.verdict.label)[0]).toBeInTheDocument();
		expect(screen.getAllByText(copy.sections.whenToRide.label)[0]).toBeInTheDocument();
		expect(screen.getAllByText(copy.sections.theWait.label)[0]).toBeInTheDocument();
		expect(screen.getAllByText(copy.sections.runAndFit.label)[0]).toBeInTheDocument();
		expect(screen.getAllByText(copy.sections.worstStops.label)[0]).toBeInTheDocument();

		// The styled honest-absence chip appears (sections fall to it, each saying WHY
		// data is missing), never a fabricated value.
		expect(container.querySelectorAll('[data-slot="absent-value"]').length).toBeGreaterThan(0);
	});

	it('refines the active window when the grain control changes', async () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});

		// Default grain ('day') → the active-window caption names today.
		expect(activeWindowText(container)).toBe(copy.controls.activeWindow.day);

		// Switch to "This week" → the caption re-answers for the week window.
		await fireEvent.click(screen.getByRole('radio', { name: copy.controls.thisWeek }));
		await tick();
		expect(activeWindowText(container)).toBe(copy.controls.activeWindow.week);
	});

	it('honours the FR canonical voice for the section overlines', () => {
		render(RouteReliabilityClusters, { props: { data: populated, locale: 'fr' } });

		expect(screen.getAllByText(reliabilityCopy.fr.sections.verdict.label)[0]).toBeInTheDocument();
		expect(
			screen.getAllByText(reliabilityCopy.fr.sections.whenToRide.label)[0],
		).toBeInTheDocument();
		expect(
			screen.getAllByText(reliabilityCopy.fr.sections.worstStops.label)[0],
		).toBeInTheDocument();
		// "Aujourd'hui" appears in both the grain picker and the active-window caption.
		expect(screen.getAllByText(reliabilityCopy.fr.controls.today).length).toBeGreaterThan(0);
	});

	it('offers a Date range segment when the contract carries dated day-periods', () => {
		render(RouteReliabilityClusters, { props: { data: populated, locale: 'en' } });
		expect(screen.getByRole('radio', { name: copy.controls.dateRange })).toBeInTheDocument();
	});

	it('aggregates a multi-day range into an honest caption', async () => {
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

		// Pick the full 3-day window → the caption reflects the aggregate (no em dash; "to" joins).
		await fireEvent.change(startSelect, { target: { value: '2026-06-16' } });
		await fireEvent.change(endSelect, { target: { value: '2026-06-18' } });
		await tick();
		expect(activeWindowText(container)).toBe(
			copy.controls.activeWindow.range(3, '2026-06-16', '2026-06-18'),
		);
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

		// A single day (06-16) reads exact + uses the single-day caption.
		await fireEvent.change(startSelect, { target: { value: '2026-06-16' } });
		await fireEvent.change(endSelect, { target: { value: '2026-06-16' } });
		await tick();
		expect(activeWindowText(container)).toBe(copy.controls.activeWindow.singleDay('2026-06-16'));
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

describe('RouteReliabilityClusters — mobile floating pills (S7)', () => {
	it('renders the grain filter pill (labelled by the active window) + the section jump-to pill', () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});
		// The grain FILTER pill replaces the old collapse toggle on mobile.
		const filterPill = container.querySelector(
			'[data-testid="reliability-filter-pill"]',
		) as HTMLElement;
		expect(filterPill).not.toBeNull();
		// It is labelled with the active window (default 'day' → Today).
		expect(filterPill.textContent).toContain(copy.controls.today);
		// The grain controls live in the pill DRAWER (closed by default → not rendered yet).
		expect(container.querySelector('[data-testid="reliability-filter-drawer"]')).toBeNull();

		// The section JUMP-TO rides the shared TocPill.
		expect(container.querySelector('[data-testid="toc-pill"]')).not.toBeNull();

		// The old collapse toggle is gone.
		expect(container.querySelector('[data-slot="controls-toggle"]')).toBeNull();
	});

	it('opens the filter drawer with the grain controls on tap', async () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});
		const pillBtn = container.querySelector(
			'[data-testid="reliability-filter-pill"] button',
		) as HTMLButtonElement;
		await fireEvent.click(pillBtn);
		expect(pillBtn.getAttribute('aria-expanded')).toBe('true');
		// The drawer now renders the grain controls (a second active-window readout appears).
		const drawer = container.querySelector(
			'[data-testid="reliability-filter-drawer"]',
		) as HTMLElement;
		expect(drawer).not.toBeNull();
		expect(drawer.querySelector('[data-slot="active-window"]')).not.toBeNull();
	});
});

describe('RouteReliabilityClusters — §1/§2/§4 scope badge (S7-B windowable)', () => {
	const scopeOf = (container: HTMLElement, id: string): string | null =>
		container.querySelector(`a[href="#${id}"]`)?.getAttribute('data-scope') ?? null;

	it('shows ∞ (whole) for §1/§2/§4 when no *_by_grain is published (honest pre-deploy)', () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});
		// §0 + §3 always window
		expect(scopeOf(container, 'rel-verdict')).toBe('windowed');
		expect(scopeOf(container, 'rel-run-and-fit')).toBe('windowed');
		// §1/§2/§4 honestly whole-history until the DB publishes their companions
		expect(scopeOf(container, 'rel-when-to-ride')).toBe('whole');
		expect(scopeOf(container, 'rel-the-wait')).toBe('whole');
		expect(scopeOf(container, 'rel-worst-stops')).toBe('whole');
	});

	it('flips §1/§2/§4 to ↻ (windowed) when the active grain has a *_by_grain entry', () => {
		const windowedData: RouteReliability = {
			generated_utc: '2026-06-19T02:00:00Z' as IsoUtc,
			id: '51',
			// default grain is 'day' → the windowed entries must carry a 'day' key to flip.
			periods_by_grain: [
				{
					grain: 'day',
					by_shift: [{ grain: 'am_peak', otp_pct: 80, observation_count: 200 }],
					by_daytype: [],
					day_of_week: [],
					by_shift_daytype: [],
				},
			],
			headway_by_grain: [
				{ grain: 'day', headway: [{ shift: 'am_peak', observed_min: 7, cov: 0.5 }] },
			],
			weak_stops_by_grain: [
				{
					grain: 'day',
					stops: [{ id: 's1', severe_pct: 30, observation_count: 50, wilson_lo: 22 }],
				},
			],
		};
		const { container } = render(RouteReliabilityClusters, {
			props: { data: windowedData, locale: 'en' },
		});
		expect(scopeOf(container, 'rel-when-to-ride')).toBe('windowed');
		expect(scopeOf(container, 'rel-the-wait')).toBe('windowed');
		expect(scopeOf(container, 'rel-worst-stops')).toBe('windowed');
	});
});

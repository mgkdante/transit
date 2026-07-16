import { render, screen, fireEvent, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import RouteReliabilityClusters from './RouteReliabilityClusters.svelte';
import { reliabilityCopy } from './reliability.copy';
import type { RouteReliability, IsoUtc } from '$lib/v1';

const motion = vi.hoisted(() => ({ reduced: false }));

vi.mock('$lib/v1', async () => ({
	...(await import('$lib/v1/history')),
	wilsonBounds: (await import('$lib/v1/stats')).wilsonBounds,
}));

vi.mock('$lib/motion/reduced-motion.svelte', () => ({
	prefersReducedMotion: {
		get current() {
			return motion.reduced;
		},
	},
	isPrefersReducedMotion: () => motion.reduced,
}));

const copy = reliabilityCopy.en;
const source = () =>
	readFileSync(
		resolve(process.cwd(), 'src/lib/features/lines/reliability/RouteReliabilityClusters.svelte'),
		'utf-8',
	);

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
	it('places an optional article verdict in the shared summary lane before reliability cards', () => {
		const articleSummary = createRawSnippet(() => ({
			render: () => '<p data-testid="line-article-summary">Line verdict</p>',
		}));
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en', articleSummary },
		});

		expect(
			container.querySelector(
				'[data-slot="reliability-rail-summary"] [data-testid="line-article-summary"]',
			),
		).not.toBeNull();
		expect(container.querySelectorAll('[data-testid="line-article-summary"]')).toHaveLength(1);
	});

	it('routes all five rider-question adapters through one shared connected stack', () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});
		const stack = container.querySelector('[data-slot="article-section-stack"]') as HTMLElement;
		const bands = Array.from(stack?.children ?? []);

		expect(stack).not.toBeNull();
		expect(bands).toHaveLength(5);
		for (const band of bands) {
			expect(band.matches('.reliability-band[data-band]')).toBe(true);
			expect(
				band.querySelector(':scope > section[data-section] > [data-slot="card"].section-card'),
			).not.toBeNull();
			expect(band.querySelector('[data-section-trigger]')).not.toBeNull();
		}
	});

	it('removes the old 3-5rem page-local inter-card spacing rules', () => {
		const component = source();

		expect(component).toContain('ArticleSectionStack');
		expect(component).toMatch(/\.reliability-content\s*\{[^}]*gap:\s*var\(--space-card-gap\);/s);
		expect(component).not.toMatch(
			/\.(?:reliability-clusters|reliability-content)\s*\{[^}]*gap:\s*clamp\(3rem,\s*7vw,\s*5rem\)/s,
		);
	});

	it('uses card spacing without drawing standalone divider rules between bands', () => {
		expect(source()).not.toMatch(
			/\.reliability-band\s*\+\s*\.reliability-band\s*\{[^}]*border-top:/s,
		);
	});

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

	it('renders the SEC n/m position readout in the sticky ToC rail (H4)', () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});

		// The rail's ONE wayfinding stamp is TocNav's own zero-padded footer counter
		// over the total section count (5). Before the scroll observer resolves an
		// active id, it falls back to section 1 → "SEC 01 / 05".
		const readout = container.querySelector('.toc-counter-text');
		expect(readout).not.toBeNull();
		expect(readout?.textContent?.replace(/\s+/g, ' ').trim()).toContain('SEC 01 / 05');
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

describe('RouteReliabilityClusters — merged mobile rail sheet (P5.4)', () => {
	it('uses the shared ReliabilityRailLayout without a local desktop grid', () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});

		expect(container.querySelectorAll('[data-slot="reliability-rail-layout"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="surface-rail"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="reliability-rail-content"]')).toHaveLength(1);
		expect(source()).toContain('<ReliabilityRailLayout');
		expect(source()).not.toContain('class="reliability-layout"');
		expect(source()).not.toMatch(/grid-template-columns:[^;]*16rem/);
	});

	it('uses instant ToC navigation when reduced motion is requested', async () => {
		const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
		const scrollIntoView = vi.fn();
		Object.defineProperty(Element.prototype, 'scrollIntoView', {
			configurable: true,
			value: scrollIntoView,
		});
		motion.reduced = true;

		try {
			const { container } = render(RouteReliabilityClusters, {
				props: { data: populated, locale: 'en' },
			});
			const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
			await fireEvent.click(
				within(rail).getByRole('button', { name: copy.sections.worstStops.label }),
			);
			await waitFor(() =>
				expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' }),
			);
		} finally {
			motion.reduced = false;
			if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
			else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
		}
	});

	it('opens a collapsed rider-question section before ToC navigation scrolls to it', async () => {
		const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
		const scrollIntoView = vi.fn();
		Object.defineProperty(Element.prototype, 'scrollIntoView', {
			configurable: true,
			value: scrollIntoView,
		});
		motion.reduced = true;

		try {
			const { container } = render(RouteReliabilityClusters, {
				props: { data: populated, locale: 'en' },
			});
			const target = container.querySelector('[data-toc="rel-worst-stops"]') as HTMLElement;
			const disclosure = target.querySelector('[data-section-trigger]') as HTMLButtonElement;
			expect(disclosure).toHaveAttribute('aria-expanded', 'true');
			await fireEvent.click(disclosure);
			expect(disclosure).toHaveAttribute('aria-expanded', 'false');

			const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
			await fireEvent.click(
				within(rail).getByRole('button', { name: copy.sections.worstStops.label }),
			);

			expect(disclosure).toHaveAttribute('aria-expanded', 'true');
			await waitFor(() =>
				expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' }),
			);
		} finally {
			motion.reduced = false;
			if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
			else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
		}
	});

	it('renders ONE mobile pill labelled with the View heading + the active grain', () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});
		// The SurfaceRail mobile pill replaces the old two floating pills.
		const railMobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		expect(railMobile).not.toBeNull();
		const pillBtn = railMobile.querySelector('button') as HTMLButtonElement;
		expect(pillBtn).not.toBeNull();
		// Labelled with the View heading + the active window (default 'day' → Today).
		expect(pillBtn.textContent).toContain(copy.controls.viewLabel);
		expect(pillBtn.textContent).toContain(copy.controls.today);
		// The sheet is closed by default (no dialog rendered yet).
		expect(railMobile.querySelector('[role="dialog"]')).toBeNull();
		// The old collapse toggle + the separate toc/filter pills are gone.
		expect(container.querySelector('[data-slot="controls-toggle"]')).toBeNull();
		expect(container.querySelector('[data-testid="reliability-filter-pill"]')).toBeNull();
		expect(container.querySelector('[data-testid="toc-pill"]')).toBeNull();
	});

	it('opens ONE sheet with BOTH the grain controls AND the section ToC on tap', async () => {
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});
		const railMobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pillBtn = railMobile.querySelector('button') as HTMLButtonElement;
		await fireEvent.click(pillBtn);
		expect(pillBtn.getAttribute('aria-expanded')).toBe('true');
		const sheet = railMobile.querySelector('[role="dialog"]') as HTMLElement;
		expect(sheet).not.toBeNull();
		// The ONE sheet merges the grain controls (active-window readout) AND the section ToC.
		expect(sheet.querySelector('[data-slot="active-window"]')).not.toBeNull();
		expect(sheet.querySelector('[data-slot="section-toc"]')).not.toBeNull();
	});

	it('keeps the one ToC disclosure remembered while its rail moves into the sheet', async () => {
		const storageKey = 'transit.persisted:reliability-toc';
		sessionStorage.removeItem(storageKey);
		const { container } = render(RouteReliabilityClusters, {
			props: { data: populated, locale: 'en' },
		});
		const desktopToc = container.querySelector(
			'[data-slot="surface-rail"] [data-slot="section-toc"]',
		) as HTMLElement;
		const desktopToggle = within(desktopToc).getByRole('button', {
			name: copy.controls.toc,
		});

		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector(':scope > button') as HTMLButtonElement);
		const mobileToc = (mobile.querySelector('[role="dialog"]') as HTMLElement).querySelector(
			'[data-slot="section-toc"]',
		) as HTMLElement;
		const mobileToggle = within(mobileToc).getByRole('button', { name: copy.controls.toc });
		expect(mobileToggle).toBe(desktopToggle);

		await fireEvent.click(mobileToggle);

		expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
		expect(desktopToggle).toHaveAttribute('aria-expanded', 'false');
		expect(sessionStorage.getItem(storageKey)).toBe('false');
	});

	it('keeps one disabled-grain reason and one described radio as the rail moves', async () => {
		const withoutMonth: RouteReliability = {
			...populated,
			periods: populated.periods?.filter((period) => period.grain !== 'month'),
		};
		const { container } = render(RouteReliabilityClusters, {
			props: { data: withoutMonth, locale: 'en' },
		});
		const railMobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(railMobile.querySelector('button') as HTMLButtonElement);

		const reasons = Array.from(
			container.querySelectorAll<HTMLElement>('[data-slot="controls-reason"]'),
		);
		const reasonIds = reasons.map((reason) => reason.id);
		expect(reasonIds).toHaveLength(1);
		expect(new Set(reasonIds).size).toBe(reasonIds.length);
		expect(reasonIds[0]).toMatch(/-(?:desktop|mobile)$/);

		const monthRadios = screen.getAllByRole('radio', { name: copy.controls.thisMonth });
		expect(monthRadios).toHaveLength(1);
		expect(monthRadios[0]?.getAttribute('aria-describedby')).toBe(reasonIds[0]);
		for (const radio of monthRadios) {
			const describedBy = radio.getAttribute('aria-describedby');
			expect(describedBy).not.toBeNull();
			expect(container.querySelector(`#${describedBy}`)).not.toBeNull();
		}
	});
});

// (The §1/§2/§4 ↻/∞ scope-badge tests were removed with the scope glyph itself: the rail
// now renders the shared TocNav, a plain numbered jump-list with no per-row scope marker.)

describe('RouteReliabilityClusters canonical article-control stack', () => {
	it('orders label, primary period, conditional range, and caption before the section ToC', () => {
		const component = source();
		const tag = component.match(/<ArticleControlStack[\s\S]*?\/>/)?.[0] ?? '';
		const primary =
			component.match(/{#snippet primaryControls\(\)}([\s\S]*?){\/snippet}/)?.[1] ?? '';

		expect(tag).not.toBe('');
		expect(tag.indexOf('label=')).toBeLessThan(tag.indexOf('primary='));
		expect(tag.indexOf('primary=')).toBeLessThan(tag.indexOf('secondary='));
		expect(tag.indexOf('secondary=')).toBeLessThan(tag.indexOf('caption='));
		expect(tag).not.toContain('history=');
		expect(primary).toContain('variant="time-grid"');
		expect(component.indexOf('data-slot="section-toc"')).toBeGreaterThan(
			component.indexOf('<ArticleControlStack'),
		);
		expect(component).not.toMatch(/class=["']reliability-control-body/);
		expect(component).not.toMatch(/\.reliability-control-body\s*\{/);
	});
});

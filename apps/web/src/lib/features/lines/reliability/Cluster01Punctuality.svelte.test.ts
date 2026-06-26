// Cluster01Punctuality.svelte.test.ts — the "01 Punctuality" band's contract:
//   1. a populated VM → headline numbers + the weakest-stops accountability
//      list render, worst delay first; no empty note.
//   2. an empty VM → the honest empty/no-data note renders, no crash, and the
//      headline + accountability list are absent.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Cluster01Punctuality from './Cluster01Punctuality.svelte';
import { reliabilityCopy } from './reliability.copy';
import { metricsCopy } from '$lib/features/metrics/metrics.copy';
import type { PunctualityVM } from './clusters';

const copy = reliabilityCopy.en;
const info = metricsCopy.en.info;

// S7 (systematic grain): the band's headline tiles + Distribution + severe-share bar
// read the GRAIN-AWARE aggregate `vm.headline` (today / this week / this month / range),
// NOT the trend tail — so they answer for the picked window. Here the aggregate mirrors
// the latest day (82% / 2.1 min) so the headline assertions hold; the trend carries the
// daily detail.
const populated: PunctualityVM = {
	headline: {
		otpPct: 82,
		avgDelayMin: 2.1,
		p50Min: 0.5,
		p90Min: 6.0,
		severePct: 3,
		delayHistogram: null,
	},
	trend: [
		{
			grain: 'day',
			date: '2026-06-17',
			otp_pct: 79,
			avg_delay_min: 2.8,
			p50_min: 0.8,
			p90_min: 7.2,
			severe_pct: 4,
		},
		{
			grain: 'day',
			date: '2026-06-18',
			otp_pct: 82,
			avg_delay_min: 2.1,
			p50_min: 0.5,
			p90_min: 6.0,
			severe_pct: 3,
		},
	],
	dayOfWeek: [{ day_of_week_iso: 1, avg_delay_min: 1.8, severe_pct: 5, observation_count: 100 }],
	weakStops: [
		{ id: 'S1', name: 'Van Horne', avg_delay_min: 3.7 },
		{ id: 'S2', name: 'Côte-des-Neiges', avg_delay_min: 6.4 },
	],
	peakOffPeak: {
		byShift: [{ grain: 'am_peak', otpPct: 90, avgDelayMin: 0.7, severePct: 4.7 }],
		byDayType: [{ grain: 'weekday', otpPct: 80, avgDelayMin: 2.4, severePct: 6 }],
		isEmpty: false,
	},
	byShiftDaytype: [],
	isEmpty: false,
};

// S7: a route with many weak stops, worst-first (12, 11, … 1 min).
const manyStops: PunctualityVM = {
	...populated,
	weakStops: Array.from({ length: 12 }, (_, i) => ({
		id: `S${i}`,
		name: `Stop ${i}`,
		avg_delay_min: 12 - i,
	})),
};

const emptyVM: PunctualityVM = {
	headline: {
		otpPct: null,
		avgDelayMin: null,
		p50Min: null,
		p90Min: null,
		severePct: null,
		delayHistogram: null,
	},
	trend: [],
	dayOfWeek: [],
	weakStops: [],
	peakOffPeak: { byShift: [], byDayType: [], isEmpty: true },
	byShiftDaytype: [],
	isEmpty: true,
};

describe('Cluster01Punctuality — worst-N selector (S7)', () => {
	it('defaults to the 10 worst stops and offers a worst-N selector', () => {
		const { container, getByRole } = render(Cluster01Punctuality, {
			props: { vm: manyStops, locale: 'en', copy },
		});
		const list = container.querySelector('[data-slot="weak-stops-list"]') as HTMLElement;
		expect(list.querySelectorAll('[data-slot="ranked-row"]').length).toBe(10);
		expect(getByRole('radiogroup', { name: copy.strip.worstNLabel })).toBeInTheDocument();
	});

	it('truncates the ranked list when a smaller N is picked', async () => {
		const { container, getByRole } = render(Cluster01Punctuality, {
			props: { vm: manyStops, locale: 'en', copy },
		});
		await fireEvent.click(getByRole('radio', { name: '5' }));
		const list = container.querySelector('[data-slot="weak-stops-list"]') as HTMLElement;
		expect(list.querySelectorAll('[data-slot="ranked-row"]').length).toBe(5);
	});
});

describe('Cluster01Punctuality — populated', () => {
	it('renders the selected-grain headline (default day) and no empty note', () => {
		render(Cluster01Punctuality, { props: { vm: populated, locale: 'en', copy } });

		// Headline OTP for grain 'day' = 82%.
		expect(screen.getByText('82%')).toBeInTheDocument();
		// Avg delay for the day period.
		expect(screen.getByText('2.1 min')).toBeInTheDocument();
		// No honest-empty note when there is data.
		expect(screen.queryByTestId('punctuality-empty')).not.toBeInTheDocument();
	});

	it('ranks the weakest stops worst-delay first (accountability)', () => {
		render(Cluster01Punctuality, { props: { vm: populated, locale: 'en', copy } });

		// Both stops present, worst (6.4 min) ranked #1 above the milder one.
		const worst = screen.getByText('Côte-des-Neiges');
		const milder = screen.getByText('Van Horne');
		expect(worst).toBeInTheDocument();
		expect(milder).toBeInTheDocument();
		expect(worst.compareDocumentPosition(milder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	// S7 P9: the typical (p50) + worst-case (p90) numbers are now ONE Distribution
	// quantile mark, not two separate tiles. The shape carries the values in its
	// readout (p50 + p90) and its a11y five-number summary; the median is the
	// --primary affordance marker, the bar runs median→tail.
	it('renders the typical→worst-case delay distribution mark (A4 / P9)', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: populated, locale: 'en', copy },
		});
		const block = container.querySelector('[data-slot="delay-distribution"]') as HTMLElement;
		expect(block).not.toBeNull();
		// The Distribution figure renders (one shape, fixed [0,15] min domain).
		expect(block.querySelector('[data-slot="distribution"]')).not.toBeNull();
		// The readout carries the latest day's p50 (0.5 min) + p90 (6.0 min) as text.
		const readout = block.querySelector('[data-slot="delay-dist-readout"]') as HTMLElement;
		expect(readout.textContent).toContain('0.5 min');
		expect(readout.textContent).toContain('6.0 min');
		// Colour is never the sole channel: the figure spells the five-number summary
		// (including the worst-case max) into its accessible label.
		const fig = block.querySelector('[data-slot="distribution"]') as HTMLElement;
		expect(fig.getAttribute('aria-label')).toContain('6 min');
	});

	// HONESTY (#6/#6b): the headline-day percentiles are null network-wide today —
	// this is the most visible "·" leak the operator flagged. With BOTH percentiles
	// null the distribution is dropped whole and the AbsentValue chip (says WHY)
	// renders instead — never a fabricated 0, never a collapsed-to-zero box.
	it('drops the distribution for a styled no-data chip (never "·"/0) when p50/p90 are null', () => {
		const nullPercentiles: PunctualityVM = {
			...populated,
			// The Distribution reads the grain aggregate now → null its percentiles here.
			headline: {
				otpPct: 82,
				avgDelayMin: 2.1,
				p50Min: null,
				p90Min: null,
				severePct: null,
				delayHistogram: null,
			},
			trend: [
				{
					grain: 'day',
					date: '2026-06-18',
					otp_pct: 82,
					avg_delay_min: 2.1,
					// The network-wide reality: daily percentiles unmeasured.
					p50_min: null,
					p90_min: null,
					severe_pct: null,
				},
			],
		};
		const { container } = render(Cluster01Punctuality, {
			props: { vm: nullPercentiles, locale: 'en', copy },
		});

		const block = container.querySelector('[data-slot="delay-distribution"]') as HTMLElement;
		// The Distribution mark is omitted entirely (no fabricated zero box)…
		expect(block.querySelector('[data-slot="distribution"]')).toBeNull();
		// …and the styled honest-absence chip (reason-typed "No data · why") renders.
		expect(block.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		// The real value still speaks the amber voice (not blanked out).
		expect(screen.getByText('82%')).toBeInTheDocument();
		// Doctrine: there is NO p50/p90 value readout to leak a bare middot — the
		// only "·" present is the AbsentValue chip's own "No data · why" separator.
		expect(block.querySelector('[data-slot="delay-dist-readout"]')).toBeNull();
		expect(block.querySelector('[data-slot="delay-dist-caption"]')).toBeNull();
	});

	it('labels the severe-share block with its OWN label, never the p90 label (BUG-1/F3)', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: populated, locale: 'en', copy },
		});
		// The dedicated severe-share label is present (it also legitimately appears as
		// the peak-block subtitle — `severePct` and `peak.dayOfWeekSevere` share copy).
		expect(screen.getAllByText(copy.strip.severePct).length).toBeGreaterThanOrEqual(1);
		// The severe block carries its own caption (NOT the p90 caption).
		const caption = container.querySelector('[data-slot="severe-caption"]');
		expect(caption?.textContent).toBe(copy.strip.severeCaption);
	});

	it('gives the weak-stops list an explicit heading + honest count (#6)', () => {
		render(Cluster01Punctuality, { props: { vm: populated, locale: 'en', copy } });
		// "The 5 stops with the most delay · 2" — the count is honest (only 2 qualify).
		expect(screen.getByText(`${copy.strip.weakStopsHeading} · 2`)).toBeInTheDocument();
		expect(screen.getByText(copy.windows.weakStops)).toBeInTheDocument();
	});

	it('renders the "By time of day" peak block with its honest caveat (A1)', () => {
		render(Cluster01Punctuality, { props: { vm: populated, locale: 'en', copy } });
		// Block heading + day-type sub-heading + the trailing-window caveat.
		expect(screen.getByText(copy.peak.heading)).toBeInTheDocument();
		expect(screen.getByText(copy.peak.dayType)).toBeInTheDocument();
		expect(screen.getByText(copy.peak.caveat)).toBeInTheDocument();
		// The am_peak shift bucket renders (now a Cleveland strip-plot row label).
		expect(screen.getByText('AM peak')).toBeInTheDocument();
		// The weekday day-type bucket renders.
		expect(screen.getByText(copy.peak.weekday)).toBeInTheDocument();
	});

	it('P10: the per-shift severe share is a Cleveland STRIP plot on the shared axis (not bars)', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: populated, locale: 'en', copy },
		});
		// The shift block is now the strip plot, in chronological am→night order.
		const strip = container.querySelector('[data-slot="shift-severe-strip"]') as HTMLElement;
		expect(strip).not.toBeNull();
		const fig = strip.querySelector('[data-slot="strip-plot"]') as HTMLElement;
		expect(fig.getAttribute('data-layout')).toBe('categorical');
		// One dot for the lone am_peak shift; its dot rides the dataviz SEVERITY scale.
		const dots = strip.querySelectorAll<HTMLElement>('.dv-strip-plot__dot');
		expect(dots.length).toBe(1);
		expect(dots[0].style.getPropertyValue('--dot-fill')).toBe('var(--dataviz-severity-watch)');
		// The shared axis is the FIXED SEVERE_DOMAIN [0,100] (full % scale): 4.7% → 4.7% across.
		expect(dots[0].style.left).toBe(`${(4.7 / 100) * 100}%`);
		// The all-day mean reference rule renders (the lone shift's mean = itself).
		expect(strip.querySelector('.dv-strip-plot__mean')).not.toBeNull();
	});
});

describe('Cluster01Punctuality — metric explainer (i)', () => {
	it('renders an explainer (i) beside the headline metric labels with a deep link', async () => {
		render(Cluster01Punctuality, { props: { vm: populated, locale: 'en', copy } });

		// The on-time tile carries an (i) trigger named from the explainer copy.
		const trigger = screen.getByRole('button', { name: info.trigger(copy.strip.otpPct) });
		expect(trigger).toBeInTheDocument();

		// Opening it reveals the in-app deep link to /metrics#otp (same-tab nav).
		await fireEvent.click(trigger);
		const link = screen.getByRole('link', { name: new RegExp(info.link, 'i') });
		expect(link).toHaveAttribute('href', '/metrics#otp');
		expect(link).not.toHaveAttribute('target');
	});

	it('points the severe-share (i) at /metrics#severe and localizes the link in FR', async () => {
		render(Cluster01Punctuality, {
			props: { vm: populated, locale: 'fr', copy: reliabilityCopy.fr },
		});
		const frInfo = metricsCopy.fr.info;
		const trigger = screen.getByRole('button', {
			name: frInfo.trigger(reliabilityCopy.fr.strip.severePct),
		});
		await fireEvent.click(trigger);
		const link = screen.getByRole('link', { name: new RegExp(frInfo.link, 'i') });
		expect(link).toHaveAttribute('href', '/fr/metrics#severe');
	});
});

describe('Cluster01Punctuality — (i) label resilience (C1)', () => {
	it('seats each label (i) wrapper as a flex:none sibling of a wrappable section label', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: populated, locale: 'en', copy },
		});
		// The severe-share / weak-stops / peak headings use the .label-with-info row:
		// a SectionLabel (min-width:0, can wrap) beside a non-shrinking (i) wrapper
		// (.cluster-info, flex:none) so a long label never collides with the glyph.
		const rows = container.querySelectorAll('.label-with-info');
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			expect(row.querySelector('[data-slot="section-label"]')).not.toBeNull();
			expect(row.querySelector('.cluster-info')).not.toBeNull();
		}
	});
});

describe('Cluster01Punctuality — by shift and day type STEPPED HEATMAP (G1)', () => {
	// A SPARSE crosstab → stepped heatmap: am_peak/weekday + pm_peak/weekday are
	// TRUSTED (real OTP, obs >= 30); am_peak/weekend is present-but-null; pm_peak/weekday
	// also carries a tiny sample at weekend to prove the n<30 grey-out. The other cells
	// are absent → every untrusted cell must read the no-data message, never a "·"/0.
	const withCrosstab: PunctualityVM = {
		...populated,
		byShiftDaytype: [
			{
				shift: 'am_peak',
				day_type: 'weekday',
				otp_pct: 88,
				avg_delay_min: 1.1,
				observation_count: 420,
			},
			// A present cell whose OTP is null → still no-data in that cell.
			{
				shift: 'am_peak',
				day_type: 'weekend',
				otp_pct: null,
				avg_delay_min: 2.0,
				observation_count: 50,
			},
			{ shift: 'pm_peak', day_type: 'weekday', otp_pct: 74, severe_pct: 9, observation_count: 310 },
			// A REAL OTP but too few observations (n<30) → greyed honestly, NOT coloured.
			{ shift: 'pm_peak', day_type: 'weekend', otp_pct: 95, observation_count: 12 },
		],
	};

	it('renders the 5×2 heatmap with trusted OTP cells and the section heading', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: withCrosstab, locale: 'en', copy },
		});
		const grid = container.querySelector('[data-slot="shift-daytype-crosstab"]') as HTMLElement;
		expect(grid).not.toBeNull();
		expect(within(grid).getByText(copy.crosstab.heading)).toBeInTheDocument();
		// Trusted OTP cells read their value.
		expect(within(grid).getByText('88%')).toBeInTheDocument();
		expect(within(grid).getByText('74%')).toBeInTheDocument();
		// All five canonical shift rows render (fixed axis, not just present ones).
		expect(within(grid).getByText('AM peak')).toBeInTheDocument();
		expect(within(grid).getByText('Midday')).toBeInTheDocument();
		expect(within(grid).getByText('Night')).toBeInTheDocument();
		// Both day-type columns render.
		expect(within(grid).getByText(copy.peak.weekday)).toBeInTheDocument();
		expect(within(grid).getByText(copy.peak.weekend)).toBeInTheDocument();
	});

	it('annotates the single hottest (highest-OTP) trusted cell', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: withCrosstab, locale: 'en', copy },
		});
		const grid = container.querySelector('[data-slot="shift-daytype-crosstab"]') as HTMLElement;
		// 88% (am_peak/weekday) is the best TRUSTED cell — 95% is n<30 so it does NOT win.
		const hottest = grid.querySelectorAll('td[data-hottest="true"]');
		expect(hottest.length).toBe(1);
		expect(hottest[0].textContent).toContain('88%');
		// The accessible "best on-time rate" annotation is present once.
		expect(within(grid).getByText(copy.crosstab.hottest)).toBeInTheDocument();
	});

	it('greys n<30 cells to the no-data swatch (never a coloured fake value)', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: withCrosstab, locale: 'en', copy },
		});
		const grid = container.querySelector('[data-slot="shift-daytype-crosstab"]') as HTMLElement;
		// pm_peak/weekend has a REAL 95% OTP but only 12 obs → it must NOT render "95%".
		expect(within(grid).queryByText('95%')).toBeNull();
	});

	it('shows the no-data message (never "·"/0) in absent, null-OTP, and low-sample cells', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: withCrosstab, locale: 'en', copy },
		});
		const grid = container.querySelector('[data-slot="shift-daytype-crosstab"]') as HTMLElement;
		// 8 of 10 cells are untrusted (am_peak/weekend null; pm_peak/weekend n<30; midday,
		// evening, night all absent) → each cell value reads the honest no-data text.
		const emptyCells = grid.querySelectorAll('td[data-empty="true"]');
		expect(emptyCells.length).toBe(8);
		for (const cell of emptyCells) {
			expect(cell.textContent).toContain(copy.strip.noData);
			// Doctrine: an empty cell never paints a middot / em-dash / fake 0 as its value.
			expect(cell.textContent).not.toContain('·');
			expect(cell.textContent).not.toContain('—');
		}
	});

	it('exposes the observation count + low-sample reason in a cell title', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: withCrosstab, locale: 'en', copy },
		});
		const grid = container.querySelector('[data-slot="shift-daytype-crosstab"]') as HTMLElement;
		const titles = Array.from(grid.querySelectorAll('[title]')).map((el) =>
			el.getAttribute('title'),
		);
		// The trusted cell's title carries n=420.
		expect(titles.some((t) => t?.includes('n=420'))).toBe(true);
		// The n<30 cell's title says WHY it is greyed (the low-sample reason + its count).
		expect(titles.some((t) => t?.includes(copy.crosstab.lowSample) && t?.includes('n=12'))).toBe(
			true,
		);
	});

	it('omits the heatmap section entirely when no cell is trusted', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: populated, locale: 'en', copy },
		});
		expect(container.querySelector('[data-slot="shift-daytype-crosstab"]')).toBeNull();
		// A grid with ONLY low-sample cells (n<30) is likewise omitted (honest empty).
		const lowSampleOnly: PunctualityVM = {
			...populated,
			byShiftDaytype: [
				{ shift: 'am_peak', day_type: 'weekday', otp_pct: 90, observation_count: 5 },
			],
		};
		const { container: c2 } = render(Cluster01Punctuality, {
			props: { vm: lowSampleOnly, locale: 'en', copy },
		});
		expect(c2.querySelector('[data-slot="shift-daytype-crosstab"]')).toBeNull();
	});
});

describe('Cluster01Punctuality — honest empty', () => {
	it('renders the styled honest-absence chip and no headline when the VM is empty', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: emptyVM, locale: 'en', copy },
		});

		const note = screen.getByTestId('punctuality-empty');
		expect(note).toBeInTheDocument();
		// The styled honest-absence chip (says WHY data is missing), not a plain note.
		expect(note.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		// Cluster overline still present; the section is labelled, not dropped.
		const section = screen.getByRole('region', { name: copy.clusters.punctuality });
		expect(within(section).queryByText('82%')).not.toBeInTheDocument();
	});
});

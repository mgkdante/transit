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
		// The grain-aggregate signed-delay distribution (#158) — drives the A1 histogram.
		delayHistogram: [
			{ lo_sec: -60, hi_sec: -30, count: 2 },
			{ lo_sec: -30, hi_sec: 0, count: 10 },
			{ lo_sec: 0, hi_sec: 30, count: 18 },
			{ lo_sec: 30, hi_sec: 60, count: 6 },
			{ lo_sec: 300, hi_sec: 420, count: 1 },
		],
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
		// The worst-N lollipop (LayerChart bars mount behind ChartFrame's measured-size gate,
		// verified in headless; here we assert the mark + its AT-fallback table row count).
		expect(list.querySelector('[data-slot="magnitude-bars-mark"]')).not.toBeNull();
		expect(list.querySelectorAll('[data-slot="magnitude-bars-mark"] table tbody tr').length).toBe(
			10,
		);
		expect(getByRole('radiogroup', { name: copy.strip.worstNLabel })).toBeInTheDocument();
	});

	it('truncates the ranked list when a smaller N is picked', async () => {
		const { container, getByRole } = render(Cluster01Punctuality, {
			props: { vm: manyStops, locale: 'en', copy },
		});
		await fireEvent.click(getByRole('radio', { name: '5' }));
		const list = container.querySelector('[data-slot="weak-stops-list"]') as HTMLElement;
		expect(list.querySelectorAll('[data-slot="magnitude-bars-mark"] table tbody tr').length).toBe(
			5,
		);
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

	// S7 P1.5: the distribution SHAPE is now the true A1 signed-delay HISTOGRAM from the
	// contract's delay_histogram (the D4 payoff). The p50/p90 quantile NUMBERS stay above
	// it as the per-grain readout. (The LayerChart bars mount only behind ChartFrame's
	// measured-size gate — not exercised in the no-layout test env — so we assert the mark
	// + its AT-fallback table here; the bar geometry is verified in headless Chrome.)
	it('renders the A1 signed-delay histogram + keeps the p50/p90 readout', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: populated, locale: 'en', copy },
		});
		const block = container.querySelector('[data-slot="delay-distribution"]') as HTMLElement;
		expect(block).not.toBeNull();
		// The A1 histogram mark renders (the contract's delay_histogram).
		const hist = block.querySelector('[data-slot="histogram-mark"]') as HTMLElement;
		expect(hist).not.toBeNull();
		// Its AT-fallback table carries every bin (a row per histogram bin).
		expect(hist.querySelectorAll('table tbody tr').length).toBe(5);
		// The p50 (0.5 min) + p90 (6.0 min) quantile numbers stay above the shape.
		const readout = block.querySelector('[data-slot="delay-dist-readout"]') as HTMLElement;
		expect(readout.textContent).toContain('0.5 min');
		expect(readout.textContent).toContain('6.0 min');
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

	it('P10: the per-shift severe share is a Cleveland dot-strip on the fixed axis', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: populated, locale: 'en', copy },
		});
		const strip = container.querySelector('[data-slot="shift-severe-strip"]') as HTMLElement;
		expect(strip).not.toBeNull();
		// Rendered via the one <Chart> → the dot-strip mark (LayerChart dots mount behind
		// ChartFrame's measured-size gate, verified in headless; here we assert the mark +
		// its AT-fallback table).
		const mark = strip.querySelector('[data-slot="dot-strip-mark"]') as HTMLElement;
		expect(mark).not.toBeNull();
		// The AT-fallback table carries the am_peak shift + its 4.7% severe share.
		const rows = mark.querySelectorAll('table tbody tr');
		expect(rows.length).toBe(1);
		expect(rows[0].textContent).toContain('AM peak');
		expect(rows[0].textContent).toContain('4.7');
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

describe('Cluster01Punctuality — shift × day-type as TWO LINES (S7)', () => {
	// Sparse crosstab: am_peak/weekday (88, trusted) + pm_peak/weekday (74, trusted);
	// am_peak/weekend present-but-null; pm_peak/weekend a REAL 95% but n<30 → honest gap.
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
			{
				shift: 'am_peak',
				day_type: 'weekend',
				otp_pct: null,
				avg_delay_min: 2.0,
				observation_count: 50,
			},
			{ shift: 'pm_peak', day_type: 'weekday', otp_pct: 74, severe_pct: 9, observation_count: 310 },
			{ shift: 'pm_peak', day_type: 'weekend', otp_pct: 95, observation_count: 12 },
		],
	};

	// S7 line-chart convergence: the stepped-heatmap GRID is now TWO LINES (weekday vs
	// weekend OTP across shifts). LayerChart lines mount behind ChartFrame's measured-size
	// gate (not in the no-layout env), so assert the mark + its AT table; the line geometry
	// + crosshair tooltip are verified in headless Chrome.
	it('renders the crosstab as the line mark — weekday + weekend OTP over shifts', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: withCrosstab, locale: 'en', copy },
		});
		const block = container.querySelector('[data-slot="shift-daytype-crosstab"]') as HTMLElement;
		expect(block).not.toBeNull();
		expect(within(block).getAllByText(copy.crosstab.heading).length).toBeGreaterThan(0);
		const mark = block.querySelector('[data-slot="line-mark"]') as HTMLElement;
		expect(mark).not.toBeNull();
		// One AT-table row per canonical shift (fixed axis).
		expect(mark.querySelectorAll('tbody tr').length).toBe(5);
		// Trusted cells carry their OTP; the n<30 95% cell is an honest GAP (never shown).
		expect(within(mark).getByText('88')).toBeInTheDocument();
		expect(within(mark).getByText('74')).toBeInTheDocument();
		expect(within(mark).queryByText('95')).toBeNull();
	});

	it('omits the section entirely when no cell is trusted (honest empty)', () => {
		expect(
			render(Cluster01Punctuality, {
				props: { vm: populated, locale: 'en', copy },
			}).container.querySelector('[data-slot="shift-daytype-crosstab"]'),
		).toBeNull();
		const lowSampleOnly: PunctualityVM = {
			...populated,
			byShiftDaytype: [
				{ shift: 'am_peak', day_type: 'weekday', otp_pct: 90, observation_count: 5 },
			],
		};
		expect(
			render(Cluster01Punctuality, {
				props: { vm: lowSampleOnly, locale: 'en', copy },
			}).container.querySelector('[data-slot="shift-daytype-crosstab"]'),
		).toBeNull();
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

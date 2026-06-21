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

// SPEC CHANGE (foundation): PunctualityVM.periods was split into `trend` (the
// dated DAY-grain series, chronological ascending) + `peakOffPeak`. The band's
// headline now reads the MOST-RECENT trend day (the array tail), so the 82% /
// 2.1 min headline lives on the latest dated day.
const populated: PunctualityVM = {
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

const emptyVM: PunctualityVM = {
	trend: [],
	dayOfWeek: [],
	weakStops: [],
	peakOffPeak: { byShift: [], byDayType: [], isEmpty: true },
	byShiftDaytype: [],
	isEmpty: true,
};

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

	it('renders the typical (p50) delay tile alongside the headline (A4)', () => {
		render(Cluster01Punctuality, { props: { vm: populated, locale: 'en', copy } });
		// The latest day's p50 = 0.5 min, labelled "Typical delay" (not jargon).
		expect(screen.getByText(copy.strip.p50Min)).toBeInTheDocument();
		expect(screen.getByText('0.5 min')).toBeInTheDocument();
	});

	// HONESTY (#6/#6b): the headline-day percentiles are null network-wide today —
	// this is the most visible "·" leak the operator flagged. The p50/p90 tiles must
	// show the explicit muted "no data" message, never a bare middot, never a 0.
	it('shows the muted "no data" message (never "·") when p50/p90 are null', () => {
		const nullPercentiles: PunctualityVM = {
			...populated,
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

		// The two percentile tiles + the inline severe value render the no-data label.
		const emptyLabels = screen.getAllByText(copy.strip.noData);
		expect(emptyLabels.length).toBeGreaterThanOrEqual(2);
		// Those no-data tiles ride the muted .metric-empty voice, never the amber value.
		expect(container.querySelectorAll('[data-slot="metric-empty"]').length).toBeGreaterThanOrEqual(
			2,
		);
		// The real value still speaks the amber voice (not blanked out).
		expect(screen.getByText('82%')).toBeInTheDocument();
		// Doctrine: the no-data tiles do NOT fall back to a bare middot value.
		expect(screen.queryByText('·', { selector: '.metric-value' })).not.toBeInTheDocument();
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
		// The am_peak shift bucket renders (ranked by severe share).
		expect(screen.getByText('AM peak')).toBeInTheDocument();
		// The weekday day-type bucket renders.
		expect(screen.getByText(copy.peak.weekday)).toBeInTheDocument();
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

describe('Cluster01Punctuality — by shift and day type crosstab (G1)', () => {
	// A SPARSE crosstab: am_peak/weekday + pm_peak/weekday present (one with a null
	// OTP), the other 8 cells absent → every absent cell must read the no-data
	// message, never a "·"/0. This per-empty-cell honesty is the explicit ask.
	const withCrosstab: PunctualityVM = {
		...populated,
		byShiftDaytype: [
			{ shift: 'am_peak', day_type: 'weekday', otp_pct: 88, avg_delay_min: 1.1 },
			// A present cell whose OTP is null → still no-data in that cell.
			{ shift: 'am_peak', day_type: 'weekend', otp_pct: null, avg_delay_min: 2.0 },
			{ shift: 'pm_peak', day_type: 'weekday', otp_pct: 74, severe_pct: 9 },
		],
	};

	it('renders the 5×2 grid with present OTP cells and the section heading', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: withCrosstab, locale: 'en', copy },
		});
		const grid = container.querySelector('[data-slot="shift-daytype-crosstab"]') as HTMLElement;
		expect(grid).not.toBeNull();
		expect(within(grid).getByText(copy.crosstab.heading)).toBeInTheDocument();
		// Present OTP cells read their value.
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

	it('shows the no-data message (never "·"/0) in absent + null-OTP cells', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: withCrosstab, locale: 'en', copy },
		});
		const grid = container.querySelector('[data-slot="shift-daytype-crosstab"]') as HTMLElement;
		// 9 of 10 cells carry no real OTP (am_peak/weekend is present-but-null; midday,
		// pm_peak/weekend, evening, night are all absent) → each reads the no-data text.
		const emptyCells = grid.querySelectorAll('td[data-empty="true"]');
		expect(emptyCells.length).toBe(8);
		for (const cell of emptyCells) {
			expect(cell.textContent?.trim()).toBe(copy.strip.noData);
		}
		// Doctrine: no middot leak anywhere in the crosstab.
		expect(grid.textContent).not.toContain('·');
	});

	it('omits the crosstab section entirely when by_shift_daytype is empty', () => {
		const { container } = render(Cluster01Punctuality, {
			props: { vm: populated, locale: 'en', copy },
		});
		expect(container.querySelector('[data-slot="shift-daytype-crosstab"]')).toBeNull();
	});
});

describe('Cluster01Punctuality — honest empty', () => {
	it('renders the no-data note and no headline when the VM is empty', () => {
		render(Cluster01Punctuality, { props: { vm: emptyVM, locale: 'en', copy } });

		const note = screen.getByTestId('punctuality-empty');
		expect(note).toBeInTheDocument();
		expect(note).toHaveTextContent(copy.strip.noDataNote);
		// Cluster overline still present; the section is labelled, not dropped.
		const section = screen.getByRole('region', { name: copy.clusters.punctuality });
		expect(within(section).queryByText('82%')).not.toBeInTheDocument();
	});
});

// Cluster03ServiceDelivered.svelte.test.ts — the "03 Service delivered" band, DOM gate.
//
// Two non-negotiables the doctrine demands of this RAMP-IN band:
//   1. Populated VM → most-recent rates render (cancellations + skipped stops),
//      both completeness bars paint on the dataviz scale (NEVER --primary) with the
//      honest "X of Y" raw-count fraction, and the ramp-in caveat is shown prominently.
//   2. Empty VM → no crash; the honest empty note AND the ramp-in note are both
//      present (we never fabricate a 0 or silently drop the section).

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { CancellationPeriod, SkippedStopPeriod } from '$lib/v1';
import Cluster03ServiceDelivered from './Cluster03ServiceDelivered.svelte';
import type { ServiceDeliveredVM } from './clusters';
import { reliabilityCopy } from './reliability.copy';
import { metricsCopy } from '$lib/features/metrics/metrics.copy';

const copy = reliabilityCopy.en;
const info = metricsCopy.en.info;

const cancellations: CancellationPeriod[] = [
	{
		grain: 'day',
		date: '2026-06-16',
		cancellation_rate_pct: 1.5,
		canceled_trip_days: 3,
		total_trip_days: 200,
	},
	{
		grain: 'day',
		date: '2026-06-17',
		cancellation_rate_pct: 2.4,
		canceled_trip_days: 6,
		total_trip_days: 250,
	},
	// most-recent row carries no rate → headline falls back to the prior row.
	{ grain: 'day', date: '2026-06-18', canceled_trip_days: 0, total_trip_days: 240 },
];

const skippedStops: SkippedStopPeriod[] = [
	{
		date: '2026-06-17',
		skipped_stop_rate_pct: 0.8,
		skipped_stop_count: 12,
		stop_time_update_count: 1500,
	},
	{
		date: '2026-06-18',
		skipped_stop_rate_pct: 1.1,
		skipped_stop_count: 17,
		stop_time_update_count: 1600,
	},
];

const populated: ServiceDeliveredVM = {
	serviceSpans: [],
	cancellations,
	skippedStops,
	// The mapper supplies the grain-windowed rate (matching the snapshot strip); §03 renders it.
	cancellationRatePct: 2.4,
	skippedStopRatePct: 1.1,
	isRampIn: true,
	isEmpty: false,
};

const empty: ServiceDeliveredVM = {
	serviceSpans: [],
	cancellations: [],
	skippedStops: [],
	cancellationRatePct: null,
	skippedStopRatePct: null,
	isRampIn: true,
	isEmpty: true,
};

describe('Cluster03ServiceDelivered — populated VM', () => {
	it('renders the grain-windowed ramp-in rates the mapper supplies (matches the strip)', () => {
		const { getByText } = render(Cluster03ServiceDelivered, {
			props: { vm: populated, locale: 'en', copy },
		});
		// §03 renders vm.cancellationRatePct / vm.skippedStopRatePct verbatim — the same
		// windowed values the snapshot strip shows, so the two tiles never disagree.
		expect(getByText('2.4%')).toBeInTheDocument();
		expect(getByText('1.1%')).toBeInTheDocument();
	});

	it('shows the ramp-in caveat prominently', () => {
		const { getByText, container } = render(Cluster03ServiceDelivered, {
			props: { vm: populated, locale: 'en', copy },
		});
		expect(getByText(copy.strip.rampInNote)).toBeInTheDocument();
		expect(container.querySelector('[data-slot="ramp-in-note"]')).not.toBeNull();
	});

	it('paints both completeness bars on the dataviz scale (never --primary) + the raw fraction', () => {
		const { container } = render(Cluster03ServiceDelivered, {
			props: { vm: populated, locale: 'en', copy },
		});
		// The rate-history Sparklines are gone — S7 replaced them with a stable
		// completeness read: a fixed-domain share bar + the honest "X of Y" counts.
		expect(container.querySelector('[data-slot="sparkline"]')).toBeNull();
		const wraps = container.querySelectorAll('[data-slot$="-completeness"]');
		expect(wraps).toHaveLength(2);
		// Each bar fills on the late/amber dataviz token, never the interactive orange.
		const fills = container.querySelectorAll('[data-slot$="-completeness"] .dv-severity-fill');
		expect(fills).toHaveLength(2);
		for (const fill of fills) {
			const style = fill.getAttribute('style') ?? '';
			expect(style).toContain('var(--dataviz-status-late)');
			expect(style).not.toContain('--primary');
		}
		// The honest raw-count fraction the bare rate never showed.
		const fractions = [...container.querySelectorAll('.cluster03-fraction')].map(
			(n) => n.textContent ?? '',
		);
		expect(fractions.some((f) => /trip-days canceled/.test(f))).toBe(true);
		expect(fractions.some((f) => /stop updates skipped/.test(f))).toBe(true);
	});

	it('renders both metric sections (no dropped section)', () => {
		const { container } = render(Cluster03ServiceDelivered, {
			props: { vm: populated, locale: 'en', copy },
		});
		expect(container.querySelector('[data-slot="cancellations"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="skipped-stops"]')).not.toBeNull();
	});

	it('renders the window caption for the rate histories (#e)', () => {
		const { getByText, container } = render(Cluster03ServiceDelivered, {
			props: { vm: populated, locale: 'en', copy },
		});
		expect(getByText(copy.windows.trend)).toBeInTheDocument();
		expect(container.querySelector('[data-slot="service-window"]')).not.toBeNull();
	});
});

describe('Cluster03ServiceDelivered — honest empty VM', () => {
	it('renders without crashing and shows the empty + ramp-in notes', () => {
		const { container, getByText } = render(Cluster03ServiceDelivered, {
			props: { vm: empty, locale: 'en', copy },
		});
		// Honest empty: the styled honest-absence chip (says WHY) under its data-slot hook.
		const emptyNote = container.querySelector('[data-slot="empty-note"]');
		expect(emptyNote).not.toBeNull();
		expect(emptyNote?.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		// Ramp-in caveat still shown so the reader knows WHY it is empty.
		expect(getByText(copy.strip.rampInNote)).toBeInTheDocument();
		// No fabricated metric sections / completeness bars.
		expect(container.querySelector('[data-slot="cancellations"]')).toBeNull();
		expect(container.querySelector('[data-slot$="-completeness"]')).toBeNull();
	});

	it('renders the FR canonical copy when locale is fr', () => {
		const fr = reliabilityCopy.fr;
		const { container, getByText } = render(Cluster03ServiceDelivered, {
			props: { vm: empty, locale: 'fr', copy: fr },
		});
		expect(getByText(fr.strip.rampInNote)).toBeInTheDocument();
		// The styled honest-absence chip renders its own FR copy in place of the plain note.
		expect(
			container.querySelector('[data-slot="empty-note"] [data-slot="absent-value"]'),
		).not.toBeNull();
	});
});

describe('Cluster03ServiceDelivered — per-metric no-data branch', () => {
	it('shows a no-data note for a metric whose count totals are absent', () => {
		const oneSided: ServiceDeliveredVM = {
			serviceSpans: [],
			// cancellations carry totals → completeness bar; skipped rows carry NO update-count total.
			cancellations,
			skippedStops: [{ date: '2026-06-18', skipped_stop_count: 5 }],
			cancellationRatePct: 2.4,
			skippedStopRatePct: null,
			isRampIn: true,
			isEmpty: false,
		};
		const { container } = render(Cluster03ServiceDelivered, {
			props: { vm: oneSided, locale: 'en', copy },
		});
		// cancellations draws its completeness bar; skipped stops shows its no-data note.
		expect(
			container.querySelector(
				'[data-slot="cancellations"] [data-slot="cancellations-completeness"]',
			),
		).not.toBeNull();
		expect(container.querySelector('[data-slot="skipped-stops-empty"]')).not.toBeNull();
		expect(
			container.querySelector(
				'[data-slot="skipped-stops"] [data-slot="skipped-stops-completeness"]',
			),
		).toBeNull();
	});
});

describe('Cluster03ServiceDelivered — metric explainer (i)', () => {
	it('deep-links the cancellation + skipped-stop (i) affordances', async () => {
		render(Cluster03ServiceDelivered, { props: { vm: populated, locale: 'en', copy } });

		const cancelTrigger = screen.getByRole('button', {
			name: info.trigger(copy.strip.cancellationRatePct),
		});
		await fireEvent.click(cancelTrigger);
		expect(screen.getByRole('link', { name: new RegExp(info.link, 'i') })).toHaveAttribute(
			'href',
			'/metrics#cancellation',
		);
		await fireEvent.click(cancelTrigger);

		const skipTrigger = screen.getByRole('button', {
			name: info.trigger(copy.strip.skippedStopRatePct),
		});
		await fireEvent.click(skipTrigger);
		expect(screen.getByRole('link', { name: new RegExp(info.link, 'i') })).toHaveAttribute(
			'href',
			'/metrics#skipped-stop',
		);
	});

	it('does not leak the i18n locale into a chart accessible name (S7 aria fix)', () => {
		const vm = {
			serviceSpans: [],
			cancellations: [
				{
					grain: 'day',
					date: '2026-06-18',
					cancellation_rate_pct: 2.5,
					canceled_trip_days: 1,
					total_trip_days: 100,
				},
			],
			skippedStops: [],
			cancellationRatePct: 2.5,
			skippedStopRatePct: null,
			isRampIn: true,
			isEmpty: false,
		};
		const { container } = render(Cluster03ServiceDelivered, {
			props: { vm, locale: 'en', copy },
		});
		// The completeness bar's accessible name must describe the metric, never "… · en".
		expect(container.querySelector('[aria-label*="· en"]')).toBeNull();
	});
});

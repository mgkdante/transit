// Cluster03ServiceDelivered.svelte.test.ts — the "03 Service delivered" band, DOM gate.
//
// Two non-negotiables the doctrine demands of this RAMP-IN band:
//   1. Populated VM → most-recent rates render (cancellations + skipped stops),
//      both history Sparklines paint on the dataviz scale (NEVER --primary), and
//      the ramp-in caveat is shown prominently.
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
	{ grain: 'day', date: '2026-06-16', cancellation_rate_pct: 1.5, canceled_trip_days: 3 },
	{ grain: 'day', date: '2026-06-17', cancellation_rate_pct: 2.4, canceled_trip_days: 6 },
	// most-recent row carries no rate → headline falls back to the prior row.
	{ grain: 'day', date: '2026-06-18', canceled_trip_days: 0, total_trip_days: 240 },
];

const skippedStops: SkippedStopPeriod[] = [
	{ date: '2026-06-17', skipped_stop_rate_pct: 0.8, skipped_stop_count: 12 },
	{ date: '2026-06-18', skipped_stop_rate_pct: 1.1, skipped_stop_count: 17 },
];

const populated: ServiceDeliveredVM = {
	serviceSpans: [],
	cancellations,
	skippedStops,
	isRampIn: true,
	isEmpty: false,
};

const empty: ServiceDeliveredVM = {
	serviceSpans: [],
	cancellations: [],
	skippedStops: [],
	isRampIn: true,
	isEmpty: true,
};

describe('Cluster03ServiceDelivered — populated VM', () => {
	it('renders the most-recent ramp-in rates (skipping a null-rate tail row)', () => {
		const { getByText } = render(Cluster03ServiceDelivered, {
			props: { vm: populated, locale: 'en', copy },
		});
		// cancellations: 06-18 had no rate → most-recent is 06-17's 2.4%.
		expect(getByText('2.4%')).toBeInTheDocument();
		// skipped stops: most-recent is 1.1%.
		expect(getByText('1.1%')).toBeInTheDocument();
	});

	it('shows the ramp-in caveat prominently', () => {
		const { getByText, container } = render(Cluster03ServiceDelivered, {
			props: { vm: populated, locale: 'en', copy },
		});
		expect(getByText(copy.strip.rampInNote)).toBeInTheDocument();
		expect(container.querySelector('[data-slot="ramp-in-note"]')).not.toBeNull();
	});

	it('paints both history Sparklines on the dataviz scale (never --primary)', () => {
		const { container } = render(Cluster03ServiceDelivered, {
			props: { vm: populated, locale: 'en', copy },
		});
		const sparklines = container.querySelectorAll('[data-slot="sparkline"]');
		expect(sparklines).toHaveLength(2);
		// Each sparkline stroke must be a dataviz token, not the interactive orange.
		for (const path of container.querySelectorAll('[data-slot="sparkline"] path')) {
			const stroke = path.getAttribute('stroke') ?? '';
			expect(stroke).toContain('var(--dataviz-status-late)');
			expect(stroke).not.toContain('--primary');
		}
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
		// No fabricated metric sections / sparklines.
		expect(container.querySelector('[data-slot="cancellations"]')).toBeNull();
		expect(container.querySelector('[data-slot="sparkline"]')).toBeNull();
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
	it('shows a no-data note for a metric whose rate history is all-null', () => {
		const oneSided: ServiceDeliveredVM = {
			serviceSpans: [],
			// cancellations carries a rate; skipped-stop rows exist but carry NO rate.
			cancellations,
			skippedStops: [{ date: '2026-06-18', skipped_stop_count: 5 }],
			isRampIn: true,
			isEmpty: false,
		};
		const { container } = render(Cluster03ServiceDelivered, {
			props: { vm: oneSided, locale: 'en', copy },
		});
		// cancellations draws its sparkline; skipped stops shows its no-data note.
		expect(
			container.querySelector('[data-slot="cancellations"] [data-slot="sparkline"]'),
		).not.toBeNull();
		expect(container.querySelector('[data-slot="skipped-stops-empty"]')).not.toBeNull();
		expect(
			container.querySelector('[data-slot="skipped-stops"] [data-slot="sparkline"]'),
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
			cancellations: [{ grain: 'day', date: '2026-06-18', cancellation_rate_pct: 2.5 }],
			skippedStops: [],
			isRampIn: true,
			isEmpty: false,
		};
		const { container } = render(Cluster03ServiceDelivered, {
			props: { vm, locale: 'en', copy },
		});
		// The Sparkline accessible name must describe the metric, never "… · en".
		expect(container.querySelector('[aria-label*="· en"]')).toBeNull();
	});
});

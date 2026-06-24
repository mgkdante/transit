import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Cluster02WaitRegularity from './Cluster02WaitRegularity.svelte';
import { reliabilityCopy } from './reliability.copy';
import { metricsCopy } from '$lib/features/metrics/metrics.copy';
import { toReliabilityClusters } from './clusters';
import type { RouteReliability, IsoUtc } from '$lib/v1';

const copy = reliabilityCopy.en;
const info = metricsCopy.en.info;

/** Brand a plain string as the IsoUtc the contract requires (codebase fixture idiom). */
const utc = (value: string): IsoUtc => value as IsoUtc;

describe('Cluster02WaitRegularity', () => {
	it('renders the headway shifts + service-span block from a populated VM', () => {
		const data: RouteReliability = {
			generated_utc: utc('2026-06-19T00:00:00Z'),
			id: '51',
			headway: [
				{
					shift: 'AM peak',
					scheduled_min: 6,
					observed_min: 8.4,
					excess_wait_min: 2.4,
					cov: 0.42,
					bunched_pct: 18,
				},
				{
					shift: 'Midday',
					scheduled_min: 12,
					observed_min: 12.6,
					excess_wait_min: 0.6,
					cov: 0.18,
					bunched_pct: 4,
				},
			],
			service_spans: [
				{
					date: '2026-06-18',
					service_span_min: 1140,
					first_trip_delay_min: 0.5,
					last_trip_delay_min: 3.2,
					trip_count: 214,
				},
			],
		};

		const clusters = toReliabilityClusters(data);
		render(Cluster02WaitRegularity, {
			props: {
				wait: clusters.waitRegularity,
				serviceSpans: clusters.serviceDelivered.serviceSpans,
				locale: 'en',
				copy,
			},
		});

		// Cluster overline + both sub-section labels present.
		expect(screen.getByText(copy.clusters.waitRegularity)).toBeInTheDocument();
		expect(screen.getByText('Wait by shift')).toBeInTheDocument();
		expect(screen.getByText('Service span')).toBeInTheDocument();

		// Both shifts render with their excess-wait display.
		expect(screen.getByText('AM peak')).toBeInTheDocument();
		expect(screen.getByText('Midday')).toBeInTheDocument();
		// Excess wait shows in both the RankedRow display + the MetricDisplay.
		expect(screen.getAllByText('2.4 min').length).toBeGreaterThanOrEqual(1);

		// Service-span metrics render (span minutes shown, not fabricated).
		expect(screen.getByText('1140.0 min')).toBeInTheDocument();
		expect(screen.getByText('214')).toBeInTheDocument();

		// The excess-wait caption explains that 0 is the GOOD case, not missing (#7).
		expect(screen.getByText(copy.strip.excessWaitCaption)).toBeInTheDocument();

		// The service-span window label names the latest closed service day (#9).
		expect(screen.getByText(copy.windows.serviceSpan('2026-06-18'))).toBeInTheDocument();

		// No honest-empty note when data is present.
		expect(screen.queryByText(copy.strip.noDataNote)).not.toBeInTheDocument();
	});

	it('presents per-direction rows as an observed-gap comparison, not empty bars (A3)', () => {
		// Direction-variant rows carry ONLY observed_min (scheduled/excess/cov null) →
		// they must surface as an observed-gap-by-direction comparison, not RankedRows
		// with empty SeverityBars.
		const data: RouteReliability = {
			generated_utc: utc('2026-06-19T00:00:00Z'),
			id: '10',
			headway: [
				{
					shift: 'am_peak',
					scheduled_min: 6,
					observed_min: 8.4,
					excess_wait_min: 2.4,
					cov: 0.42,
					bunched_pct: 18,
				},
				// per-direction variant (S7-B typed fields): only observed_min present.
				{ shift: 'am_peak', direction_id: 0, day_type: 'weekday', observed_min: 7.9 },
				{ shift: 'am_peak', direction_id: 1, day_type: 'weekend', observed_min: 9.1 },
			],
		};

		const clusters = toReliabilityClusters(data);
		render(Cluster02WaitRegularity, {
			props: { wait: clusters.waitRegularity, serviceSpans: [], locale: 'en', copy },
		});

		// The reveal carries the observed-gap-by-direction heading + both gaps.
		const reveal = document.querySelector('[data-slot="direction-gaps"]');
		expect(reveal).not.toBeNull();
		expect(screen.getByText('7.9 min')).toBeInTheDocument();
		expect(screen.getByText('9.1 min')).toBeInTheDocument();
	});

	it('decodes legacy {shift}_dir{N}_weekend rows for pre-cutover snapshots (fallback)', () => {
		// Backward-compat for the deploy window: snapshots published before Pattern A
		// carry the packed string; decodeShift falls back to parsing it so the band
		// renders the directional reveal identically to the typed-field path.
		const data: RouteReliability = {
			generated_utc: utc('2026-06-19T00:00:00Z'),
			id: '10',
			headway: [
				{ shift: 'am_peak', scheduled_min: 6, observed_min: 8.4, cov: 0.42, bunched_pct: 18 },
				{ shift: 'am_peak_dir0', observed_min: 7.9 },
				{ shift: 'am_peak_dir1_weekend', observed_min: 9.1 },
			],
		};
		const clusters = toReliabilityClusters(data);
		render(Cluster02WaitRegularity, {
			props: { wait: clusters.waitRegularity, serviceSpans: [], locale: 'en', copy },
		});
		const reveal = document.querySelector('[data-slot="direction-gaps"]');
		expect(reveal).not.toBeNull();
		expect(screen.getByText('7.9 min')).toBeInTheDocument();
		expect(screen.getByText('9.1 min')).toBeInTheDocument();
	});

	it('renders the honest empty state from an empty VM without crashing', () => {
		const clusters = toReliabilityClusters({
			generated_utc: utc('2026-06-19T00:00:00Z'),
			id: '51',
		});

		expect(clusters.waitRegularity.isEmpty).toBe(true);

		const { container } = render(Cluster02WaitRegularity, {
			props: {
				wait: clusters.waitRegularity,
				serviceSpans: clusters.serviceDelivered.serviceSpans,
				locale: 'en',
				copy,
			},
		});

		// The cluster overline still renders; the styled honest-absence chip replaces the marks.
		expect(screen.getByText(copy.clusters.waitRegularity)).toBeInTheDocument();
		expect(container.querySelector('[data-slot="absent-value"]')).not.toBeNull();

		// No fabricated shift rows / span block.
		expect(screen.queryByText('Wait by shift')).not.toBeInTheDocument();
		expect(screen.queryByText('Service span')).not.toBeInTheDocument();
	});

	it('guards null headway fields — renders the muted "no data" label, no crash', () => {
		const data: RouteReliability = {
			generated_utc: utc('2026-06-19T00:00:00Z'),
			id: '51',
			// A shift carrying only cov (no scheduled/observed/excess) still renders.
			headway: [{ shift: 'Evening', cov: 0.3 }],
		};

		const clusters = toReliabilityClusters(data);
		const { container } = render(Cluster02WaitRegularity, {
			props: {
				wait: clusters.waitRegularity,
				serviceSpans: [],
				locale: 'fr',
				copy: reliabilityCopy.fr,
			},
		});

		expect(screen.getByText('Evening')).toBeInTheDocument();
		// FR cluster overline (canonical voice).
		expect(screen.getByText(reliabilityCopy.fr.clusters.waitRegularity)).toBeInTheDocument();
		// The absent scheduled/observed/excess tiles render the styled honest-absence
		// (AbsentValue chip), never a bare "·", never a fabricated 0.
		expect(container.querySelectorAll('[data-slot="absent-value"]').length).toBeGreaterThan(0);
		// Honesty: no metric tile falls back to a bare middot value.
		expect(screen.queryByText('·', { selector: '.metric-value' })).not.toBeInTheDocument();
		// Service-span sub-block is omitted (no rows) — assert via its own data-sub
		// marker, not the no-data text (which now also reads on the AbsentValue chip).
		expect(container.querySelector('[data-sub="service-span"]')).toBeNull();
	});
});

describe('Cluster02WaitRegularity — metric explainer (i)', () => {
	const data: RouteReliability = {
		generated_utc: utc('2026-06-19T00:00:00Z'),
		id: '51',
		headway: [
			{ shift: 'am_peak', scheduled_min: 6, observed_min: 8.4, excess_wait_min: 2.4, cov: 0.42 },
		],
		service_spans: [
			{
				date: '2026-06-18',
				service_span_min: 1140,
				first_trip_delay_min: 0.5,
				last_trip_delay_min: 3.2,
				trip_count: 214,
			},
		],
	};

	it('deep-links the headway, regularity, excess-wait, and service-span (i) affordances', async () => {
		const clusters = toReliabilityClusters(data);
		render(Cluster02WaitRegularity, {
			props: {
				wait: clusters.waitRegularity,
				serviceSpans: clusters.serviceDelivered.serviceSpans,
				locale: 'en',
				copy,
			},
		});

		// Each wired metric exposes its (i) trigger; the deep link resolves to the
		// metric's explainer anchor when the popover opens.
		const cases: ReadonlyArray<[string, string]> = [
			['Wait by shift', '/metrics#headway'],
			[copy.strip.headwayRegularityCov, '/metrics#regularity'],
			['Service span', '/metrics#service-span'],
		];
		for (const [name, href] of cases) {
			const trigger = screen.getByRole('button', { name: info.trigger(name) });
			await fireEvent.click(trigger);
			const link = screen.getByRole('link', { name: new RegExp(info.link, 'i') });
			expect(link).toHaveAttribute('href', href);
			await fireEvent.click(trigger); // close before the next assertion
		}
	});

	it('lifts excess wait to a headline card with the always-visible "over what" baseline (S7)', () => {
		const data: RouteReliability = {
			id: '51',
			generated_utc: utc('2026-06-19T02:00:00Z'),
			headway: [
				{
					shift: 'am_peak',
					scheduled_min: 6,
					observed_min: 7.8,
					excess_wait_min: 1.8,
					cov: 0.4,
					bunched_pct: 12,
				},
			],
		};
		const clusters = toReliabilityClusters(data);
		const { container } = render(Cluster02WaitRegularity, {
			props: { wait: clusters.waitRegularity, serviceSpans: [], locale: 'en', copy },
		});
		const card = container.querySelector('[data-slot="explained-metric-card"]') as HTMLElement;
		expect(card).not.toBeNull();
		// The headline value renders + its baseline is explained ADJACENT (not in a popover).
		expect(card.textContent).toContain('1.8');
		expect(card.textContent).toContain('scheduled gap');
	});
});

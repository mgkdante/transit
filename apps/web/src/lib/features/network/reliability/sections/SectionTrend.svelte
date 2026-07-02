<!--
  SectionTrend — the primary historic trend (on-time % vs the chosen delay series) + the
  vehicles-reporting OWN labelled row (S9A operator fix).

  The primary line rides the interactive dual-axis TrendLine: on-time % (green) vs the chosen
  delay series (amber, MINUTES on the FIXED DELAY_DIST_DOMAIN [0,15] — the p90-capable NAMED
  PAIRED constant, see domains.ts A2; never the in-view max, so a given delay renders the same
  length on every window / grain / 30s refresh). null points are gaps.

  OTP ZOOM (S9B · DECISIONS B1/B2): the on-time channel does NOT ride the bare [0,100] frame — a
  whole-network on-time average moves only ~1–2 pts week-to-week, so on 100-tall it reads dead-flat.
  It rides `chart.onTimeDomain`, a DATA-ANCHORED, MIN-SPAN-floored, [0,100]-CLAMPED zoom (padded
  literals + floor, NEVER an in-view /max — see domains.otpTrendDomain). Honest by construction: the
  left y-ticks show the TRUE clipped bounds (87 vs 88, not a normalized 0–1) AND an absolute 80%
  reference hairline (`chart.onTimeReference`) anchors the zoom so the reader never mistakes a
  clipped axis for a zero-based one. A genuinely flat 88/88 week stays a flat line INSIDE the 8-pt
  window (the floor shows slope where slope exists; it never fabricates one).

  VEHICLES-REPORTING OWN ROW (operator item): the vehicles-in-service context is its OWN
  labelled row under the trend (its own SectionLabel, NOT a cramped caption) — how much of the
  fleet reported each day, so OTP/delay reads against its denominator. Null → gap. DAY grain
  only (vehicles is null on week/month, a 14d-daily-only field).

  GC2 / DECISIONS: service_completeness_rate (a schedule-aware denominator, distinct from
  cancellation_rate) is plumbed on TrendPoint but stays UNSHOWN this slice — it is all-null on
  pre-0073 history, so an honest sub-readout would be an absence chip everywhere; deferred to
  the S9B trends lane once data accrues.
-->
<script lang="ts">
	import { TrendLine, Sparkline } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { TrendChartVM } from '../selectors/trendChart';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionTrendProps {
		/** The primary-trend view-model (on-time + retard series + the fixed retard domain). */
		chart: TrendChartVM;
		/** The vehicles-in-service context series (day-grain only; null = gap). */
		vehiclesSeries: Array<number | null>;
		/** The resolved retard-axis label (p90 or median). */
		retardLabel: string;
		/** True on the DAY grain (gates the vehicles row — vehicles is null on week/month). */
		isDailyGrain: boolean;
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => {
			tip: string;
			href: string;
			label: string;
			linkLabel: string;
		};
		copy: NetworkReliabilityCopy;
	}
	let { chart, vehiclesSeries, retardLabel, isDailyGrain, info, copy }: SectionTrendProps =
		$props();

	const i = $derived(info('otp', copy.trendSection));
</script>

<div class="network-tile network-tile--wide">
	<span class="network-section">
		<SectionLabel text={copy.trendSection} variant="station" />
		<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
	</span>
	<div class="network-trend">
		<TrendLine
			onTime={chart.onTime}
			retard={chart.retard}
			domain={chart.onTimeDomain}
			retardDomain={chart.retardDomain}
			target={chart.onTimeReference}
			xLabels={chart.xLabels}
			onTimeLabel={copy.trend.onTimeLabel}
			{retardLabel}
			yAxis={{ label: copy.trend.onTimeLabel, unit: copy.units.pct, domain: chart.onTimeDomain }}
			retardAxis={{ label: retardLabel, unit: copy.units.min, domain: chart.retardDomain }}
			showYTicks
			label={copy.trend.summary}
			interactive
		/>

		<!-- VEHICLES-REPORTING OWN ROW: its own SectionLabel (not a caption), DAY grain only. -->
		{#if isDailyGrain}
			<div class="network-vehicles-row" data-slot="vehicles-reporting-row">
				<SectionLabel text={copy.trend.vehiclesContext} variant="metric" />
				<Sparkline
					values={vehiclesSeries}
					label={copy.trend.vehiclesSpark}
					xLabels={chart.xLabels}
					width={320}
					height={56}
					colorVar="var(--dataviz-status-unknown)"
					interactive
					showLast
				/>
			</div>
		{/if}
	</div>
</div>

<style>
	.network-tile {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	@media (min-width: 1024px) {
		.network-tile--wide {
			grid-column: 1 / -1;
		}
	}
	.network-section {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.network-trend {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 100%;
	}
	/* The vehicles-reporting OWN row — its own labelled block, not a cramped caption. */
	.network-vehicles-row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
</style>

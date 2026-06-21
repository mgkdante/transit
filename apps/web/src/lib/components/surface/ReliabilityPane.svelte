<!--
  ReliabilityPane, shared reliability readout for the route + stop surfaces.

  Route reliability and stop reliability differ in raw shape, so this primitive
  takes a NORMALIZED view-model (ReliabilityPeriodVM[]) the caller maps into. It
  renders, per period, a small card with the on-time %, the delay (avg|median),
  an optional p90, and a severe-share bar, plus a Sparkline of OTP across the
  periods as an at-a-glance trend.

  DOCTRINE: every data mark rides the dataviz scale (Sparkline / SeverityBar);
  --primary is never a data colour here. Domain vocabulary (OTP / delay / p90 /
  severe) is intrinsic, so the FR/EN labels live in a local Record<Locale>.
  Empty-guard: an empty `periods` renders nothing (the caller wraps the load in
  ResourceBoundary, which owns the empty/loading/error states).
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Locale } from '$lib/i18n';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { Sparkline, SeverityBar } from '$lib/components/dataviz';

	/** Normalized per-period reliability the caller maps its raw shape into. */
	export interface ReliabilityPeriodVM {
		/** Period label / grain (e.g. "7j", "Last 30 days"). */
		grain: string;
		/** On-time share as a percent [0,100], or null when unmeasured. */
		otpPct: number | null;
		/** Delay in minutes, a mean or a true percentile per `delayKind`. */
		delayMin: number | null;
		/**
		 * Per-period override of the delay caption; falls back to the
		 * pane-level `delayLabelKind`. Lets a real-p50 grain say "median"
		 * while observation-mean grains in the same pane say "avg".
		 */
		delayKind?: 'avg' | 'median';
		/** Optional p90 delay in minutes. */
		p90Min?: number | null;
		/** Optional severe share as a percent [0,100]. */
		severePct?: number | null;
	}

	interface ReliabilityPaneProps {
		/** Periods to render (one card each). Empty ⇒ renders nothing. */
		periods: readonly ReliabilityPeriodVM[];
		/** UI language for the intrinsic domain labels. */
		locale: Locale;
		/** Whether `delayMin` is an average or a median, drives the delay caption. */
		delayLabelKind?: 'avg' | 'median';
		/** Optional extra classes on the root. */
		class?: string;
	}

	let {
		periods,
		locale,
		delayLabelKind = 'avg',
		class: className,
	}: ReliabilityPaneProps = $props();

	/* Intrinsic domain vocabulary, FR is the canonical product voice. */
	type Labels = {
		readonly otp: string;
		readonly delayAvg: string;
		readonly delayMedian: string;
		readonly p90: string;
		/** Plain caption under the p90 tile (what "p90" means to a rider). */
		readonly p90Caption: string;
		readonly severe: string;
		readonly trend: string;
		/** Unit suffix for the OTP sparkline tooltip value (axis metadata). */
		readonly unitPct: string;
	};
	const L: Record<Locale, Labels> = {
		fr: {
			otp: 'Ponctualité',
			delayAvg: 'Retard moyen',
			delayMedian: 'Retard médian',
			p90: 'p90',
			p90Caption: '10 % les plus lents',
			severe: 'Retards majeurs',
			trend: 'Tendance ponctualité',
			unitPct: '%',
		},
		en: {
			otp: 'On-time %',
			delayAvg: 'Avg delay',
			delayMedian: 'Median delay',
			p90: 'p90',
			p90Caption: 'Slowest 10% of trips',
			severe: 'Major delays',
			trend: 'On-time trend',
			unitPct: '%',
		},
	};
	const t = $derived(L[locale]);

	const delayLabel = $derived(delayLabelKind === 'median' ? t.delayMedian : t.delayAvg);

	const fmtPct = (v: number | null) => (v == null ? '·' : `${Math.round(v)}%`);
	const fmtMin = (v: number | null | undefined) => (v == null ? '·' : `${v.toFixed(1)} min`);

	// OTP series across periods, drives the trend sparkline (dataviz scale).
	const otpSeries = $derived(periods.map((p) => p.otpPct));
</script>

{#if periods.length > 0}
	<div class={cn('reliability-pane', className)} data-slot="reliability-pane">
		<div class="reliability-cards">
			{#each periods as period (period.grain)}
				<div class="reliability-card">
					<SectionLabel text={period.grain} variant="metric" />
					<div class="reliability-metrics">
						<!-- A null OTP is genuinely unmeasured (e.g. the day grain emits only
						     p50/p90) — render nothing rather than a bare "·" placeholder. -->
						{#if period.otpPct != null}
							<MetricDisplay value={fmtPct(period.otpPct)} label={t.otp} size="sm" />
						{/if}
						<MetricDisplay
							value={fmtMin(period.delayMin)}
							label={period.delayKind === 'median'
								? t.delayMedian
								: period.delayKind === 'avg'
									? t.delayAvg
									: delayLabel}
							size="sm"
						/>
						{#if period.p90Min != null}
							<MetricDisplay
								value={fmtMin(period.p90Min)}
								label={t.p90}
								sublabel={t.p90Caption}
								size="sm"
							/>
						{/if}
					</div>
					{#if period.severePct != null}
						<div class="reliability-severe">
							<SectionLabel text={t.severe} variant="metric" />
							<SeverityBar
								severity="watch"
								value={period.severePct / 100}
								label={`${period.grain}, ${t.severe}`}
								interactive
							/>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if otpSeries.length > 1}
			<div class="reliability-trend">
				<SectionLabel text={t.trend} variant="metric" />
				<Sparkline
					values={otpSeries}
					width={160}
					height={32}
					label={t.trend}
					yAxis={{ label: t.otp, unit: t.unitPct }}
					xLabels={periods.map((p) => p.grain)}
					interactive
				/>
			</div>
		{/if}
	</div>
{/if}

<style>
	.reliability-pane {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.reliability-cards {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	@media (min-width: 640px) {
		.reliability-cards {
			grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		}
	}
	.reliability-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
		box-shadow: var(--shadow-card);
	}
	.reliability-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}
	.reliability-severe {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.reliability-trend {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
</style>

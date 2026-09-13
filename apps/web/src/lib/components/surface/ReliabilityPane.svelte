<!-- Stop summaries: the source field otpPct carries a non-severe prediction share. -->
<script lang="ts">
	import { cn, fmtDelayMin, fmtPct } from '$lib/utils';
	import type { Locale } from '$lib/i18n';
	import { SectionLabel } from '@yesid/ui/brand';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { SeverityBar } from '$lib/components/dataviz';
	import { Chart, type SparklineSpec } from '$lib/components/dataviz/chart';
	import { sparkZoomDomain } from '$lib/components/dataviz/chart/sparkDomain';

	/** A stop prediction summary for one period. */
	export interface ReliabilityPeriodVM {
		/** Period label / grain (e.g. "7j", "Last 30 days"). */
		grain: string;
		/** Non-severe share of eligible known predictions [0,100], or null when unmeasured. */
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

	export interface ReliabilityPaneProps {
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
		readonly notSevere: string;
		readonly delayAvg: string;
		readonly delayMedian: string;
		readonly p90: string;
		/** Plain caption under the p90 tile (what "p90" means to a rider). */
		readonly p90Caption: string;
		readonly severe: string;
		readonly trend: string;
		/** Unit suffix for the prediction-share sparkline tooltip. */
		readonly unitPct: string;
	};
	const L: Record<Locale, Labels> = {
		fr: {
			notSevere: 'Prévisions sans retard grave',
			delayAvg: 'Retard moyen',
			delayMedian: 'Retard médian',
			p90: 'p90',
			p90Caption: '90e percentile des relevés de retard',
			severe: 'Retards majeurs',
			trend: 'Part des prévisions sans retard grave',
			unitPct: '%',
		},
		en: {
			notSevere: 'Not-severe predictions',
			delayAvg: 'Avg delay',
			delayMedian: 'Median delay',
			p90: 'p90',
			p90Caption: '90th percentile of reported delays',
			severe: 'Major delays',
			trend: 'Share of predictions without severe delay',
			unitPct: '%',
		},
	};
	const t = $derived(L[locale]);

	const delayLabel = $derived(delayLabelKind === 'median' ? t.delayMedian : t.delayAvg);

	const pct = (v: number | null): string | null => fmtPct(v, { rounding: 'round' });
	const min = (v: number | null | undefined): string | null =>
		fmtDelayMin(v, { rounding: 'fixed1' });

	const nonSevereSeries = $derived(periods.map((p) => p.otpPct));

	// The prediction-share sparkline domain stays inside [0,100].
	const sparkSpec = $derived.by<SparklineSpec | null>(() => {
		const domain = sparkZoomDomain(nonSevereSeries, { clampHi: 100 });
		if (domain == null) return null;
		return {
			kind: 'sparkline',
			title: t.trend,
			locale,
			domain,
			unit: t.unitPct,
			label: t.notSevere,
			values: nonSevereSeries,
			xLabels: periods.map((p) => p.grain),
			showLast: true,
			width: 160,
			height: 32,
		};
	});
</script>

{#if periods.length > 0}
	<div class={cn('reliability-pane', className)} data-slot="reliability-pane">
		<div class="reliability-cards">
			{#each periods as period (period.grain)}
				<div class="reliability-card">
					<SectionLabel text={period.grain} variant="metric" />
					<div class="reliability-metrics">
						{#if period.otpPct != null}
							<MetricDisplay value={pct(period.otpPct)} label={t.notSevere} size="sm" />
						{/if}
						<MetricDisplay
							value={min(period.delayMin)}
							absentReason="no-observations"
							{locale}
							label={period.delayKind === 'median'
								? t.delayMedian
								: period.delayKind === 'avg'
									? t.delayAvg
									: delayLabel}
							size="sm"
						/>
						{#if period.p90Min != null}
							<MetricDisplay
								value={min(period.p90Min)}
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
								{locale}
								interactive
							/>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if sparkSpec}
			<div class="reliability-trend">
				<SectionLabel text={t.trend} variant="metric" />
				<Chart spec={sparkSpec} />
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
		border-radius: var(--radius-lg);
	}
	.reliability-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}
	.reliability-severe {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.reliability-trend {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
</style>

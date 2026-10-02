<script lang="ts">
	import { cn, fmtDelayMin, fmtPct } from '$lib/utils';
	import type { Locale } from '$lib/i18n';
	import type { Snippet } from 'svelte';
	import { SectionLabel } from '@yesid/ui/brand';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { SeverityBar } from '$lib/components/dataviz';
	import { Chart, type SparklineSpec } from '$lib/components/dataviz/chart';
	import { sparkZoomDomain } from '$lib/components/dataviz/chart/sparkDomain';

	export interface ReliabilityPeriodVM {
		grain: string;
		otpPct: number | null;
		delayMin: number | null;
		delayKind?: 'avg' | 'median';
		p90Min?: number | null;
		severePct?: number | null;
	}

	export interface ReliabilityPaneProps {
		periods: readonly ReliabilityPeriodVM[];
		locale: Locale;
		delayLabelKind?: 'avg' | 'median';
		metricInfo?: Snippet<[key: 'stopNotSevere' | 'avgDelay' | 'p50p90' | 'severe', label: string]>;
		class?: string;
	}

	let {
		periods,
		locale,
		delayLabelKind = 'avg',
		metricInfo,
		class: className,
	}: ReliabilityPaneProps = $props();

	type Labels = {
		readonly notSevere: string;
		readonly delayAvg: string;
		readonly delayMedian: string;
		readonly p90: string;
		readonly p90Caption: string;
		readonly severe: string;
		readonly trend: string;
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

	const pct = (v: number | null): string | null => fmtPct(v, { rounding: 'round' });
	const min = (v: number | null | undefined): string | null =>
		fmtDelayMin(v, { rounding: 'fixed1' });

	const nonSevereSeries = $derived(periods.map((p) => p.otpPct));

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
				{@const median = (period.delayKind ?? delayLabelKind) === 'median'}
				{@const delayLabel = median ? t.delayMedian : t.delayAvg}
				<div class="reliability-card">
					<SectionLabel text={period.grain} variant="metric" />
					<div class="reliability-metrics">
						{#if period.otpPct != null}
							<MetricDisplay value={pct(period.otpPct)} label={t.notSevere} size="sm">
								{#snippet info()}{@render metricInfo?.('stopNotSevere', t.notSevere)}{/snippet}
							</MetricDisplay>
						{/if}
						<MetricDisplay
							value={min(period.delayMin)}
							absentReason="no-observations"
							{locale}
							label={delayLabel}
							size="sm"
						>
							{#snippet info()}{@render metricInfo?.(
									median ? 'p50p90' : 'avgDelay',
									delayLabel,
								)}{/snippet}
						</MetricDisplay>
						{#if period.p90Min != null}
							<MetricDisplay
								value={min(period.p90Min)}
								label={t.p90}
								sublabel={t.p90Caption}
								size="sm"
							>
								{#snippet info()}{@render metricInfo?.('p50p90', t.p90)}{/snippet}
							</MetricDisplay>
						{/if}
					</div>
					{#if period.severePct != null}
						<div class="reliability-severe">
							<div class="flex items-center gap-1">
								<SectionLabel text={t.severe} variant="metric" />
								{@render metricInfo?.('severe', t.severe)}
							</div>
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

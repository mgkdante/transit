<!--
  SectionHabits — the per-stop 7×24 severe-delay habits heatmap.

  Pure presenter of `selectHabitsHeatmap`. Reuses the Heatmap + ChartLegend dataviz
  primitives directly (the same encoding the lines surface uses); a null cell is
  "no data" (the dedicated nodata token). Rendered only when the caller has at least
  one real cell — the whole subsection stands down otherwise (never a fabricated grid).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { Heatmap, ChartLegend, HEATMAP_RAMP, HEATMAP_NODATA } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { habitsCellText } from '../selectors/habitsHeatmap';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';

	interface SectionHabitsProps {
		/** The 7×24 severe-delay matrix (null cell = no data). */
		matrix: (number | null)[][];
		locale: Locale;
		copy: StopReliabilityCopy;
	}
	let { matrix, locale, copy }: SectionHabitsProps = $props();

	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// Full weekday names in row order (drop the ISO index-0 placeholder).
	const habitsFullDays = $derived(copy.habits.weekdays.slice(1));

	/** Heatmap scale legend — three ramp buckets (low→high) + the no-data swatch. */
	const habitsLegend = $derived([
		{ colorVar: HEATMAP_RAMP[0], label: copy.habits.legend.low, swatch: 'square' as const },
		{ colorVar: HEATMAP_RAMP[2], label: copy.habits.legend.medium, swatch: 'square' as const },
		{
			colorVar: HEATMAP_RAMP[HEATMAP_RAMP.length - 1],
			label: copy.habits.legend.high,
			swatch: 'square' as const,
		},
		{ colorVar: HEATMAP_NODATA, label: copy.habits.legend.noData, swatch: 'square' as const },
	]);

	const cellText = (value: number | null, norm: number | null): string =>
		habitsCellText(value, norm, copy.habits.legend);
</script>

{#snippet metricInfo(key: MetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo
		class="stop-metric-info"
		tip={i.tip}
		href={i.href}
		label={i.label}
		linkLabel={i.linkLabel}
		side="bottom"
	/>
{/snippet}

<div class="stop-tile stop-tile--wide stop-reliability-habits" data-slot="stop-habits">
	<span class="stop-tile-heading">
		<SectionLabel text={copy.habits.heading} variant="station" />
		{@render metricInfo('habits', copy.habits.heading)}
	</span>
	<Heatmap
		grid={matrix}
		dayLabels={[...copy.habits.weekdaysShort]}
		fullDayLabels={[...habitsFullDays]}
		label={copy.habits.label}
		hourAxisLabel={copy.habits.hourAxisLabel}
		dayAxisLabel={copy.habits.dayAxisLabel}
		valueLabel={copy.habits.cellValueLabel}
		noDataText={copy.habits.legend.noData}
		hourTicks={[0, 3, 6, 9, 12, 15, 18, 21]}
		clockTicks
		valueFormat={cellText}
		interactive
	/>
	<ChartLegend items={habitsLegend} />
	<p class="stop-reliability-habits-caption">{copy.habits.caption}</p>
</div>

<style>
	.stop-reliability-habits {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.stop-reliability-habits-caption {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>

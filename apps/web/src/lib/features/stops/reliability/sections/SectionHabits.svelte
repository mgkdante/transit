<!--
  SectionHabits — the per-stop 7×24 severe-delay habits heatmap.

  Pure presenter of `selectHabitsHeatmapSpec` (P5.2: the classed-tier `heatmap`
  ChartSpec through the ONE <Chart> renderer — the same encoding the lines §1 hero
  uses). ABSOLUTE [0,1] domain: the matrix is pipeline-normalised to the stop's worst
  cell, so the mark bins every cell onto the same four tiers everywhere (the legacy
  per-row re-normalisation painted a mild day's worst hour as dark as a severe day's —
  fixed here, mirroring the lines S7 P4 ruling). A null cell is the honest no-data
  swatch. Rendered only when the caller has at least one real cell — the whole
  subsection stands down otherwise (never a fabricated grid).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { ChartLegend } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { selectHabitsHeatmap, selectHabitsHeatmapSpec } from '../selectors/habitsHeatmap';
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

	// Four plain-language tiers, calmest → worst (rider language, same shape as the
	// lines §1 hero — they say what the colour MEANS, not just an intensity word).
	const tierLabels = $derived([...copy.habits.legend.tiers]);
	const WORST_GLYPH = '◆';

	const spec = $derived(
		selectHabitsHeatmapSpec(selectHabitsHeatmap(matrix), locale, {
			title: copy.habits.label,
			valueLabel: copy.habits.cellValueLabel,
			rowAxisLabel: copy.habits.dayAxisLabel,
			colAxisLabel: copy.habits.hourAxisLabel,
			rowLabels: [...copy.habits.weekdaysShort],
			fullRowLabels: [...habitsFullDays],
			tierLabels,
			noDataLabel: copy.habits.legend.noData,
			worstGlyph: WORST_GLYPH,
			hourLabel: (h) => `${String(h).padStart(2, '0')}:00`,
			hourTicks: [0, 3, 6, 9, 12, 15, 18, 21],
		}),
	);

	// Classed-tier legend — the tier swatches calmest→worst (the worst label carries
	// the glyph) + the dedicated no-data swatch. Colours are data marks
	// (--dataviz-heatmap-tier-*); the mark's tooltip + sr-table carry a11y.
	const habitsLegend = $derived([
		{ colorVar: 'var(--dataviz-heatmap-tier-0)', label: tierLabels[0], swatch: 'square' as const },
		{ colorVar: 'var(--dataviz-heatmap-tier-1)', label: tierLabels[1], swatch: 'square' as const },
		{ colorVar: 'var(--dataviz-heatmap-tier-2)', label: tierLabels[2], swatch: 'square' as const },
		{
			colorVar: 'var(--dataviz-heatmap-tier-3)',
			label: `${tierLabels[3]} ${WORST_GLYPH}`,
			swatch: 'square' as const,
		},
		{
			colorVar: 'var(--dataviz-heatmap-nodata)',
			label: copy.habits.legend.noData,
			swatch: 'square' as const,
		},
	]);
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
	<SectionHeading level={2} overline={copy.habits.heading} class="stop-tile-heading">
		{#snippet explainer()}
			{@render metricInfo('habits', copy.habits.heading)}
		{/snippet}
	</SectionHeading>
	<Chart {spec} />
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

<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { absenceShort } from '$lib/site/absence';
	import { ChartLegend } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import { buildHabitsHeatmap } from '$lib/reliability/habitsHeatmap';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';
	import StopReliabilityPresenter from './StopReliabilityPresenter.svelte';

	interface SectionHabitsProps {
		matrix: (number | null)[][];
		locale: Locale;
		copy: StopReliabilityCopy;
		presentation?: 'standalone' | 'article-body';
	}
	let { matrix, locale, copy, presentation = 'standalone' }: SectionHabitsProps = $props();

	const habitsFullDays = $derived(copy.habits.weekdays.slice(1));

	const tierLabels = $derived([...copy.habits.legend.tiers]);
	const noDataLabel = $derived(absenceShort('no-observations', locale));
	const WORST_GLYPH = '◆';

	const spec = $derived(
		buildHabitsHeatmap(matrix, locale, {
			title: copy.habits.label,
			valueLabel: copy.habits.cellValueLabel,
			rowAxisLabel: copy.habits.dayAxisLabel,
			colAxisLabel: copy.habits.hourAxisLabel,
			rowLabels: [...copy.habits.weekdaysShort],
			fullRowLabels: [...habitsFullDays],
			tierLabels,
			noDataLabel,
			worstGlyph: WORST_GLYPH,
			hourLabel: (h) => `${String(h).padStart(2, '0')}:00`,
			hourTicks: [0, 3, 6, 9, 12, 15, 18, 21],
		}),
	);

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
			label: noDataLabel,
			swatch: 'square' as const,
		},
	]);
</script>

<StopReliabilityPresenter
	heading={copy.habits.heading}
	metricKey="habits"
	{locale}
	{presentation}
	spacing="comfortable"
	dataSlot="stop-habits"
>
	<Chart {spec} />
	<ChartLegend items={habitsLegend} />
	<p class="stop-reliability-habits-caption">{copy.habits.caption}</p>
</StopReliabilityPresenter>

<style>
	.stop-reliability-habits-caption {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>

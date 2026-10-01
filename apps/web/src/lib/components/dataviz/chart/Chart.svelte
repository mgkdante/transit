<script lang="ts">
	import AbsentValue from '$lib/components/edge/AbsentValue.svelte';
	import TrendMark from './marks/TrendMark.svelte';
	import HistogramMark from './marks/HistogramMark.svelte';
	import DotStripMark from './marks/DotStripMark.svelte';
	import MagnitudeBarsMark from './marks/MagnitudeBarsMark.svelte';
	import DumbbellMark from './marks/DumbbellMark.svelte';
	import LineMark from './marks/LineMark.svelte';
	import SparklineMark from './marks/SparklineMark.svelte';
	import BulletMark from './marks/BulletMark.svelte';
	import HeatmapMark from './marks/HeatmapMark.svelte';
	import StackedShareMark from './marks/StackedShareMark.svelte';
	import ServiceSpanMark from './marks/ServiceSpanMark.svelte';
	import ChartViewport from './ChartViewport.svelte';
	import { chartViewportPolicy, type ChartSpec } from './ChartSpec';

	export interface ChartProps {
		spec: ChartSpec;
		class?: string;
		scrollLabel?: string;
	}

	let { spec, class: className, scrollLabel }: ChartProps = $props();
	const viewportPolicy = $derived(chartViewportPolicy(spec.kind));
</script>

{#if spec.kind === 'absence'}
	<AbsentValue
		reason={spec.reason}
		locale={spec.locale}
		params={spec.params}
		variant={spec.variant ?? 'block'}
		class={className}
	/>
{:else}
	<ChartViewport
		layout={viewportPolicy.layout}
		mobileMinWidth={viewportPolicy.mobileMinWidth}
		label={scrollLabel ?? spec.title}
	>
		{#if spec.kind === 'trend'}
			<TrendMark {spec} class={className} />
		{:else if spec.kind === 'histogram'}
			<HistogramMark {spec} class={className} />
		{:else if spec.kind === 'dot-strip'}
			<DotStripMark {spec} class={className} />
		{:else if spec.kind === 'magnitude-bars'}
			<MagnitudeBarsMark {spec} class={className} />
		{:else if spec.kind === 'dumbbell'}
			<DumbbellMark {spec} class={className} />
		{:else if spec.kind === 'line'}
			<LineMark {spec} class={className} />
		{:else if spec.kind === 'sparkline'}
			<SparklineMark {spec} class={className} />
		{:else if spec.kind === 'bullet'}
			<BulletMark {spec} class={className} />
		{:else if spec.kind === 'heatmap'}
			<HeatmapMark {spec} class={className} />
		{:else if spec.kind === 'stacked-share'}
			<StackedShareMark {spec} class={className} />
		{:else if spec.kind === 'service-span'}
			<ServiceSpanMark {spec} class={className} />
		{:else}
			<!-- Chart kinds without a migrated mark intentionally render no data mark. -->
		{/if}
	</ChartViewport>
{/if}

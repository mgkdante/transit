<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { MetricDisplay } from '$lib/components/brand';
	import { Chart } from '$lib/components/dataviz/chart';
	import { AbsentValue } from '$lib/components/edge';
	import type { CrowdingVM } from '../selectors/crowdingMix';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';
	import StopReliabilityPresenter from './StopReliabilityPresenter.svelte';

	interface SectionCrowdingProps {
		vm: CrowdingVM;
		settled: boolean;
		locale: Locale;
		copy: StopReliabilityCopy;
		windowText?: string;
		presentation?: 'standalone' | 'article-body';
	}
	let {
		vm,
		settled,
		locale,
		copy,
		windowText = copy.crowding.window,
		presentation = 'standalone',
	}: SectionCrowdingProps = $props();

	const showNoTelemetry = $derived(settled && !vm.hasCrowding);
</script>

{#if vm.hasCrowding && vm.dominant != null && vm.spec}
	<StopReliabilityPresenter
		heading={copy.crowding.heading}
		metricKey="occupancy"
		{locale}
		{presentation}
		dataSlot="stop-crowding"
	>
		<p class="stop-reliability-window">{windowText}</p>
		<MetricDisplay
			value={vm.dominantPct}
			absentReason="no-observations"
			{locale}
			label={vm.dominant.label}
			sublabel={copy.crowding.dominantLabel}
			size="md"
		/>
		<Chart spec={vm.spec} class="stop-crowding-bar" />
	</StopReliabilityPresenter>
{:else if showNoTelemetry}
	<StopReliabilityPresenter
		heading={copy.crowding.heading}
		metricKey="occupancy"
		{locale}
		{presentation}
		dataSlot="stop-crowding-empty"
	>
		<AbsentValue variant="block" reason="no-observations" {locale} />
	</StopReliabilityPresenter>
{/if}

<style>
	.stop-reliability-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>

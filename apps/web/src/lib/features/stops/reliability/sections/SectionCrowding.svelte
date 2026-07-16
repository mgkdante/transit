<!--
  SectionCrowding — the occupancy band-shares of buses OBSERVED AT this stop.

  Pure presenter of `selectCrowdingMix` (P5.2: the selector emits a stacked-share
  ChartSpec rendered by the ONE <Chart> renderer). A 100%-stacked occupancy strip
  reusing the dataviz occupancy scale + the SHARED lines band vocabulary. Honesty
  (Cluster04 doctrine): occupancy_mix is null when no telemetry was attributed to
  this stop (or an all-zero mix) — once the resource has loaded, an explicit styled
  no-telemetry chip renders in its place, never a fabricated / even split.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { MetricDisplay } from '$lib/components/brand';
	import { Chart } from '$lib/components/dataviz/chart';
	import { AbsentValue } from '$lib/components/edge';
	import type { CrowdingVM } from '../selectors/crowdingMix';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';
	import StopReliabilityPresenter from './StopReliabilityPresenter.svelte';

	interface SectionCrowdingProps {
		/** The crowding view-model (mix/segments/dominant + hasCrowding). */
		vm: CrowdingVM;
		/**
		 * True once the reliability resource has loaded — gates the honest
		 * no-telemetry chip (before settle we render neither; the skeleton owns that).
		 */
		settled: boolean;
		locale: Locale;
		copy: StopReliabilityCopy;
		/** Current-window copy by default; retained callers name the selected range. */
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

	// The honest no-telemetry note shows once loaded but no crowding was attributed.
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
			value={vm.dominantPct ?? copy.noDelay}
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

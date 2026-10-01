<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { Chart, type HistogramSpec, type AbsenceSpec } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import NetworkTile from './NetworkTile.svelte';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionDelayHistogramProps {
		locale: Locale;
		spec: HistogramSpec | AbsenceSpec;
		copy: NetworkReliabilityCopy;
	}
	let { locale, spec, copy }: SectionDelayHistogramProps = $props();

	const hasHistogram = $derived(spec.kind === 'histogram');
</script>

{#if hasHistogram}
	<section class="network-hist-section" data-slot="delay-histogram-section">
		{#snippet histogramInfo()}
			<MetricInfo metricKey="p50p90" {locale} name={copy.delayHistogramSection} side="bottom" />
		{/snippet}
		<NetworkTile
			title={copy.delayHistogramSection}
			subtitle={copy.delayHistogram.caption}
			sectionKey="network-delay-histogram"
			class="network-hist-tile"
			headerActions={histogramInfo}
		>
			<div class="network-hist" data-slot="delay-histogram">
				<Chart {spec} />
			</div>
		</NetworkTile>
	</section>
{/if}

<style>
	.network-hist-section {
		display: block;
		width: 100%;
	}
	:global(.network-hist-tile) {
		width: 100%;
	}
	.network-hist {
		max-width: 100%;
	}
</style>

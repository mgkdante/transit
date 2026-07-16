<!--
  SectionDelayHistogram — the live delay distribution, RE-SEATED onto the ChartSpec kernel.

  S9A / S9C: replaces the hand-rolled token-only /max <ul> with the A1 `kind: 'histogram'` spec
  the ONE <Chart> renders — a diverging-at-0 signed distribution (early left / on-time at 0 /
  late right) of the SAME trip-level delays that power p50/p90, with the median + p90 reference
  rules. The count y-axis rides the distribution's OWN peak (a within-distribution shape, not a
  cross-view magnitude); the selector supplies the absolute count domain, so the chart-doctrine
  gate is satisfied without a /max CSS width. Stands DOWN (renders nothing) when the selector
  returns an `absence` spec — the Chart itself paints the honest "no data + why" block, so the
  section only mounts when there IS a distribution.

  Lifted into its OWN full-width row (the histogram reads as a wide shape). The [data-slot]s the
  regression tests anchor on are preserved: delay-histogram-section (the row) + delay-histogram
  (the chart canvas).
-->
<script lang="ts">
	import { Chart, type HistogramSpec, type AbsenceSpec } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import NetworkTile from './NetworkTile.svelte';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionDelayHistogramProps {
		/** The A1 histogram spec, or an absence spec (the section stands down then). */
		spec: HistogramSpec | AbsenceSpec;
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => {
			tip: string;
			href: string;
			label: string;
			linkLabel: string;
		};
		copy: NetworkReliabilityCopy;
	}
	let { spec, info, copy }: SectionDelayHistogramProps = $props();

	const hasHistogram = $derived(spec.kind === 'histogram');
	const i = $derived(info('p50p90', copy.delayHistogramSection));
</script>

{#if hasHistogram}
	<section class="network-hist-section" data-slot="delay-histogram-section">
		{#snippet histogramInfo()}
			<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
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
	/* Delay distribution is its OWN full-width row — the histogram bars get the page width. */
	.network-hist-section {
		display: block;
		width: 100%;
	}
	/* The shared NetworkTile chassis fills this full-width row (the base tile does not
	   force width; the histogram row wants the whole page width for its bars). The
	   :global qualifier reaches the NetworkTile root through the passed class. */
	:global(.network-hist-tile) {
		width: 100%;
	}
	.network-hist {
		max-width: 100%;
	}
</style>

<!--
  SectionCrowding — the occupancy band-shares of buses OBSERVED AT this stop.

  Pure presenter of `selectCrowdingMix`. A 100%-stacked occupancy proportion bar
  reusing the dataviz occupancy scale + the SHARED lines band vocabulary. Honesty
  (Cluster04 doctrine): occupancy_mix is null when no telemetry was attributed to
  this stop (or an all-zero mix) — once the resource has loaded, an explicit styled
  no-telemetry chip renders in its place, never a fabricated / even split.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { MetricDisplay } from '$lib/components/brand';
	import { StackedBar, type StackedSegment } from '$lib/components/dataviz';
	import { AbsentValue } from '$lib/components/edge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { CrowdingVM } from '../selectors/crowdingMix';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';

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
	}
	let { vm, settled, locale, copy }: SectionCrowdingProps = $props();

	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	const segments = $derived<StackedSegment[]>(
		vm.segments.map((s) => ({ code: s.code, value: s.value, label: s.label })),
	);
	// The honest no-telemetry note shows once loaded but no crowding was attributed.
	const showNoTelemetry = $derived(settled && !vm.hasCrowding);
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

{#if vm.hasCrowding && vm.dominant != null}
	<div class="stop-tile stop-reliability-crowding" data-slot="stop-crowding">
		<span class="stop-tile-heading">
			<SectionLabel text={copy.crowding.heading} variant="station" />
			{@render metricInfo('occupancy', copy.crowding.heading)}
		</span>
		<p class="stop-reliability-window">{copy.crowding.window}</p>
		<MetricDisplay
			value={vm.dominantPct ?? copy.noDelay}
			label={vm.dominant.label}
			sublabel={copy.crowding.dominantLabel}
			size="md"
		/>
		<StackedBar
			scale="occupancy"
			{segments}
			label={copy.crowding.barLabel}
			size="sm"
			legend
			interactive
			class="stop-crowding-bar"
		/>
	</div>
{:else if showNoTelemetry}
	<div class="stop-tile stop-reliability-crowding" data-slot="stop-crowding-empty">
		<span class="stop-tile-heading">
			<SectionLabel text={copy.crowding.heading} variant="station" />
			{@render metricInfo('occupancy', copy.crowding.heading)}
		</span>
		<AbsentValue variant="block" reason="no-observations" {locale} />
	</div>
{/if}

<style>
	.stop-reliability-crowding {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.stop-reliability-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>

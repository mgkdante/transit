<!--
  SectionPercentiles — the day-grain typical (p50) vs worst-case (p90) pair.

  Pure presenter of `selectDayPercentiles`. Surfaces the day period's percentiles
  prominently rather than buried with a placeholder; a null field renders the
  styled honest-absence chip (MetricDisplay.absentReason), never a fabricated 0.
  Rendered only when the caller has a non-null percentile pair.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { fmtDelayMin } from '$lib/utils';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { MetricDisplay } from '$lib/components/brand';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';

	interface SectionPercentilesProps {
		/** The typical (p50) / worst-case (p90) pair (null fields → honest absence). */
		percentiles: { p50: number | null; p90: number | null };
		locale: Locale;
		copy: StopReliabilityCopy;
	}
	let { percentiles, locale, copy }: SectionPercentilesProps = $props();

	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});
	const min = (v: number | null): string | null => fmtDelayMin(v, { rounding: 'fixed1' });
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

<div class="stop-tile stop-reliability-percentiles" data-slot="stop-percentiles">
	<SectionHeading level={2} overline={copy.percentiles.heading} class="stop-tile-heading">
		{#snippet explainer()}
			{@render metricInfo('p50p90', copy.percentiles.heading)}
		{/snippet}
	</SectionHeading>
	<div class="stop-reliability-percentile-tiles">
		<MetricDisplay
			value={min(percentiles.p50)}
			emptyLabel={copy.noDelay}
			absentReason="no-observations"
			{locale}
			label={copy.percentiles.typical}
			sublabel={copy.percentiles.typicalCaption}
			size="md"
		/>
		<MetricDisplay
			value={min(percentiles.p90)}
			emptyLabel={copy.noDelay}
			absentReason="no-observations"
			{locale}
			label={copy.percentiles.worstCase}
			sublabel={copy.percentiles.worstCaseCaption}
			size="md"
		/>
	</div>
</div>

<style>
	.stop-reliability-percentiles {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-reliability-percentile-tiles {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2rem;
	}
</style>

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
	import { MetricDisplay } from '$lib/components/brand';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';
	import StopReliabilityPresenter from './StopReliabilityPresenter.svelte';

	interface SectionPercentilesProps {
		/** The typical (p50) / worst-case (p90) pair (null fields → honest absence). */
		percentiles: { p50: number | null; p90: number | null };
		locale: Locale;
		copy: StopReliabilityCopy;
		presentation?: 'standalone' | 'article-body';
	}
	let {
		percentiles,
		locale,
		copy,
		presentation = 'standalone',
	}: SectionPercentilesProps = $props();
	const min = (v: number | null): string | null => fmtDelayMin(v, { rounding: 'fixed1' });
</script>

<StopReliabilityPresenter
	heading={copy.percentiles.heading}
	metricKey="p50p90"
	{locale}
	{presentation}
	dataSlot="stop-percentiles"
>
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
</StopReliabilityPresenter>

<style>
	.stop-reliability-percentile-tiles {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2rem;
	}
</style>

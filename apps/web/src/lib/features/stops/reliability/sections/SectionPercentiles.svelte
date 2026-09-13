<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { fmtDelayMin } from '$lib/utils';
	import { MetricDisplay } from '$lib/components/brand';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';
	import StopReliabilityPresenter from './StopReliabilityPresenter.svelte';

	interface SectionPercentilesProps {
		/** Daily predicted-delay percentiles; null fields remain unavailable. */
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
			absentReason="no-observations"
			{locale}
			label={copy.percentiles.typical}
			sublabel={copy.percentiles.typicalCaption}
			size="md"
		/>
		<MetricDisplay
			value={min(percentiles.p90)}
			absentReason="no-observations"
			{locale}
			label={copy.percentiles.p90}
			sublabel={copy.percentiles.p90Caption}
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

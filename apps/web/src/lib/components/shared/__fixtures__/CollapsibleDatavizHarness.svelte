<script lang="ts">
	import { ChartLegend, SeverityBar, type ChartLegendItem } from '$lib/components/dataviz';
	import { Chart, ScrollFrame, type StackedShareSpec } from '$lib/components/dataviz/chart';
	import CollapsibleSection from '../CollapsibleSection.svelte';

	const shareSpec: StackedShareSpec = {
		kind: 'stacked-share',
		title: 'Vehicle status',
		locale: 'en',
		scale: 'status',
		legend: true,
		segments: [
			{ key: 'on-time', label: 'On time', share: 70, status: 'on_time' },
			{ key: 'late', label: 'Late', share: 30, status: 'late' },
		],
	};

	const standaloneLegendItems: ChartLegendItem[] = [
		{ colorVar: 'var(--dataviz-status-on-time)', label: 'On time' },
		{ colorVar: 'var(--dataviz-status-late)', label: 'Late' },
	];
</script>

{#snippet gutter()}
	<span>Day</span>
{/snippet}

{#snippet scroller()}
	<span>Hourly cells</span>
{/snippet}

<CollapsibleSection title="Reliability" open={true}>
	<p data-testid="plain-card-prose">Plain card prose</p>
	<Chart spec={shareSpec} />
	<ChartLegend items={standaloneLegendItems} data-testid="standalone-chart-legend" />
	<SeverityBar severity="high" value={42} domain={[0, 100]} label="Severe-delay rate" interactive />
	<ScrollFrame scrollLabel="Hourly reliability" {gutter} {scroller} />
</CollapsibleSection>

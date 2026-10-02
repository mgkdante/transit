<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { DashboardGrid } from '$lib/components/layout';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import TerminalPanel, {
		type TerminalFooterItem,
	} from '$lib/components/brand/TerminalPanel.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import NetworkTile from './NetworkTile.svelte';
	import type { KpiCardVM } from '../selectors/headlineKpis';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionLiveHeadlineProps {
		cards: readonly KpiCardVM[];
		locale: Locale;
		copy: NetworkReliabilityCopy;
		terminal: {
			title: string;
			tag: string;
			footerItems: TerminalFooterItem[];
		};
	}
	let { cards, locale, copy, terminal }: SectionLiveHeadlineProps = $props();
</script>

<NetworkTile title={copy.liveSection} sectionKey="network-live-headline">
	<p class="network-live-lede" data-slot="network-lede">{copy.lede}</p>
	<TerminalPanel
		title={terminal.title}
		tag={terminal.tag}
		footerItems={terminal.footerItems}
		class="network-live-terminal"
	>
		<DashboardGrid minTile="max(220px, calc((100% - var(--space-card-gap)) / 2))" gutter={false}>
			{#each cards as card (card.label)}
				<ExplainedMetricCard
					label={card.label}
					value={card.value}
					absentReason={card.absentReason}
					{locale}
					size="lg"
				>
					{#snippet info()}
						<MetricInfo metricKey={card.key} {locale} name={card.label} side="bottom" />
					{/snippet}
				</ExplainedMetricCard>
			{/each}
		</DashboardGrid>
	</TerminalPanel>
</NetworkTile>

<style>
	.network-live-lede {
		margin: 0 0 var(--space-card-gap);
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.65;
	}
</style>

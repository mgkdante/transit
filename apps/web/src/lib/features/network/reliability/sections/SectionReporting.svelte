<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { DashboardGrid } from '$lib/components/layout';
	import { ExplainedMetricCard, RankedRow } from '$lib/components/dataviz';
	import { SectionLabel } from '@yesid/ui/brand';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { KpiCardVM } from '../selectors/headlineKpis';
	import { NON_RESPONDING_DOMAIN, type SilentRow } from '../selectors/silentByRoute';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';
	import NetworkTile from './NetworkTile.svelte';

	interface SectionReportingProps {
		cards: readonly KpiCardVM[];
		silentRows: readonly SilentRow[];
		copy: NetworkReliabilityCopy;
		locale: Locale;
	}
	let { cards, silentRows, copy, locale }: SectionReportingProps = $props();

	const hasSilentRows = $derived(silentRows.length > 0);
</script>

<NetworkTile
	as="section"
	title={copy.reporting.heading}
	sectionKey="network-reporting"
	dataSlot="reporting-section"
	aria-label={copy.reporting.heading}
>
	<div class="network-reporting">
		<DashboardGrid minTile="220px" gutter={false}>
			{#each cards as card (card.label)}
				<ExplainedMetricCard label={card.label} value={card.value} {locale} size="lg">
					{#snippet info()}
						<MetricInfo metricKey={card.key} {locale} name={card.label} side="bottom" />
					{/snippet}
				</ExplainedMetricCard>
			{/each}
		</DashboardGrid>

		<p class="network-reporting-caveat" data-slot="reporting-caveat">{copy.reporting.caveat}</p>

		{#if hasSilentRows}
			<div class="network-silent-tile" data-slot="non-responding-section">
				<SectionLabel text={copy.nonRespondingSection} variant="metric" />
				<ul
					class="network-silent"
					role="list"
					aria-label={copy.nonResponding.summary}
					data-slot="non-responding-by-route"
				>
					{#each silentRows as row (row.key)}
						<li class="network-silent-item">
							<a
								class="network-silent-link"
								href={row.href}
								data-sveltekit-preload-data="hover"
								data-slot="silent-link"
								aria-label={row.ariaLabel}
							>
								<RankedRow
									bare
									rank={row.rank}
									title={row.title}
									subtitle={row.subtitle}
									severity={row.severity}
									value={row.value}
									domain={NON_RESPONDING_DOMAIN}
									display={row.display}
									{locale}
								/>
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
</NetworkTile>

<style>
	.network-reporting {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.network-reporting-caveat {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.network-silent-tile {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}
	.network-silent {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
		gap: 0.5rem 1.25rem;
		max-width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.network-silent-item {
		display: block;
	}
	.network-silent-link {
		display: block;
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius-lg);
	}
	.network-silent-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>

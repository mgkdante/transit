<!--
  SectionReporting — the dedicated vehicles-reporting / coverage row (S9C · DECISIONS C1).

  The "who's reporting" story, lifted wholly out of the headline board into ONE coherent
  full-width row: the vehicles_in_service + non_responding scalar cards (ExplainedMetricCards,
  glance mode), the non_responding_by_route ranked list, and the GLOBAL-SIGNAL caveat (the S5
  "vehicle updated_utc is uniform" finding — per-vehicle silence is a network-wide feed signal,
  so this is a per-line silent-trip tally, never identifiable buses).

  The ranked list keeps its DOCTRINE MARK: RankedRow's SeverityBar on the FIXED absolute
  NON_RESPONDING_DOMAIN [0,10] (never the in-view max). Each row is a ranked link to
  /lines/[id]; list > listitem > link (the <li> owns the listitem role, the anchor the
  interactivity + accessible name, the inner RankedRow is `bare`). The whole section stands
  down only when there are no reporting cards AND no silent rows — but the cards are
  required ints, so the row always carries the two scalars.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { DashboardGrid } from '$lib/components/layout';
	import { ExplainedMetricCard, RankedRow } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { KpiCardVM } from '../selectors/headlineKpis';
	import { NON_RESPONDING_DOMAIN, type SilentRow } from '../selectors/silentByRoute';
	import type { NetworkReliabilityCopy } from '../network-reliability.copy';

	interface SectionReportingProps {
		/** The reporting scalar cards (vehicles-in-service + non-responding, required ints). */
		cards: readonly KpiCardVM[];
		/** The ranked silent-lines rows (empty → the list stands down). */
		silentRows: readonly SilentRow[];
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
		noData: string;
		locale: Locale;
	}
	let { cards, silentRows, info, copy, noData, locale }: SectionReportingProps = $props();

	const hasSilentRows = $derived(silentRows.length > 0);
</script>

<section
	class="network-reporting"
	data-slot="reporting-section"
	aria-label={copy.reporting.heading}
>
	<SectionHeading level={3} overline={copy.reporting.heading} />

	<!-- The two required-int scalar cards (glance mode — the (i) carries the definition). -->
	<DashboardGrid minTile="220px" align="start" gutter={false}>
		{#each cards as card (card.label)}
			{@const i = info(card.key, card.label)}
			<ExplainedMetricCard
				label={card.label}
				value={card.value}
				emptyLabel={noData}
				{locale}
				size="lg"
			>
				{#snippet info()}
					<MetricInfo
						tip={i.tip}
						href={i.href}
						label={i.label}
						linkLabel={i.linkLabel}
						side="bottom"
					/>
				{/snippet}
			</ExplainedMetricCard>
		{/each}
	</DashboardGrid>

	<!-- The GLOBAL-SIGNAL caveat: ONE honesty note for the whole row (consolidated — it
	     subsumes the old per-list caption so there are not two overlapping notes). -->
	<p class="network-reporting-caveat" data-slot="reporting-caveat">{copy.reporting.caveat}</p>

	<!-- Silent scheduled trips, by line — worst first. Stands down when the list is null/empty
	     (the non_responding scalar card above still carries the total). -->
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
							/>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

<style>
	.network-reporting {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	/* The global-signal caveat: quiet mono, AA both themes. */
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
		gap: 0.6rem;
		width: 100%;
	}
	/* Non-responding-by-route ranked list — list > listitem > link; the whole row is a link,
	   strip anchor chrome so RankedRow owns the visuals. Auto-fit grid: one column on a phone,
	   several across a wide desktop, so the row reads as a deliberate block sized for its list. */
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

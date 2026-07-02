<!--
  AlertBreakdown — the Tier-2 cause/effect/severity distribution PRESENTER (S15).

  A pure view over the three pre-built {@link BreakdownRow} lists. The magnitude bar
  rides the dataviz severity scale (RankedRow owns it); --primary stays interactive-
  only. Each distribution stands DOWN on its own {#if} when its bucket list is empty;
  when NO distribution was published the block renders the ONE styled honest-absence
  chip, never a silent vanish. All logic (bucket filtering, label resolution) lives in
  the orchestrator; this file only tiles the rows.
-->
<script lang="ts">
	import type { AlertHistoryCopy } from '../alerts.copy';
	import type { BreakdownRow } from '../selectors/alertLog';
	import type { Locale } from '$lib/i18n';
	import { DashboardGrid } from '$lib/components/layout';
	import { RankedRow } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { AbsentValue } from '$lib/components/edge';

	interface Props {
		causeRows: readonly BreakdownRow[];
		effectRows: readonly BreakdownRow[];
		severityRows: readonly BreakdownRow[];
		hasBreakdown: boolean;
		copy: AlertHistoryCopy;
		locale: Locale;
	}
	let { causeRows, effectRows, severityRows, hasBreakdown, copy, locale }: Props = $props();
</script>

<div class="alert-history-block" data-slot="alert-breakdown">
	<SectionLabel text={copy.breakdown.section} variant="station" />
	{#if !hasBreakdown}
		<!-- HONEST ABSENCE: the archive carries alerts but no published
		     cause/effect/severity distribution. Say so with the styled chip, never a blank. -->
		<AbsentValue variant="block" reason="no-observations" {locale} />
	{:else}
		<DashboardGrid minTile="240px" gutter={false}>
			{#if causeRows.length > 0}
				<div class="alert-history-dist">
					<SectionLabel text={copy.breakdown.byCause} variant="metric" />
					<div class="alert-history-ranked" role="list" aria-label={copy.breakdown.byCauseLabel}>
						{#each causeRows as row (row.key)}
							<RankedRow
								rank={row.rank}
								title={row.title}
								subtitle={row.subtitle}
								severity={row.severity}
								value={row.value}
								display={row.display}
							/>
						{/each}
					</div>
				</div>
			{/if}
			{#if effectRows.length > 0}
				<div class="alert-history-dist">
					<SectionLabel text={copy.breakdown.byEffect} variant="metric" />
					<div class="alert-history-ranked" role="list" aria-label={copy.breakdown.byEffectLabel}>
						{#each effectRows as row (row.key)}
							<RankedRow
								rank={row.rank}
								title={row.title}
								subtitle={row.subtitle}
								severity={row.severity}
								value={row.value}
								display={row.display}
							/>
						{/each}
					</div>
				</div>
			{/if}
			{#if severityRows.length > 0}
				<div class="alert-history-dist">
					<SectionLabel text={copy.breakdown.bySeverity} variant="metric" />
					<div class="alert-history-ranked" role="list" aria-label={copy.breakdown.bySeverityLabel}>
						{#each severityRows as row (row.key)}
							<RankedRow
								rank={row.rank}
								title={row.title}
								subtitle={row.subtitle}
								severity={row.severity}
								value={row.value}
								display={row.display}
							/>
						{/each}
					</div>
				</div>
			{/if}
		</DashboardGrid>
	{/if}
</div>

<style>
	.alert-history-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* Each cause / effect / severity distribution is a quiet bordered tile that fills
	   its DashboardGrid cell. Chrome only (--card bg, --border) — never a data mark;
	   the RankedRow bars bring their own dataviz-severity scale colour. */
	.alert-history-dist {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	.alert-history-ranked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>

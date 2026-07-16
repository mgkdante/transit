<!--
  SectionByRoute — the per-route ranked severity bars (worst line first).

  Pure presenter of `selectRankedRoutes`. Each bar is banded off its avg delay on
  the FIXED DELAY_POS_DOMAIN so the reader sees WHICH line drags this stop down.
  When the stop HAS by-route associations but every one carries a null delay, the
  ranked list is empty — say so with the styled honest no-data chip, never vanish.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { RankedRow } from '$lib/components/dataviz';
	import { AbsentValue } from '$lib/components/edge';
	import type { RankedRouteRow } from '../selectors/rankedRoutes';
	import type { StopReliabilityCopy } from '../stops-reliability.copy';
	import StopReliabilityPresenter from './StopReliabilityPresenter.svelte';

	interface SectionByRouteProps {
		/** The ranked route rows (empty when no real-delay route survived). */
		rows: readonly RankedRouteRow[];
		/** True when the stop HAS by-route associations (drives the empty-vs-absent branch). */
		hasAssociations: boolean;
		locale: Locale;
		copy: StopReliabilityCopy;
		presentation?: 'standalone' | 'article-body';
	}
	let {
		rows,
		hasAssociations,
		locale,
		copy,
		presentation = 'standalone',
	}: SectionByRouteProps = $props();
</script>

{#if rows.length > 0 || hasAssociations}
	<StopReliabilityPresenter
		heading={copy.byRoute}
		metricKey="avgDelay"
		{locale}
		{presentation}
		dataSlot="stop-by-route"
	>
		{#if rows.length > 0}
			<ul class="stop-reliability-route-list" role="list">
				{#each rows as row (row.key)}
					<li>
						<a
							class="stop-reliability-route-link"
							href={row.href}
							data-sveltekit-preload-data="hover"
						>
							<RankedRow
								bare
								rank={row.rank}
								title={row.title}
								severity={row.severity}
								value={row.value}
								domain={row.domain}
								unit={row.unit}
								display={row.display}
							/>
							<span class="sr-only">{row.ariaLabel}</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<!-- Every by-route association carries a null avg delay (too few readings). -->
			<AbsentValue variant="block" reason="no-observations" {locale} />
		{/if}
	</StopReliabilityPresenter>
{/if}

<style>
	.stop-reliability-route-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.stop-reliability-route-link {
		display: block;
		color: inherit;
		text-decoration: none;
		border-radius: var(--radius-md);
	}
	.stop-reliability-route-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>

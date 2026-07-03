<!--
  SectionGaps — the known-data-gaps honesty callout: one humanized line per
  provenance.gaps[] token. Mechanical move out of HealthStatus.svelte; the token
  humanizer is passed in. Stands DOWN (parent guards) when gaps is empty.
-->
<script lang="ts">
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import type { HealthCopy } from '../health.copy';

	interface SectionGapsProps {
		gaps: readonly string[];
		/** Humanizes a raw gap token into a citizen sentence. */
		humanizeGap: (token: string) => string;
		copy: HealthCopy;
	}
	let { gaps, humanizeGap, copy }: SectionGapsProps = $props();
	const t = $derived(copy.gaps);
</script>

<section class="health-block" aria-labelledby="health-gaps" data-slot="gaps-section">
	<SectionLabel id="health-gaps" text={t.section} variant="station" />
	<div class="health-gaps" data-slot="gaps-callout">
		<p class="health-gaps-lede">{t.lede}</p>
		<ul class="health-gaps-list" aria-label={t.listLabel}>
			{#each gaps as gap (gap)}
				<li class="health-gaps-item">{humanizeGap(gap)}</li>
			{/each}
		</ul>
	</div>
</section>

<style>
	.health-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.health-gaps {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--dataviz-status-late);
		border-radius: var(--radius-md);
		background: var(--muted);
	}
	.health-gaps-lede {
		margin: 0;
		color: var(--foreground);
		font-size: var(--text-small);
		line-height: 1.6;
	}
	.health-gaps-list {
		margin: 0;
		padding-inline-start: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.health-gaps-item {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
</style>

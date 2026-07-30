<!--
  SectionSources — one row per provenance.sources[] entry: feed + storage chain +
  a relative last_loaded_utc. Mechanical move out of HealthStatus.svelte; the
  last-loaded relative-age formatter is passed in.
-->
<script lang="ts">
	import { EntityList } from '$lib/components/surface';
	import type { ProvenanceSource } from '$lib/v1/schemas';
	import type { HealthCopy } from '../health.copy';

	interface SectionSourcesProps {
		items: readonly ProvenanceSource[];
		/** Relative last-loaded stamp from an ISO string (or the localized fallback). */
		lastLoaded: (iso: string | null | undefined) => string;
		copy: HealthCopy;
	}
	let { items, lastLoaded, copy }: SectionSourcesProps = $props();
	const t = $derived(copy.sources);
</script>

<div class="health-block" data-slot="sources-section">
	<p class="health-note">{t.note}</p>
	<EntityList items={[...items]} key={(s) => s.feed} class="health-list" aria-label={t.listLabel}>
		{#snippet row(s)}
			<div class="health-row health-row--source" data-slot="source-row">
				<span class="health-row-body">
					<span class="health-row-feed">{s.feed}</span>
					<span class="health-row-chain" aria-label={`${t.chainPrefix}: ${s.chain ?? t.noChain}`}>
						{s.chain ?? t.noChain}
					</span>
				</span>
				<span class="health-row-age">{lastLoaded(s.last_loaded_utc)}</span>
			</div>
		{/snippet}
	</EntityList>
</div>

<style>
	.health-row--source {
		align-items: flex-start;
	}
	.health-row-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.health-row-chain {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
</style>

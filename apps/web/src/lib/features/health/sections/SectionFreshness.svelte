<!--
  SectionFreshness — one EntityRow-style row per provenance.freshness[] entry:
  the feed + a StatusDot encoding the last ingestion-run verdict + a humanized age.
  Mechanical move out of HealthStatus.svelte; the verdict + age humanization are
  passed in as pure functions so this component holds no data logic.
-->
<script lang="ts">
	import { EntityList } from '$lib/components/surface';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import type { ProvenanceFreshness } from '$lib/v1/schemas';
	import type { FreshnessVerdict } from '../selectors/provenanceViews';
	import type { HealthCopy } from '../health.copy';

	interface SectionFreshnessProps {
		items: readonly ProvenanceFreshness[];
		/** Maps a run status to a dataviz aspect + localized verdict label. */
		verdictFor: (status: string | null | undefined) => FreshnessVerdict;
		/** Humanizes an age in seconds (or the localized "no age" note). */
		humanizeAge: (ageS: number | null | undefined) => string;
		copy: HealthCopy;
	}
	let { items, verdictFor, humanizeAge, copy }: SectionFreshnessProps = $props();
	const t = $derived(copy.freshness);
</script>

<section class="health-block" aria-labelledby="health-freshness" data-slot="freshness-section">
	<SectionHeading level={2} id="health-freshness" overline={t.section} number={2} />
	<p class="health-note">{t.note}</p>
	<EntityList items={[...items]} key={(f) => f.feed} class="health-list" aria-label={t.listLabel}>
		{#snippet row(f)}
			{@const v = verdictFor(f.status)}
			<div class="health-row" data-slot="freshness-row">
				<span class="health-row-lead">
					<!-- Decorative: the verdict is already visible text, so the dot carries no
					     sr-only label (AT would otherwise announce the verdict twice). -->
					<StatusDot color={v.aspect} aria-hidden="true" />
					<span class="health-row-feed">{f.feed}</span>
				</span>
				<span class="health-row-meta">
					<span class="health-row-verdict">{v.label}</span>
					<span class="health-row-age">{humanizeAge(f.age_s)}</span>
				</span>
			</div>
		{/snippet}
	</EntityList>
</section>

<style>
	.health-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.health-note {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.6;
		max-width: 60ch;
	}
	.health-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.875rem;
		padding: 0.75rem 0.25rem;
		min-width: 0;
	}
	.health-row-lead {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.health-row-feed {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.health-row-meta {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1rem;
		flex-shrink: 0;
		text-align: right;
	}
	.health-row-verdict {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	.health-row-age {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		flex-shrink: 0;
	}
</style>

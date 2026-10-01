<script lang="ts">
	import { EntityList } from '$lib/components/surface';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import type { ProvenanceFreshness } from '$lib/v1/schemas';
	import type { FreshnessVerdict } from '../selectors/provenanceViews';
	import type { HealthCopy } from '../health.copy';

	interface SectionFreshnessProps {
		items: readonly ProvenanceFreshness[];
		verdictFor: (status: string | null | undefined) => FreshnessVerdict;
		humanizeAge: (ageS: number | null | undefined) => string;
		copy: HealthCopy;
	}
	let { items, verdictFor, humanizeAge, copy }: SectionFreshnessProps = $props();
	const t = $derived(copy.freshness);
</script>

<div class="health-block" data-slot="freshness-section">
	<p class="health-note">{t.note}</p>
	<EntityList items={[...items]} key={(f) => f.feed} class="health-list" aria-label={t.listLabel}>
		{#snippet row(f)}
			{@const v = verdictFor(f.status)}
			<div class="health-row" data-slot="freshness-row">
				<span class="health-row-lead">
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
</div>

<style>
	.health-row-lead {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.health-row-meta {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.125rem;
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
</style>

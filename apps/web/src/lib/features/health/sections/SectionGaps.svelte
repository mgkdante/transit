<script lang="ts">
	import type { HealthCopy } from '../health.copy';

	interface SectionGapsProps {
		gaps: readonly string[];
		humanizeGap: (token: string) => string;
		copy: HealthCopy;
	}
	let { gaps, humanizeGap, copy }: SectionGapsProps = $props();
	const t = $derived(copy.gaps);
</script>

<div class="health-block" data-slot="gaps-section">
	<div class="health-gaps" data-slot="gaps-callout">
		<p class="health-gaps-lede">{t.lede}</p>
		<ul class="health-gaps-list" aria-label={t.listLabel}>
			{#each gaps as gap (gap)}
				<li class="health-gaps-item">{humanizeGap(gap)}</li>
			{/each}
		</ul>
	</div>
</div>

<style>
	.health-gaps {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--dataviz-status-late);
		border-radius: var(--radius-md);
		background: var(--muted);
	}
	.health-gaps-lede {
		margin: 0;
		color: var(--foreground);
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
	}
	@media (min-width: 1024px) {
		.health-gaps-lede {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}
	.health-gaps-list {
		margin: 0;
		padding-inline-start: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.health-gaps-item {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
</style>

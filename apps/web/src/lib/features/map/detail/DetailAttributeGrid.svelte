<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<dl class="detail-attribute-grid map-detail-grid">{@render children()}</dl>

<style>
	.detail-attribute-grid {
		display: grid;
		margin: 0;
	}
	.detail-attribute-grid :global(div) {
		display: grid;
		grid-template-columns: 5.75rem minmax(0, 1fr);
		gap: 0.5rem;
		padding-block: 0.5rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.detail-attribute-grid :global(dt) {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.detail-attribute-grid :global(dd) {
		min-width: 0;
		margin: 0;
		font-size: var(--text-small);
	}
	@container right-panel (max-width: 21rem) {
		.detail-attribute-grid :global(div) {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<dl class="detail-attribute-grid map-detail-grid">{@render children()}</dl>

<style>
	/* Label | value | action on one 44 px line. The action column is always
	   reserved, so every value starts at the same x whatever the row offers. */
	.detail-attribute-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		margin: 0;
	}
	.detail-attribute-grid > :global(div) {
		display: grid;
		grid-template-columns: 7.5rem minmax(0, 1fr) 2.75rem;
		column-gap: 0.75rem;
		align-items: center;
		min-block-size: var(--size-tap-min);
		padding-block: 0.25rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.detail-attribute-grid > :global(div:last-child) {
		border-bottom: 0;
	}
	.detail-attribute-grid :global(dt) {
		min-width: 0;
		overflow-wrap: normal;
		word-break: normal;
		hyphens: none;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--muted-foreground);
	}
	.detail-attribute-grid :global(dd) {
		grid-column: 2;
		min-width: 0;
		margin: 0;
		overflow-wrap: anywhere;
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--foreground);
	}
	.detail-attribute-grid :global(dd.detail-attribute-action) {
		grid-column: 3;
		display: grid;
		justify-items: end;
		overflow-wrap: normal;
	}
	.detail-attribute-grid :global(.detail-fact-action) {
		min-inline-size: 44px;
		min-block-size: 44px;
		color: var(--muted-foreground);
		border-radius: var(--radius-md);
	}
	.detail-attribute-grid :global(.detail-fact-action:hover) {
		color: var(--primary);
		background: var(--muted);
	}
	.detail-attribute-grid :global(.detail-fact-action:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	/* The compact panel gives the value the room the label column would take. */
	@container right-panel (max-width: 21rem) {
		.detail-attribute-grid > :global(div) {
			grid-template-columns: 6.25rem minmax(0, 1fr) 2.75rem;
			column-gap: 0.5rem;
		}
	}
</style>

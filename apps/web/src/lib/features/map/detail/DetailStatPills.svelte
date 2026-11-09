<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="detail-stat-pills" data-slot="detail-meta">{@render children()}</div>

<style>
	.detail-stat-pills {
		display: flex;
		flex-wrap: wrap;
		gap: calc(var(--spacing) * 2) calc(var(--spacing) * 4);
	}
	.detail-stat-pills :global(.detail-pill) {
		position: relative;
		z-index: 0;
		display: inline-flex;
		min-height: 2.75rem;
		min-block-size: 2.75rem;
		align-items: center;
		border: 0;
		padding: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		background: transparent;
	}
	.detail-stat-pills :global(button.detail-pill) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.detail-stat-pills :global(button:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>

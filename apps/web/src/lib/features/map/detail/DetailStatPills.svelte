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
		gap: 0.375rem;
	}
	.detail-stat-pills :global(.detail-pill) {
		min-height: 1.85rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		padding: 0.25rem 0.75rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		background: var(--muted);
	}
</style>

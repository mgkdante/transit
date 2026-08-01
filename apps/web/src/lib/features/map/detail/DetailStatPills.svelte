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
		position: relative;
		z-index: 0;
		display: inline-flex;
		min-height: 2.75rem;
		min-block-size: 2.75rem;
		align-items: center;
		border: 0;
		padding: 0.375rem 0.75rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		background: transparent;
	}
	.detail-stat-pills :global(.detail-pill)::before {
		position: absolute;
		z-index: -1;
		inset-inline: 0;
		top: 50%;
		block-size: 2rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		background: var(--muted);
		content: '';
		transform: translateY(-50%);
	}
</style>

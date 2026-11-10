<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<!-- What the selection belongs to, under the panel title: route, code, counts. -->
<p class="detail-lede" data-slot="detail-meta">{@render children()}</p>

<style>
	.detail-lede {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		min-width: 0;
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.detail-lede :global(.detail-lede-item) {
		min-width: 0;
	}
	.detail-lede :global(.detail-lede-data) {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}
</style>

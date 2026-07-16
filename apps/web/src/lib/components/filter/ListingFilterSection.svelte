<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="mt-5 divider-dashed pt-3" data-slot="listing-filter-section">
	{@render children()}
</div>

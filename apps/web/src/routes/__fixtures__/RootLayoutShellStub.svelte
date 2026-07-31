<script lang="ts">
	import type { Snippet } from 'svelte';

	let { main }: { main?: Snippet } = $props();
</script>

<div data-testid="root-layout-shell">
	{@render main?.()}
</div>

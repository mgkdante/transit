<!-- One block of a filter panel, set off from the previous one by the dashed rule. -->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface FilterSectionProps {
		children: Snippet;
	}
</script>

<script lang="ts">
	let { children }: FilterSectionProps = $props();
</script>

<div class="mt-5 divider-dashed pt-3" data-slot="listing-filter-section">
	{@render children()}
</div>

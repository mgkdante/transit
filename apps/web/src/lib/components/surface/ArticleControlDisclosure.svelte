<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CollapsibleSection } from '$lib/components/shared';

	export interface ArticleControlDisclosureProps {
		title: string;
		open?: boolean;
		children: Snippet;
	}

	let { title, open = $bindable(true), children }: ArticleControlDisclosureProps = $props();
</script>

<CollapsibleSection {title} bind:open>
	<div data-slot="controls-body">
		{@render children()}
	</div>
</CollapsibleSection>

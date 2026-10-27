<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CollapsibleSection } from '@yesid/ui/brand';

	export interface ArticleControlDisclosureProps {
		title: string;
		open?: boolean;
		children: Snippet;
	}

	let { title, open = $bindable(true), children }: ArticleControlDisclosureProps = $props();
</script>

<CollapsibleSection {title} quiet={false} bind:open>
	<div data-slot="controls-body">
		{@render children()}
	</div>
</CollapsibleSection>

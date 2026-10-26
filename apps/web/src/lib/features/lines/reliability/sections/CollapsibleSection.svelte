<script lang="ts">
	import './reliability-sections.css';

	import type { Snippet } from 'svelte';
	import SharedCollapsibleSection from '$lib/components/shared/CollapsibleSection.svelte';
	import { quietMode } from '@yesid/ui/state';

	interface CollapsibleSectionProps {
		eyebrow: string;
		question: string;
		dataSection: string;
		number?: number;
		open?: boolean;
		children: Snippet;
	}
	let {
		eyebrow,
		question,
		dataSection,
		number,
		open = $bindable(true),
		children,
	}: CollapsibleSectionProps = $props();
</script>

<section class="section" data-section={dataSection} aria-label={eyebrow}>
	<SharedCollapsibleSection
		title={eyebrow}
		subtitle={question}
		headerVariant="article-summary"
		index={number == null ? null : number - 1}
		bind:open
		closeSignal={quietMode.closeSignal}
		openSignal={quietMode.openSignal}
		bulkCollapsed={quietMode.enabled}
	>
		{@render children()}
	</SharedCollapsibleSection>
</section>

<style>
	.section {
		width: 100%;
	}
</style>

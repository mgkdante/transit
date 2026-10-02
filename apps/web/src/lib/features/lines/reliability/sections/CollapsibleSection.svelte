<script lang="ts">
	import './reliability-sections.css';

	import type { Snippet } from 'svelte';
	import SharedCollapsibleSection from '$lib/components/shared/CollapsibleSection.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

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
		closeSignal={quietModeStore.closeSignal}
		openSignal={quietModeStore.openSignal}
		bulkCollapsed={quietModeStore.enabled}
	>
		{@render children()}
	</SharedCollapsibleSection>
</section>

<style>
	.section {
		width: 100%;
	}
</style>

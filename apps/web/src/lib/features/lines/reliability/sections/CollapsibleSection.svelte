<script lang="ts">
	import type { Snippet } from 'svelte';
	import SharedCollapsibleSection from '$lib/components/shared/CollapsibleSection.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

	interface CollapsibleSectionProps {
		/** Mono eyebrow (e.g. "WHEN TO RIDE"). */
		eyebrow: string;
		/** The plain-language DISPLAY-scale section title (the toggle's accessible name). */
		question: string;
		/** `data-section` token for wayfinding / tests (e.g. "when-to-ride"). */
		dataSection: string;
		/** Optional D4 numbered chip (the ordered §0–§4 sequence) — decorative wayfinding. */
		number?: number;
		/** Open by default; bindable so a caller could persist/seed it later. */
		open?: boolean;
		/** The section body. */
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

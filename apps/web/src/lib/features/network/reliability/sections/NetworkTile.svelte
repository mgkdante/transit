<!--
  NetworkTile — the thin /network adapter around the shared article disclosure card.

  Network sections own only their responsive grid placement here. The shared
  CollapsibleSection owns the solid card surface, accessible trigger, article-summary
  header, chevron, persisted open state, whole-card pointer behavior, and bulk signals.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import CollapsibleSection from '$lib/components/shared/CollapsibleSection.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { cn } from '$lib/utils';

	interface NetworkTileProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		title: string;
		subtitle?: string;
		sectionKey: string;
		wide?: boolean;
		as?: 'div' | 'section';
		dataSlot?: string;
		index?: number | null;
		class?: string;
		headerActions?: Snippet;
		children?: Snippet;
	}

	let {
		title,
		subtitle,
		sectionKey,
		wide = false,
		as = 'div',
		dataSlot,
		index = null,
		class: className,
		headerActions,
		children,
		...rest
	}: NetworkTileProps = $props();
</script>

<svelte:element
	this={as}
	class={cn('network-section', wide && 'network-section--wide', className)}
	data-slot={dataSlot}
	data-network-section={sectionKey}
	{...rest}
>
	<CollapsibleSection
		{title}
		{subtitle}
		headerVariant="article-summary"
		{sectionKey}
		{index}
		closeSignal={quietModeStore.closeSignal}
		openSignal={quietModeStore.openSignal}
		bulkCollapsed={quietModeStore.enabled}
		{headerActions}
	>
		{@render children?.()}
	</CollapsibleSection>
</svelte:element>

<style>
	.network-section {
		width: 100%;
		min-width: 0;
		align-self: start;
	}

	.network-section--wide {
		grid-column: 1 / -1;
	}
</style>

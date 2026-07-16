<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import SurfaceRail, { type SurfaceRailContext } from '$lib/components/surface/SurfaceRail.svelte';
	import ArticleSummaryLane from './ArticleSummaryLane.svelte';

	export interface ReliabilityRailLayoutProps {
		rail: Snippet<[SurfaceRailContext]>;
		content: Snippet;
		articleSummary?: Snippet;
		label: string;
		summary?: string;
		openAria: string;
		closeAria: string;
		class?: string;
	}

	let {
		rail,
		content,
		articleSummary,
		label,
		summary,
		openAria,
		closeAria,
		class: className,
	}: ReliabilityRailLayoutProps = $props();
</script>

<div class={cn('reliability-rail-layout', className)} data-slot="reliability-rail-layout">
	<SurfaceRail {rail} {label} {summary} {openAria} {closeAria} />
	<div class="reliability-rail-content" data-slot="reliability-rail-content">
		{#if articleSummary}
			<ArticleSummaryLane data-slot="reliability-rail-summary">
				{@render articleSummary()}
			</ArticleSummaryLane>
		{/if}
		{@render content()}
	</div>
</div>

<style>
	.reliability-rail-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--detail-column-gap, 2rem);
		width: 100%;
		min-width: 0;
	}
	.reliability-rail-content {
		min-width: 0;
	}

	@media (min-width: 1024px) {
		.reliability-rail-layout {
			grid-template-columns:
				var(--detail-rail-width, var(--layout-control-rail-width))
				minmax(0, var(--detail-center-max, var(--container-content)));
			gap: var(--detail-column-gap, 2rem);
			align-items: start;
			justify-content: center;
		}
	}
</style>

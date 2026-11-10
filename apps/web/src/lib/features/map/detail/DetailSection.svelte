<script lang="ts">
	import type { Snippet } from 'svelte';
	import DetailInlineAction from './DetailInlineAction.svelte';

	interface Props {
		title: string;
		slot: string;
		collapsed?: boolean;
		ladderMin?: 420;
		ladderExpand?: 560;
		inlineAction?: { href: string; label: string; dataSlot: string };
		count?: number;
		children: Snippet;
	}

	let {
		title,
		slot,
		collapsed = false,
		ladderMin,
		ladderExpand,
		inlineAction,
		count,
		children,
	}: Props = $props();
</script>

<section
	class="detail-section"
	data-slot={slot}
	data-ladder-min={ladderMin}
	data-ladder-expand={ladderExpand}
	aria-label={title}
>
	{#if collapsed && ladderExpand == null}
		<details>
			<summary
				>{title}{#if count != null}<span class="detail-section-count">{count}</span>{/if}</summary
			>
			{@render children()}
		</details>
	{:else}
		{#if inlineAction}
			<DetailInlineAction
				href={inlineAction.href}
				label={inlineAction.label}
				dataSlot={inlineAction.dataSlot}
			/>
		{:else}
			<h3>
				{title}{#if count != null}<span class="detail-section-count">{count}</span>{/if}
			</h3>
		{/if}
		{#if ladderExpand}
			<div class="detail-ladder-content" data-slot={`${slot}-content`} data-ladder-content>
				{@render children()}
			</div>
		{:else}
			{@render children()}
		{/if}
	{/if}
</section>

<style>
	/* Section heads share the left panel's group-head voice: mono caption, 600. */
	.detail-section {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.25rem;
		min-width: 0;
	}
	.detail-section h3,
	.detail-section summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--foreground);
	}
	.detail-section h3 {
		min-block-size: 2rem;
	}
	.detail-section summary {
		min-block-size: var(--size-tap-min);
		cursor: pointer;
		list-style: none;
	}
	.detail-section summary::-webkit-details-marker {
		display: none;
	}
	.detail-section summary::after {
		width: 0.4rem;
		height: 0.4rem;
		margin-inline-start: auto;
		margin-inline-end: 0.25rem;
		border-right: 1.5px solid var(--muted-foreground);
		border-bottom: 1.5px solid var(--muted-foreground);
		transform: rotate(45deg);
		content: '';
	}
	.detail-section details[open] > summary::after {
		transform: rotate(225deg);
	}
	.detail-section summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}
	.detail-section :global(.detail-section-count) {
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	.detail-ladder-content {
		visibility: hidden;
		block-size: 0;
		overflow: hidden;
	}
</style>

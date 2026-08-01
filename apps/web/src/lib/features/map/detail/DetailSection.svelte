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
		children: Snippet;
	}

	let {
		title,
		slot,
		collapsed = false,
		ladderMin,
		ladderExpand,
		inlineAction,
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
			<summary>{title}</summary>
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
			<h3>{title}</h3>
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
	.detail-section {
		display: grid;
		gap: 0.625rem;
	}
	.detail-section h3,
	.detail-section summary {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	/* The floor keeps the UA's list-item display: ::marker (the disclosure
	   triangle) is the summary's only expand affordance — display:flex kills it. */
	.detail-section summary {
		min-height: 2.75rem;
		min-block-size: 2.75rem;
		padding-block: 0.625rem;
		cursor: pointer;
	}
	.detail-ladder-content {
		visibility: hidden;
		block-size: 0;
		overflow: hidden;
	}
</style>

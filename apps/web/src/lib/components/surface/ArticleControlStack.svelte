<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	export interface ArticleControlStackProps extends Omit<
		HTMLAttributes<HTMLDivElement>,
		'children'
	> {
		label?: Snippet;
		history?: Snippet;
		primary?: Snippet;
		secondary?: Snippet;
		caption?: Snippet;
		class?: string;
	}

	let {
		label,
		history,
		primary,
		secondary,
		caption,
		class: className,
		...restProps
	}: ArticleControlStackProps = $props();
</script>

<div
	class={cn('article-control-stack', className)}
	data-slot="article-control-stack"
	{...restProps}
>
	{#if label}
		<div class="article-control-stack__region" data-region="label">
			{@render label()}
		</div>
	{/if}
	{#if history}
		<div class="article-control-stack__region" data-region="history">
			{@render history()}
		</div>
	{/if}
	{#if primary}
		<div class="article-control-stack__region" data-region="primary">
			{@render primary()}
		</div>
	{/if}
	{#if secondary}
		<div class="article-control-stack__region" data-region="secondary">
			{@render secondary()}
		</div>
	{/if}
	{#if caption}
		<div class="article-control-stack__region" data-region="caption">
			{@render caption()}
		</div>
	{/if}
</div>

<style>
	.article-control-stack {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		max-width: 100%;
		min-width: 0;
	}

	.article-control-stack__region {
		display: grid;
		gap: 0.75rem;
		width: 100%;
		max-width: 100%;
		min-width: 0;
	}

	.article-control-stack__region:empty {
		display: none;
	}
</style>

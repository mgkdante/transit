<script lang="ts">
	import { cn } from '#lib/utils/index.ts';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface ArticleSectionStackProps extends Omit<
		HTMLAttributes<HTMLDivElement>,
		'children'
	> {
		children?: Snippet;
		class?: string;
	}

	let { children, class: className, ...restProps }: ArticleSectionStackProps = $props();
</script>

<div
	class={cn('article-section-stack', className)}
	data-slot="article-section-stack"
	{...restProps}
>
	{@render children?.()}
</div>

<style>
	.article-section-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-card-gap);
		width: 100%;
		min-width: 0;
		margin: 0;
	}

	.article-section-stack > :global(*) {
		margin: 0;
	}

	.article-section-stack :global(.section-subtitle--article-summary .section-subtitle__text) {
		font-family: var(--font-heading);
		font-size: var(--text-title);
		font-weight: 700;
		line-height: 1.12;
		letter-spacing: var(--tracking-tight);
		color: var(--foreground);
		max-inline-size: none;
		text-wrap: wrap;
	}
</style>

<script lang="ts">
	import { cn } from '$lib/utils';
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
</style>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	export interface ArticleSummaryLaneProps extends Omit<
		HTMLAttributes<HTMLDivElement>,
		'children'
	> {
		children?: Snippet;
		class?: string;
	}

	let { children, class: className, ...restProps }: ArticleSummaryLaneProps = $props();
</script>

<div class={cn('article-summary-lane', className)} data-slot="article-summary-lane" {...restProps}>
	<div class="article-summary-lane__content">
		{@render children?.()}
	</div>
</div>

<style>
	.article-summary-lane {
		display: flex;
		justify-content: center;
		width: 100%;
		min-width: 0;
		margin-block-end: var(--space-card-gap);
	}

	.article-summary-lane__content {
		display: flex;
		justify-content: center;
		width: 100%;
		min-width: 0;
		text-align: center;
	}

	.article-summary-lane__content > :global(*) {
		max-width: 100%;
	}
</style>

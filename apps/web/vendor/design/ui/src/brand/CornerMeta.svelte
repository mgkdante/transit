<!--
  Decorative mono annotations in the four corners of the nearest positioned ancestor, with optional
  crosshair marks. Hidden from assistive tech and below 768px; repeat anything essential in the
  content.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface CornerMetaProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		topLeft?: Snippet;
		topRight?: Snippet;
		bottomLeft?: Snippet;
		bottomRight?: Snippet;
		crosshair?: boolean;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';
	import CornerMarks from './CornerMarks.svelte';

	let {
		topLeft,
		topRight,
		bottomLeft,
		bottomRight,
		crosshair = false,
		class: className,
		...restProps
	}: CornerMetaProps = $props();
</script>

<div class={cn('corner-meta', className)} data-slot="corner-meta" aria-hidden="true" {...restProps}>
	{#if crosshair}
		<CornerMarks size="sm" />
	{/if}
	{#if topLeft}
		<span class="corner corner-tl" data-slot="corner-tl">{@render topLeft()}</span>
	{/if}
	{#if topRight}
		<span class="corner corner-tr" data-slot="corner-tr">{@render topRight()}</span>
	{/if}
	{#if bottomLeft}
		<span class="corner corner-bl" data-slot="corner-bl">{@render bottomLeft()}</span>
	{/if}
	{#if bottomRight}
		<span class="corner corner-br" data-slot="corner-br">{@render bottomRight()}</span>
	{/if}
</div>

<style>
	.corner-meta {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: var(--z-content);
		display: none;
	}

	@media (min-width: 768px) {
		.corner-meta {
			display: block;
		}
	}

	.corner {
		position: absolute;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.2;
		letter-spacing: var(--tracking-wide);
		color: var(--muted-foreground);
		white-space: nowrap;
		max-width: calc(50% - 1.5rem);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.corner-tl {
		top: 0.75rem;
		left: 0.75rem;
	}
	.corner-tr {
		top: 0.75rem;
		right: 0.75rem;
		text-align: right;
	}
	.corner-bl {
		bottom: 0.75rem;
		left: 0.75rem;
	}
	.corner-br {
		bottom: 0.75rem;
		right: 0.75rem;
		text-align: right;
	}
</style>

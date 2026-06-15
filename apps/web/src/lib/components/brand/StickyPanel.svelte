<!--
  StickyPanel — sidebar panel with sticky positioning and brand border.
  Brand primitive: replaces scattered sticky sidebar implementations.
  Pure CSS `position: sticky` — NO motion library (transit P1.7 decision:
  yesid's scrollChain/lenis chaining is stubbed to a no-op here).
  Ported from yesid.dev StickyPanel; re-themed to transit tokens.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface StickyPanelProps extends HTMLAttributes<HTMLDivElement> {
		/** CSS top offset for sticky positioning */
		top?: string;
		/** Panel content */
		children: Snippet;
		class?: string;
	}

	let { top = '6rem', children, class: className, ...restProps }: StickyPanelProps = $props();
</script>

<div
	class={cn('panel scrollbar-hidden', className)}
	data-slot="sticky-panel"
	style="top: {top};"
	{...restProps}
>
	{@render children()}
</div>

<style>
	.panel {
		position: sticky;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		padding: 1.25rem;
		overflow-y: auto;
		max-height: calc(100dvh - 8rem);
	}
</style>

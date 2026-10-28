<!--
  A page surface: a full-width column with the page gutter, fluid block padding and a fluid gap
  between its children.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		as?: 'section' | 'div' | 'article';
		children?: Snippet;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';

	let { as = 'section', children, class: className, ...restProps }: SurfaceProps = $props();
</script>

<svelte:element this={as} class={cn('surface-shell', className)} data-slot="surface" {...restProps}>
	{@render children?.()}
</svelte:element>

<style>
	.surface-shell {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
		padding-inline: var(--space-page-x);
		padding-block: clamp(1.5rem, 4vw, 2.5rem);
	}
</style>

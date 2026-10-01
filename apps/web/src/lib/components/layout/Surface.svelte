<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		children?: Snippet;
		gutter?: boolean;
		pad?: 'surface' | 'none';
		as?: 'section' | 'div' | 'article';
		class?: string;
	}
	let {
		children,
		gutter = true,
		pad = 'surface',
		as = 'section',
		class: className,
		...rest
	}: SurfaceProps = $props();
</script>

<svelte:element
	this={as}
	class={cn('surface-shell', `surface-shell--${pad}`, gutter && 'surface-shell--gutter', className)}
	data-slot="surface"
	{...rest}
>
	{@render children?.()}
</svelte:element>

<style>
	.surface-shell {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
	}
	.surface-shell--gutter {
		padding-inline: var(--space-page-x);
	}
	.surface-shell--surface {
		padding-block: clamp(1.5rem, 4vw, 2.5rem);
	}
	.surface-shell--none {
		padding-block: 0;
	}

	:global(.surface-bleed) {
		margin-inline: calc(-1 * var(--space-page-x));
	}
</style>

<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		children?: Snippet;
		width?: 'content' | 'wide' | 'bleed';
		gutter?: boolean;
		pad?: 'surface' | 'hub' | 'none';
		as?: 'section' | 'div' | 'article';
		class?: string;
	}
	let {
		children,
		width = 'content',
		gutter = true,
		pad = 'surface',
		as = 'section',
		class: className,
		...rest
	}: SurfaceProps = $props();
	const maxw = $derived(
		width === 'wide'
			? 'var(--container-wide)'
			: width === 'bleed'
				? 'none'
				: 'var(--container-content)',
	);
</script>

<svelte:element
	this={as}
	class={cn('surface-shell', `surface-shell--${pad}`, gutter && 'surface-shell--gutter', className)}
	data-slot="surface"
	style="--surface-maxw: {maxw};"
	{...rest}
>
	{@render children?.()}
</svelte:element>

<style>
	.surface-shell {
		width: 100%;
		max-width: var(--surface-maxw);
		margin-inline: auto;
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
	.surface-shell--hub {
		padding-block: clamp(2rem, 6vw, 4rem);
	}
	.surface-shell--none {
		padding-block: 0;
	}
</style>

<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface ChartLegendItem {
		colorVar: string;
		label: string;
		value?: string;
		swatch?: 'dot' | 'square';
		glyph?: string;
	}

	export interface ChartLegendProps extends WithElementRef<HTMLAttributes<HTMLUListElement>> {
		items: ChartLegendItem[];
		layout?: 'wrap' | 'stack';
		size?: 'sm' | 'md';
		class?: string;
	}

	let {
		items,
		layout = 'wrap',
		size = 'sm',
		class: className,
		ref = $bindable(null),
		...restProps
	}: ChartLegendProps = $props();
</script>

<ul
	bind:this={ref}
	class={cn(
		'dv-legend flex text-caption text-muted-foreground',
		layout === 'stack' ? 'flex-col gap-y-1' : 'flex-wrap gap-x-3 gap-y-1',
		size === 'md' ? 'text-small gap-x-4' : '',
		className,
	)}
	data-slot="chart-legend"
	data-card-interactive
	aria-hidden="true"
	{...restProps}
>
	{#each items as item, i (item.label + '-' + i)}
		<li class="inline-flex min-h-6 items-center gap-1.5">
			{#if item.glyph}
				<span
					class="inline-flex size-2.5 items-center justify-center leading-none"
					style="color: {item.colorVar};"
					aria-hidden="true">{item.glyph}</span
				>
			{:else}
				<span
					class={cn(
						'inline-block size-2.5',
						item.swatch === 'square' ? 'rounded-sm' : 'rounded-full',
					)}
					style="background: {item.colorVar};"
					aria-hidden="true"
				></span>
			{/if}
			<span class="text-foreground">{item.label}</span>
			{#if item.value != null}
				<span class="font-mono tabular-nums">{item.value}</span>
			{/if}
		</li>
	{/each}
</ul>

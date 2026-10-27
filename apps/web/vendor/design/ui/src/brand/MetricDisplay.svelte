<!-- Big number with its label. An empty value renders `absent` instead, such as "no data" copy. -->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface MetricDisplayProps extends HTMLAttributes<HTMLDivElement> {
		value: string | null | undefined;
		label: string;
		/** Rendered in place of the value when it is null, undefined or empty. */
		absent?: Snippet;
		/** Rendered after the label, such as an info tooltip trigger. */
		info?: Snippet;
		sublabel?: string;
		size?: 'sm' | 'md' | 'lg';
		labelBelow?: boolean;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';

	let {
		value,
		label,
		absent,
		info,
		sublabel,
		size = 'md',
		labelBelow = false,
		class: className,
		...restProps
	}: MetricDisplayProps = $props();

	const valueClass = {
		sm: 'text-subheading',
		md: 'text-heading',
		lg: 'text-title',
	} as const;

	const isEmpty = $derived(value == null || value === '');
</script>

{#snippet labelRow(extra: string)}
	<div class={cn('flex items-center gap-1', extra)}>
		<span class="label-metric">{label}</span>
		{@render info?.()}
	</div>
{/snippet}

<div class={cn('flex flex-col', className)} data-slot="metric-display" {...restProps}>
	{#if !labelBelow}
		{@render labelRow('')}
	{/if}
	{#if isEmpty}
		{@render absent?.()}
	{:else}
		<span
			class={cn(
				'metric-value font-heading font-extrabold leading-none text-accent-text',
				valueClass[size],
			)}>{value}</span
		>
	{/if}
	{#if labelBelow}
		{@render labelRow('mt-2')}
	{/if}
	{#if sublabel}
		<span class="mt-1 font-mono text-caption text-[var(--muted-foreground)]">{sublabel}</span>
	{/if}
</div>

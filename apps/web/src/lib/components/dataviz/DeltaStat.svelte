<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface DeltaStatProps extends WithElementRef<HTMLAttributes<HTMLSpanElement>> {
		delta: number | null;
		display?: string;
		higherIsBetter?: boolean;
		context?: string;
		ariaNoun?: string;
		class?: string;
	}

	let {
		delta,
		display,
		higherIsBetter = false,
		context,
		ariaNoun,
		class: className,
		ref = $bindable(null),
		...restProps
	}: DeltaStatProps = $props();

	const hasDelta = $derived(delta != null && !Number.isNaN(delta));
	const glyph = $derived(!hasDelta ? '·' : delta! > 0 ? '▲' : delta! < 0 ? '▼' : '·');
	const colorVar = $derived.by(() => {
		if (!hasDelta || delta === 0) return 'var(--dataviz-status-unknown)';
		const improvement = higherIsBetter ? delta! > 0 : delta! < 0;
		return improvement ? 'var(--dataviz-status-on-time)' : 'var(--dataviz-severity-critical)';
	});
	const text = $derived(!hasDelta ? '' : (display ?? (delta! > 0 ? `+${delta}` : `${delta}`)));
	const ariaLabel = $derived(
		!hasDelta
			? context
				? `${ariaNoun ? `${ariaNoun} ` : ''}${context}`
				: 'no change data'
			: `change ${text}${ariaNoun ? ` ${ariaNoun}` : ''}${context ? ` ${context}` : ''}`,
	);
</script>

<span
	bind:this={ref}
	class={cn(
		'dv-delta-stat inline-flex items-center gap-1 font-mono text-caption tabular-nums',
		className,
	)}
	style="color: {colorVar};"
	data-slot="delta-stat"
	role="img"
	aria-label={ariaLabel}
	{...restProps}
>
	<span aria-hidden="true">{glyph}</span>
	{#if hasDelta}<span aria-hidden="true">{text}</span>{/if}
	{#if context}<span aria-hidden="true" class="dv-delta-context text-muted-foreground"
			>{context}</span
		>{/if}
</span>

<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	type StatusAspect = 'early' | 'on_time' | 'late' | 'severe' | 'unknown';
	type SignalAspect = 'orange' | 'green' | 'caution' | 'stop' | 'lunar';

	export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
		color?: SignalAspect | StatusAspect;
		pulse?: boolean;
		size?: 'sm' | 'md';
		ring?: boolean;
		label?: string;
		class?: string;
	}

	let {
		color = 'orange',
		pulse = false,
		size = 'sm',
		ring = false,
		label,
		class: className,
		...restProps
	}: StatusDotProps = $props();

	const sizeMap = { sm: 'size-1.5', md: 'size-2.5' } as const;

	const colorMap = {
		orange: 'bg-primary',
		green: 'bg-[var(--signal-proceed)]',
		caution: 'bg-[var(--signal-caution)]',
		stop: 'bg-[var(--signal-stop)]',
		lunar: 'bg-[var(--signal-lunar)]',
		early: 'bg-dataviz-status-early',
		on_time: 'bg-dataviz-status-on-time',
		late: 'bg-dataviz-status-late',
		severe: 'bg-dataviz-status-severe',
		unknown: 'bg-dataviz-status-unknown',
	} as const;
</script>

<span
	class={cn(
		sizeMap[size],
		'inline-block shrink-0 rounded-full',
		pulse ? 'led-pulse' : '',
		ring ? 'outline outline-[3px] outline-[var(--muted)]' : '',
		colorMap[color],
		className,
	)}
	data-slot="status-dot"
	{...restProps}
>
	{#if label}<span class="sr-only">{label}</span>{/if}
</span>

<!-- Status lamp. Decorative unless `label` gives it an accessible name. -->
<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';

	export type StatusDotColor =
		| 'orange'
		| 'green'
		| 'caution'
		| 'stop'
		| 'lunar'
		| 'early'
		| 'on_time'
		| 'late'
		| 'severe'
		| 'unknown';

	export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
		/** Signal aspects (orange to lunar) or data statuses (early to unknown). */
		color?: StatusDotColor;
		pulse?: boolean;
		size?: 'sm' | 'md';
		/** Muted halo for dots over muted surfaces; an outline, so it composes with the pulse shadow. */
		ring?: boolean;
		label?: string;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';

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
		early: 'bg-[var(--dataviz-status-early)]',
		on_time: 'bg-[var(--dataviz-status-on-time)]',
		late: 'bg-[var(--dataviz-status-late)]',
		severe: 'bg-[var(--dataviz-status-severe)]',
		unknown: 'bg-[var(--dataviz-status-unknown)]',
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
	aria-hidden={label ? undefined : 'true'}
	{...restProps}
>
	{#if label}<span class="sr-only">{label}</span>{/if}
</span>

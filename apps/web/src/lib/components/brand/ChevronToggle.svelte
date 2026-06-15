<!--
  ChevronToggle — rotatable expand/collapse arrow.
  Brand primitive (Set B): rotates 90deg when open via
  --duration-normal/--ease-default. Decorative (aria-hidden) — pair with an
  aria-expanded control on the parent.
  Ported from yesid.dev ChevronToggle; tokens already transit-native.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { SVGAttributes } from 'svelte/elements';

	export interface ChevronToggleProps extends SVGAttributes<SVGSVGElement> {
		/** Whether the toggle is in open/expanded state */
		open: boolean;
		/** Arrow size */
		size?: 'sm' | 'md';
		/** Base direction — rotates 90deg when open */
		direction?: 'right' | 'down';
		class?: string;
	}

	let {
		open,
		size = 'md',
		direction = 'right',
		class: className,
		...restProps
	}: ChevronToggleProps = $props();

	const sizeClass = { sm: 'size-4', md: 'size-5' } as const;
</script>

<svg
	class={cn(
		'chevron',
		sizeClass[size],
		'shrink-0 text-[var(--muted-foreground)] transition-transform',
		open ? 'chevron-open' : '',
		direction === 'right' ? 'chevron-right' : 'chevron-down',
		className,
	)}
	data-slot="chevron-toggle"
	viewBox="0 0 20 20"
	fill="currentColor"
	aria-hidden="true"
	{...restProps}
>
	<path d="M8 4l7 6-7 6V4z" />
</svg>

<style>
	.chevron {
		transition:
			transform var(--duration-normal) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}

	/* Right-pointing: rotates 90deg clockwise to point down when open */
	.chevron-right.chevron-open {
		transform: rotate(90deg);
	}

	/* Down-pointing: starts right (▶), rotates to down (▼) when open */
	.chevron-down.chevron-open {
		transform: rotate(90deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}
</style>

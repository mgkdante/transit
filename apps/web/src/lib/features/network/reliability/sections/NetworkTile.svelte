<!--
  NetworkTile — the ONE shared network-section panel (§C6 / §C5.7).

  The bordered `--card` tile chassis that every /network content section wrapped in
  its own byte-identical `.network-tile` CSS block (duplicated 8×). Extracted here so
  the chassis lives ONCE: a flex-column card on --card, 1rem padding, --radius-lg,
  the soft --shadow-card bevel (E1 glow map: content tiles rest, no drill-in hover).

  Props:
    · `wide`     — the two-column-spanning variant (grid-column: 1 / -1), used by the
      trend tile; default false.
    · `as`       — the wrapper element ('div' default; 'section' for a landmark-less
      section wrapper where the caller wants one).
    · `class`    — extra classes (e.g. the histogram's own inner-layout class).
    · `dataSlot` — the `data-slot` hook some sections carry for tests/CSS targeting.
  Everything else spreads onto the root. Chrome only — no --primary, no data marks.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface NetworkTileProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		wide?: boolean;
		as?: 'div' | 'section';
		dataSlot?: string;
		class?: string;
		children?: Snippet;
	}

	let {
		wide = false,
		as = 'div',
		dataSlot,
		class: className,
		children,
		...rest
	}: NetworkTileProps = $props();
</script>

<svelte:element
	this={as}
	class={cn('network-tile', wide && 'network-tile--wide', className)}
	data-slot={dataSlot}
	{...rest}
>
	{@render children?.()}
</svelte:element>

<style>
	.network-tile {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		/* E1 glow map: content tiles rest on --shadow-card (the soft card bevel);
		   they carry no drill-in, so no interactive hover-lift. */
		box-shadow: var(--shadow-card);
	}
	/* The two-column-spanning variant (the trend tile). */
	.network-tile--wide {
		grid-column: 1 / -1;
	}
</style>

<!--
  IconArray — a waffle of discrete outcomes (slice-S3, Chart Doctrine §D).

  One cell per countable event (a trip ran / was cancelled / went silent), grouped
  by category in order. Each cell is a GLYPH (distinct per category) in the
  category's DATAVIZ colour — glyph + colour, never colour alone — so the three
  states read apart even in grayscale / under CVD. The exact proportion is carried
  in aria (e.g. "47 delivered, 3 cancelled, 2 silent"). Best below ~60 cells; above
  that the doctrine prefers a single completeness bar (caller's choice).

  HONESTY: the three transit states are DISTINCT — delivered ≠ cancelled ≠ silent;
  pass each as its own segment with its own glyph + token (never lump silent into
  cancelled). data-slot="icon-array".
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface IconArraySegment {
		/** Number of cells for this category. */
		count: number;
		/** Cell colour — a `var(--dataviz-*)` token (never --primary). */
		colorVar: string;
		/** Glyph for this category (distinct, so colour is never the sole channel). */
		glyph: string;
		/** Localized category name, woven into the aria summary. */
		label: string;
	}

	export interface IconArrayProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** Categories in render order (e.g. delivered, cancelled, silent). */
		segments: IconArraySegment[];
		/** Grid columns. Default 10 (a 10-wide waffle). */
		columns?: number;
		/** Accessible summary; falls back to "{count} {label}, …" over the segments. */
		label?: string;
		class?: string;
	}

	let {
		segments,
		columns = 10,
		label,
		class: className,
		ref = $bindable(null),
		...restProps
	}: IconArrayProps = $props();

	type Cell = { colorVar: string; glyph: string };
	const cells = $derived<Cell[]>(
		segments.flatMap((s) =>
			Array.from({ length: Math.max(0, Math.round(s.count)) }, () => ({
				colorVar: s.colorVar,
				glyph: s.glyph,
			})),
		),
	);

	const summary = $derived(
		label ?? segments.map((s) => `${Math.round(s.count)} ${s.label}`).join(', '),
	);
</script>

<figure
	bind:this={ref}
	class={cn('dv-icon-array m-0', className)}
	data-slot="icon-array"
	aria-label={summary}
	{...restProps}
>
	<div
		class="dv-icon-array-grid"
		style="grid-template-columns: repeat({columns}, 1fr);"
		aria-hidden="true"
	>
		{#each cells as cell, i (i)}
			<span class="dv-icon-array-cell" style="color: {cell.colorVar};">{cell.glyph}</span>
		{/each}
	</div>
</figure>

<style>
	.dv-icon-array-grid {
		display: grid;
		gap: 0.15rem;
		width: max-content;
		max-width: 100%;
	}
	.dv-icon-array-cell {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1;
		text-align: center;
	}
</style>

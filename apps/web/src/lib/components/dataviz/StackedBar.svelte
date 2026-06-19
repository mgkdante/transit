<!--
  StackedBar, a 100%-stacked horizontal proportion bar (SVG, no chart lib).

  Two flavours via `scale`:
    - 'status'    : segments keyed by StatusCode (status distribution).
    - 'occupancy' : segments keyed by OccupancyCode (occupancy mix).

  Each segment's colour comes from the matching dataviz scale
  (--dataviz-status-* / --dataviz-occupancy-*). DOCTRINE: every segment is a
  data mark on the dataviz scale, NEVER --primary. Zero-count segments are
  dropped (no zero-width slivers). If the total is 0 (or all null), the bar
  renders an empty neutral track, "no data", not a fabricated split.

  a11y: role=img with an aria-label spelling out each non-zero share; an
  optional inline legend (glyph-less swatches) is rendered when `legend`.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { OccupancyCode, StatusCode } from '$lib/v1/schemas';
	import { occupancyVar, statusVar } from './tokens';
	import ChartTooltip from './ChartTooltip.svelte';
	import { createChartTooltip } from './useChartTooltip.svelte';

	type AnyCode = StatusCode | OccupancyCode;

	export interface StackedSegment {
		/** A StatusCode (scale='status') or OccupancyCode (scale='occupancy'). */
		code: AnyCode;
		/** Raw count / weight. `null` is treated as 0 for this segment. */
		value: number | null;
		/** Human label for legend + a11y (resolve upstream; falls back to code). */
		label?: string;
	}

	export interface StackedBarProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** Which dataviz scale the codes belong to. */
		scale: 'status' | 'occupancy';
		/** The segments. Order is preserved left→right. */
		segments: StackedSegment[];
		/**
		 * Bar thickness. 'md' is the default proportion strip; 'sm' is a slimmer
		 * variant for dense cluster bands. Maps to a fixed pixel height internally.
		 */
		size?: 'sm' | 'md';
		/** Render an inline legend below the bar. */
		legend?: boolean;
		/** Accessible label prefix (e.g. "Route 51 status mix"). */
		label?: string;
		/**
		 * Opt into hover/focus tooltips: each slice becomes a focusable target
		 * that reveals its label + share. Default off, the bar stays a static
		 * figure with its <title>-only readout.
		 */
		interactive?: boolean;
		/** Optional drilldown/selection callback for interactive slices. */
		onSelect?: (code: AnyCode) => void;
		class?: string;
	}

	let {
		scale,
		segments,
		size = 'md',
		legend = false,
		label,
		interactive = false,
		onSelect,
		class: className,
		ref = $bindable(null),
		...restProps
	}: StackedBarProps = $props();

	// Thickness map (px / viewBox units). Kept off the token layer, a 2-value
	// internal proportion-strip scale, not a shared design token.
	const BAR_HEIGHT = { sm: 8, md: 10 } as const;
	const height = $derived(BAR_HEIGHT[size]);

	const tip = createChartTooltip();

	// Show the tooltip for slice `s` (anchored at its horizontal midpoint).
	function showSlice(s: Slice): void {
		tip.show({
			xPct: s.offset + s.pct / 2,
			yPct: 0,
			side: 'top',
			heading: s.label,
			rows: [{ colorVar: s.color, label: s.label, value: `${Math.round(s.pct)}%` }],
		});
	}

	function onKeyDown(e: KeyboardEvent, s: Slice): void {
		if (e.key === 'Escape') {
			tip.hide();
			return;
		}
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect?.(s.code);
		}
	}

	function colorFor(code: AnyCode): string {
		return scale === 'status' ? statusVar(code as StatusCode) : occupancyVar(code as OccupancyCode);
	}

	type Slice = { code: AnyCode; color: string; label: string; pct: number; offset: number };

	const total = $derived(
		segments.reduce(
			(s, seg) => s + (seg.value != null && !Number.isNaN(seg.value) ? Math.max(0, seg.value) : 0),
			0,
		),
	);

	const slices = $derived.by<Slice[]>(() => {
		if (total <= 0) return [];
		let offset = 0;
		const out: Slice[] = [];
		for (const seg of segments) {
			const v = seg.value != null && !Number.isNaN(seg.value) ? Math.max(0, seg.value) : 0;
			if (v <= 0) continue;
			const pct = (v / total) * 100;
			out.push({
				code: seg.code,
				color: colorFor(seg.code),
				label: seg.label ?? seg.code,
				pct,
				offset,
			});
			offset += pct;
		}
		return out;
	});

	const hasData = $derived(slices.length > 0);
	const summary = $derived(
		hasData
			? `${label ? label + ', ' : ''}${slices.map((s) => `${s.label} ${Math.round(s.pct)}%`).join(', ')}`
			: `${label ? label + ', ' : ''}no data`,
	);
</script>

{#snippet bar()}
	<!-- When interactive, the focusable slices below ARE the accessible content
	     (each is a labelled, focusable role=img), so the SVG must NOT be hidden —
	     an aria-hidden ancestor would make every focus stop silent to AT. When
	     static, the outer role=img + summary carries the meaning and the SVG is
	     hidden as pure decoration. -->
	<!-- Explicit CSS height pins the rendered strip to `height` px. Without it a
	     global `svg { height: auto }` makes the bar width-PROPORTIONAL (≈width×h/100),
	     so the `size` prop only changed the aspect ratio of a still-chunky bar
	     instead of actually thinning it. preserveAspectRatio:none then stretches the
	     viewBox to the exact strip height. -->
	<svg
		viewBox="0 0 100 {height}"
		width="100%"
		{height}
		style="display: block; height: {height}px;"
		preserveAspectRatio="none"
		aria-hidden={!interactive}
		focusable="false"
	>
		{#if hasData}
			{#each slices as s, i (s.code + '-' + i)}
				{#if interactive}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<rect
						x={s.offset}
						y={0}
						width={Math.max(0, s.pct)}
						{height}
						fill={s.color}
						tabindex={0}
						role="img"
						aria-label={`${s.label}: ${Math.round(s.pct)}%`}
						aria-describedby={tip.id}
						onpointerenter={() => showSlice(s)}
						onpointerleave={() => tip.hide()}
						onfocus={() => showSlice(s)}
						onblur={() => tip.hide()}
						onclick={() => onSelect?.(s.code)}
						onkeydown={(e) => onKeyDown(e, s)}
					>
						<title>{s.label}: {Math.round(s.pct)}%</title>
					</rect>
				{:else}
					<rect x={s.offset} y={0} width={Math.max(0, s.pct)} {height} fill={s.color}>
						<title>{s.label}: {Math.round(s.pct)}%</title>
					</rect>
				{/if}
			{/each}
		{:else}
			<rect x={0} y={0} width={100} {height} fill="var(--muted)" />
		{/if}
	</svg>
{/snippet}

<!-- role: a flat `img` when static (one announcement of `summary`); a labelled
     `group` when interactive, so AT descends into the per-slice focus stops (a
     role=img would flatten them away). aria-label carries the summary either way. -->
<div
	bind:this={ref}
	class={cn('dv-stacked-bar', className)}
	role={interactive ? 'group' : 'img'}
	aria-label={summary}
	data-slot="stacked-bar"
	data-scale={scale}
	{...restProps}
>
	{#if interactive}
		<ChartTooltip {...tip} id={tip.id}>
			{@render bar()}
		</ChartTooltip>
	{:else}
		{@render bar()}
	{/if}

	{#if legend && hasData}
		<ul
			class="dv-legend-list mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground"
		>
			{#each slices as s, i (s.code + '-leg-' + i)}
				<li class="inline-flex items-center gap-1.5">
					<span
						class="inline-block size-2 rounded-sm"
						style="background: {s.color};"
						aria-hidden="true"
					></span>
					<span class="text-foreground">{s.label}</span>
					<span class="font-mono tabular-nums text-foreground">{Math.round(s.pct)}%</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.rounded-sm {
		border-radius: var(--radius-sm);
	}

	/* Focus ring for keyboard-reachable slices (interactive only). Uses --ring
	   (= --primary), that is an interactive affordance, not a data mark. */
	rect:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
</style>

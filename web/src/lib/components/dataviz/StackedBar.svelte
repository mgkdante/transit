<!--
  StackedBar — a 100%-stacked horizontal proportion bar (SVG, no chart lib).

  Two flavours via `scale`:
    - 'status'    : segments keyed by StatusCode (status distribution).
    - 'occupancy' : segments keyed by OccupancyCode (occupancy mix).

  Each segment's colour comes from the matching dataviz scale
  (--dataviz-status-* / --dataviz-occupancy-*). DOCTRINE: every segment is a
  data mark on the dataviz scale, NEVER --primary. Zero-count segments are
  dropped (no zero-width slivers). If the total is 0 (or all null), the bar
  renders an empty neutral track — "no data", not a fabricated split.

  a11y: role=img with an aria-label spelling out each non-zero share; an
  optional inline legend (glyph-less swatches) is rendered when `legend`.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { OccupancyCode, StatusCode } from '$lib/v1/schemas';
	import { occupancyVar, statusVar } from './tokens';

	type AnyCode = StatusCode | OccupancyCode;

	export interface StackedSegment {
		/** A StatusCode (scale='status') or OccupancyCode (scale='occupancy'). */
		code: AnyCode;
		/** Raw count / weight. `null` is treated as 0 for this segment. */
		value: number | null;
		/** Human label for legend + a11y (resolve upstream; falls back to code). */
		label?: string;
	}

	export interface StackedBarProps
		extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** Which dataviz scale the codes belong to. */
		scale: 'status' | 'occupancy';
		/** The segments. Order is preserved left→right. */
		segments: StackedSegment[];
		/** Bar height (viewBox units). */
		height?: number;
		/** Render an inline legend below the bar. */
		legend?: boolean;
		/** Accessible label prefix (e.g. "Route 51 status mix"). */
		label?: string;
		class?: string;
	}

	let {
		scale,
		segments,
		height = 14,
		legend = false,
		label,
		class: className,
		ref = $bindable(null),
		...restProps
	}: StackedBarProps = $props();

	function colorFor(code: AnyCode): string {
		return scale === 'status'
			? statusVar(code as StatusCode)
			: occupancyVar(code as OccupancyCode);
	}

	type Slice = { code: AnyCode; color: string; label: string; pct: number; offset: number };

	const total = $derived(
		segments.reduce((s, seg) => s + (seg.value != null && !Number.isNaN(seg.value) ? Math.max(0, seg.value) : 0), 0),
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
			? `${label ? label + ' — ' : ''}${slices.map((s) => `${s.label} ${Math.round(s.pct)}%`).join(', ')}`
			: `${label ? label + ' — ' : ''}no data`,
	);
</script>

<div
	bind:this={ref}
	class={cn('dv-stacked-bar', className)}
	role="img"
	aria-label={summary}
	data-slot="stacked-bar"
	data-scale={scale}
	{...restProps}
>
	<svg viewBox="0 0 100 {height}" width="100%" {height} preserveAspectRatio="none" aria-hidden="true" focusable="false">
		{#if hasData}
			{#each slices as s, i (s.code + '-' + i)}
				<rect x={s.offset} y={0} width={Math.max(0, s.pct)} height={height} fill={s.color}>
					<title>{s.label}: {Math.round(s.pct)}%</title>
				</rect>
			{/each}
		{:else}
			<rect x={0} y={0} width={100} height={height} fill="var(--muted)" />
		{/if}
	</svg>

	{#if legend && hasData}
		<ul class="dv-legend-list mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-micro text-muted-foreground">
			{#each slices as s, i (s.code + '-leg-' + i)}
				<li class="inline-flex items-center gap-1.5">
					<span class="inline-block size-2 rounded-sm" style="background: {s.color};" aria-hidden="true"></span>
					<span class="text-foreground">{s.label}</span>
					<span class="font-mono">{Math.round(s.pct)}%</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.rounded-sm {
		border-radius: var(--radius-sm);
	}
</style>

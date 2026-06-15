<!--
  Sparkline — a tiny single-series trend line (SVG, no chart lib).

  Lightweight inline trend for a sequence of numbers (e.g. a route's OTP over
  the last N days). `null` points are GAPS — the path breaks rather than
  interpolating a fake value (honesty rule: never invent data).

  DOCTRINE: the line is a data mark. Its colour comes from the dataviz scale —
  default is the on-time green token; callers may pass any dataviz token via
  `colorVar`. NEVER --primary. An optional last-point dot reuses the same token.
  a11y: img role + aria-label summarising the series; decorative svg internals
  are aria-hidden.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface SparklineProps
		extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** The series. `null` entries render as gaps (no interpolation). */
		values: Array<number | null>;
		/** Drawn width in px (viewBox units). */
		width?: number;
		/** Drawn height in px (viewBox units). */
		height?: number;
		/** Stroke width in viewBox units. */
		stroke?: number;
		/**
		 * A dataviz token reference for the line colour (DATA). Default = on-time
		 * green. Pass e.g. `var(--dataviz-status-late)`. NEVER --primary.
		 */
		colorVar?: string;
		/** Draw a dot at the last real point. */
		showLast?: boolean;
		/** Accessible summary of the series (e.g. "On-time % last 14 days"). */
		label?: string;
		class?: string;
	}

	let {
		values,
		width = 96,
		height = 24,
		stroke = 1.5,
		colorVar = 'var(--dataviz-status-on-time)',
		showLast = true,
		label,
		class: className,
		ref = $bindable(null),
		...restProps
	}: SparklineProps = $props();

	const PAD = $derived(stroke + 0.5);

	type Pt = { x: number; y: number };

	// Compute scaled points (null -> gap). Domain spans only the real values.
	const points = $derived.by<Array<Pt | null>>(() => {
		const reals = values.filter((v): v is number => v != null && !Number.isNaN(v));
		if (reals.length === 0) return values.map(() => null);
		const min = Math.min(...reals);
		const max = Math.max(...reals);
		const span = max - min || 1;
		const n = values.length;
		const innerW = width - PAD * 2;
		const innerH = height - PAD * 2;
		return values.map((v, i) => {
			if (v == null || Number.isNaN(v)) return null;
			const x = n === 1 ? width / 2 : PAD + (i / (n - 1)) * innerW;
			const y = PAD + (1 - (v - min) / span) * innerH;
			return { x, y };
		});
	});

	// Build one or more <path> segments, breaking across null gaps.
	const segments = $derived.by<string[]>(() => {
		const segs: string[] = [];
		let cur: Pt[] = [];
		for (const p of points) {
			if (p == null) {
				if (cur.length) segs.push(cur.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' '));
				cur = [];
			} else {
				cur.push(p);
			}
		}
		if (cur.length) segs.push(cur.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' '));
		return segs;
	});

	const lastPoint = $derived.by<Pt | null>(() => {
		for (let i = points.length - 1; i >= 0; i--) {
			const p = points[i];
			if (p) return p;
		}
		return null;
	});

	const hasData = $derived(segments.length > 0);
</script>

<div
	bind:this={ref}
	class={cn('dv-sparkline inline-block', className)}
	role="img"
	aria-label={label ?? 'Sparkline'}
	data-slot="sparkline"
	{...restProps}
>
	<svg
		viewBox="0 0 {width} {height}"
		width={width}
		height={height}
		preserveAspectRatio="none"
		aria-hidden="true"
		focusable="false"
	>
		{#if hasData}
			{#each segments as d, i (i)}
				<path
					{d}
					fill="none"
					stroke={colorVar}
					stroke-width={stroke}
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/each}
			{#if showLast && lastPoint}
				<circle cx={lastPoint.x} cy={lastPoint.y} r={stroke + 0.5} fill={colorVar} />
			{/if}
		{:else}
			<!-- No real points: a faint baseline, NOT a fabricated zero line. -->
			<line
				x1={PAD}
				y1={height / 2}
				x2={width - PAD}
				y2={height / 2}
				stroke="var(--border)"
				stroke-width={stroke}
				stroke-dasharray="2 3"
			/>
		{/if}
	</svg>
</div>

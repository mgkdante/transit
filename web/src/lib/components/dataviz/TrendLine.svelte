<!--
  TrendLine — dual-series trend chart (SVG, no chart lib).

  Renders two series over a shared x-domain: on-time % (green) and a delay /
  "retard" series (amber). Both colours come from the dataviz scale —
  --dataviz-status-on-time (green) and --dataviz-status-late (amber). `null`
  points break the line (gaps, never interpolated).

  DOCTRINE: every line + dot is a data mark on the dataviz scale, NEVER
  --primary. Grid/baseline are neutral (--border). a11y: figure with an
  aria-label summary and a visually-hidden legend; decorative geometry is
  aria-hidden.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	type Series = Array<number | null>;

	export interface TrendLineProps
		extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** On-time % series (rendered green). */
		onTime: Series;
		/** Delay / retard series (rendered amber). */
		retard: Series;
		/**
		 * Shared y-domain [min,max]. Both series are typically percentages, so the
		 * default is [0,100]. Pass a custom domain when units differ.
		 */
		domain?: [number, number];
		/** Drawn width (viewBox units). */
		width?: number;
		/** Drawn height (viewBox units). */
		height?: number;
		/** Stroke width (viewBox units). */
		stroke?: number;
		/** Accessible legend labels (already localized upstream). */
		onTimeLabel?: string;
		retardLabel?: string;
		/** Overall accessible summary. */
		label?: string;
		class?: string;
	}

	let {
		onTime,
		retard,
		domain = [0, 100],
		width = 320,
		height = 120,
		stroke = 2,
		onTimeLabel = 'On-time %',
		retardLabel = 'Delayed %',
		label,
		class: className,
		ref = $bindable(null),
		...restProps
	}: TrendLineProps = $props();

	const PAD = 6;
	const ON_TIME_VAR = 'var(--dataviz-status-on-time)';
	const RETARD_VAR = 'var(--dataviz-status-late)';

	type Pt = { x: number; y: number };

	function scale(series: Series): Array<Pt | null> {
		const [min, max] = domain;
		const span = max - min || 1;
		const n = Math.max(series.length, 1);
		const innerW = width - PAD * 2;
		const innerH = height - PAD * 2;
		return series.map((v, i) => {
			if (v == null || Number.isNaN(v)) return null;
			const x = n === 1 ? width / 2 : PAD + (i / (n - 1)) * innerW;
			const clamped = Math.min(max, Math.max(min, v));
			const y = PAD + (1 - (clamped - min) / span) * innerH;
			return { x, y };
		});
	}

	function toSegments(pts: Array<Pt | null>): string[] {
		const segs: string[] = [];
		let cur: Pt[] = [];
		for (const p of pts) {
			if (p == null) {
				if (cur.length) segs.push(cur.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' '));
				cur = [];
			} else cur.push(p);
		}
		if (cur.length) segs.push(cur.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' '));
		return segs;
	}

	function lastOf(pts: Array<Pt | null>): Pt | null {
		for (let i = pts.length - 1; i >= 0; i--) if (pts[i]) return pts[i];
		return null;
	}

	const onTimePts = $derived(scale(onTime));
	const retardPts = $derived(scale(retard));
	const onTimeSegs = $derived(toSegments(onTimePts));
	const retardSegs = $derived(toSegments(retardPts));
	const onTimeLast = $derived(lastOf(onTimePts));
	const retardLast = $derived(lastOf(retardPts));

	// Midline gridline for orientation (neutral, not a data mark).
	const midY = $derived(PAD + (height - PAD * 2) / 2);
	const summary = $derived(label ?? `${onTimeLabel} vs ${retardLabel}`);
</script>

<figure
	bind:this={ref}
	class={cn('dv-trendline m-0', className)}
	aria-label={summary}
	data-slot="trend-line"
	{...restProps}
>
	<svg
		viewBox="0 0 {width} {height}"
		width="100%"
		height={height}
		preserveAspectRatio="none"
		role="img"
		aria-hidden="true"
		focusable="false"
	>
		<!-- Neutral orientation grid (NOT data). -->
		<line x1={PAD} y1={midY} x2={width - PAD} y2={midY} stroke="var(--border)" stroke-width="0.75" stroke-dasharray="3 4" />

		<!-- Retard (amber) under on-time so green reads as the headline. -->
		{#each retardSegs as d, i (i)}
			<path {d} fill="none" stroke={RETARD_VAR} stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" opacity="0.95" />
		{/each}
		{#if retardLast}
			<circle cx={retardLast.x} cy={retardLast.y} r={stroke + 0.5} fill={RETARD_VAR} />
		{/if}

		{#each onTimeSegs as d, i (i)}
			<path {d} fill="none" stroke={ON_TIME_VAR} stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" />
		{/each}
		{#if onTimeLast}
			<circle cx={onTimeLast.x} cy={onTimeLast.y} r={stroke + 0.5} fill={ON_TIME_VAR} />
		{/if}
	</svg>

	<figcaption class="mt-1.5 flex items-center gap-3 text-micro text-muted-foreground">
		<span class="inline-flex items-center gap-1.5">
			<span class="dv-swatch inline-block size-2 rounded-full" style="background: {ON_TIME_VAR};" aria-hidden="true"></span>
			<span>{onTimeLabel}</span>
		</span>
		<span class="inline-flex items-center gap-1.5">
			<span class="dv-swatch inline-block size-2 rounded-full" style="background: {RETARD_VAR};" aria-hidden="true"></span>
			<span>{retardLabel}</span>
		</span>
	</figcaption>
</figure>

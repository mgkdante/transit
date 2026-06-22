<!--
  DivergingBar — a signed value bar from a zero center (slice-S3, Chart Doctrine).

  For "deviation from a baseline" (current − normal) or any two-direction datum:
  the bar grows LEFT for negative, RIGHT for positive, from an explicit, labelled
  zero rule. Direction is carried by position (left/right) + a glyph (▲/▼) + aria —
  never colour alone — and both hues ride the DATAVIZ scale (never --primary). The
  zero baseline is a structural rule, not a data mark.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface DivergingBarProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** Signed value. null/NaN → nothing drawn (honest absence). */
		value: number | null;
		/** Symmetric-ish domain [min, max] spanning 0; defaults to ±max(|value|,1). */
		domain?: [number, number];
		/** Formatted value text for aria (e.g. "+1.8 min"). Falls back to the number. */
		display?: string;
		/** Fill for value > 0 — a `var(--dataviz-*)` token. Default the "more" amber. */
		posColorVar?: string;
		/** Fill for value < 0 — a `var(--dataviz-*)` token. Default the "better" green. */
		negColorVar?: string;
		/** Accessible label (already localized). */
		label?: string;
		width?: number;
		height?: number;
		class?: string;
	}

	let {
		value,
		domain,
		display,
		posColorVar = 'var(--dataviz-status-late)',
		negColorVar = 'var(--dataviz-status-on-time)',
		label,
		width = 200,
		height = 16,
		class: className,
		ref = $bindable(null),
		...restProps
	}: DivergingBarProps = $props();

	const has = $derived(value != null && !Number.isNaN(value));
	const PAD = 2;
	const innerW = $derived(width - PAD * 2);
	const m = $derived(
		domain ? Math.max(Math.abs(domain[0]), Math.abs(domain[1])) : Math.max(Math.abs(value ?? 0), 1),
	);
	const scaleX = (v: number): number =>
		PAD + ((Math.min(m, Math.max(-m, v)) + m) / (2 * m)) * innerW;
	const zeroX = $derived(scaleX(0));
	const valX = $derived(has ? scaleX(value!) : zeroX);
	const barX = $derived(Math.min(zeroX, valX));
	const barW = $derived(Math.abs(valX - zeroX));
	const fill = $derived((value ?? 0) >= 0 ? posColorVar : negColorVar);
	const glyph = $derived(!has || value === 0 ? '·' : value! > 0 ? '▲' : '▼');
	const text = $derived(!has ? '' : (display ?? (value! > 0 ? `+${value}` : `${value}`)));
	const ariaLabel = $derived(
		!has ? `${label ?? 'value'}: no data` : `${label ? `${label}: ` : ''}${text}`,
	);
</script>

<figure
	bind:this={ref}
	class={cn('dv-diverging-bar m-0 flex items-center gap-1.5', className)}
	data-slot="diverging-bar"
	{...restProps}
>
	<svg
		viewBox="0 0 {width} {height}"
		width="100%"
		{height}
		preserveAspectRatio="none"
		role="img"
		aria-label={ariaLabel}
	>
		<!-- Explicit zero baseline (structural rule, not a data mark). -->
		<line
			x1={zeroX}
			y1="0"
			x2={zeroX}
			y2={height}
			stroke="var(--border-strong, var(--border))"
			stroke-width="1"
		/>
		{#if has && barW > 0}
			<rect x={barX} y={height * 0.25} width={barW} height={height * 0.5} {fill} />
		{/if}
	</svg>
	<!-- Direction glyph (never colour-only) — coloured to match the bar. -->
	<span class="dv-diverging-glyph font-mono text-caption" style="color: {fill};" aria-hidden="true"
		>{glyph}</span
	>
</figure>

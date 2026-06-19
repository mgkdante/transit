<!--
  ChartReadout — a FIXED, in-flow readout for chart hover/focus values.

  The counterpart to ChartTooltip for the LINE/AREA charts (TrendLine /
  Sparkline) where a floating overlay would sit on top of the plotted lines and
  cover the very data the reader is inspecting. Instead of an absolutely-
  positioned box at (xPct,yPct), this renders a STATIC block in normal flow —
  placed ABOVE the plot by the consumer — that updates on hover/focus with the
  hovered x heading + each series value (unit-suffixed upstream).

  Driven by the SAME `createChartTooltip()` controller as ChartTooltip: spread
  `open / heading / rows / id` onto it. No new state machinery — the chart's
  existing `show()`/`hide()` calls flow straight through. The only thing that
  changes vs the tooltip is the RENDER TARGET (fixed row, never over the line).

  a11y: role="status" + aria-live="polite" so AT announces the hovered values as
  they change; the consumer points the focus targets' aria-describedby at this
  block via `id`. It reserves vertical space even when closed (renders the
  `placeholder`) so the layout never jumps as the reader hovers in/out.

  Doctrine: surface tokens only (--popover / --border / --muted-foreground); NO
  --primary (it is chrome, not an interactive affordance). Row swatches reuse the
  row's own dataviz `colorVar`. The fade is gated on !prefersReducedMotion.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import { prefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import type { ChartTooltipRow } from './useChartTooltip.svelte';

	export interface ChartReadoutProps extends HTMLAttributes<HTMLDivElement> {
		/** Whether a point is currently hovered/focused (drives placeholder vs rows). */
		open: boolean;
		/** The hovered x heading (category / date). */
		heading?: string;
		/** The per-series rows (swatch + label + value), already localized + unit-suffixed. */
		rows: ChartTooltipRow[];
		/** Stable DOM id (from the controller) so focus targets can aria-describedby it. */
		id: string;
		/** Hint shown when nothing is hovered (e.g. "Hover or tab the chart to read each day"). */
		placeholder?: string;
		class?: string;
	}

	let {
		open,
		heading,
		rows,
		id,
		placeholder,
		class: className,
		...rest
	}: ChartReadoutProps = $props();

	const animate = $derived(!prefersReducedMotion.current);
	const hasContent = $derived(open && rows.length > 0);
</script>

<div
	{id}
	role="status"
	aria-live="polite"
	class={cn('chart-readout', className)}
	class:chart-readout--animate={animate}
	data-slot="chart-readout"
	{...rest}
>
	{#if hasContent}
		{#if heading}
			<span class="chart-readout__heading">{heading}</span>
		{/if}
		<ul class="chart-readout__rows">
			{#each rows as row, i (row.label + '-' + i)}
				<li class="chart-readout__row">
					{#if row.colorVar}
						<span
							class="chart-readout__swatch"
							style="background: {row.colorVar};"
							aria-hidden="true"
						></span>
					{/if}
					<span class="chart-readout__label">{row.label}</span>
					<span class="chart-readout__value">{row.value}</span>
				</li>
			{/each}
		</ul>
	{:else if placeholder}
		<span class="chart-readout__placeholder">{placeholder}</span>
	{/if}
</div>

<style>
	/* In-flow fixed readout: reserves a steady row so the layout never jumps when
	   the reader hovers in/out. Surface chrome (NOT a data mark): --popover panel,
	   neutral border, muted text — never an affordance token. */
	.chart-readout {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 12px;
		min-height: 1.75rem;
		padding: 4px 8px;
		background: var(--popover);
		color: var(--popover-foreground);
		border: 1px solid var(--border-strong, var(--border));
		border-radius: var(--radius-sm);
	}

	.chart-readout--animate {
		transition: background-color 80ms ease-out;
	}

	.chart-readout__heading {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}

	.chart-readout__placeholder {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}

	.chart-readout__rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
	}

	.chart-readout__row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.chart-readout__swatch {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: var(--radius-sm);
	}

	.chart-readout__label {
		font-size: var(--text-caption);
		color: var(--foreground);
	}

	.chart-readout__value {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-caption);
		color: var(--foreground);
	}
</style>

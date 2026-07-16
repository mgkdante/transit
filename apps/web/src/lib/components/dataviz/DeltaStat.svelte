<!--
  DeltaStat — a period-over-period change chip (slice-S3).

  The Chart Doctrine delta doctrine, made a primitive (was inlined in RankedRow):
  a direction GLYPH (▲ up / ▼ down / · flat) + the change text, coloured on the
  DATAVIZ scale by whether the move is an IMPROVEMENT — never colour alone (glyph
  + aria carry it too), never --primary/--success/--destructive as a data fill.

    improvement → --dataviz-status-on-time   (green)
    regression  → --dataviz-severity-critical (red)
    flat / no-data → --dataviz-status-unknown (neutral)

  HONESTY: a null/NaN delta is "no change data" — a neutral · with an explicit
  aria-label, never a fabricated 0 or a coloured arrow. `higherIsBetter` flips the
  verdict (a rise in on-time% is good; a rise in delay is bad).
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface DeltaStatProps extends WithElementRef<HTMLAttributes<HTMLSpanElement>> {
		/** Signed change vs the prior period. `null`/NaN = no comparison (neutral ·). */
		delta: number | null;
		/** Formatted change text (e.g. "+2.1 pts"). Falls back to the signed number. */
		display?: string;
		/**
		 * Whether a RISE is the good direction. Default false — for delay/severity a
		 * rising value is bad; pass true for on-time %, coverage, etc.
		 */
		higherIsBetter?: boolean;
		/** Optional trailing context, already localized (e.g. "vs last week"). */
		context?: string;
		/** a11y noun woven into the label (e.g. "on-time") so the change reads in full. */
		ariaNoun?: string;
		class?: string;
	}

	let {
		delta,
		display,
		higherIsBetter = false,
		context,
		ariaNoun,
		class: className,
		ref = $bindable(null),
		...restProps
	}: DeltaStatProps = $props();

	const hasDelta = $derived(delta != null && !Number.isNaN(delta));
	// Direction glyph — never colour-only.
	const glyph = $derived(!hasDelta ? '·' : delta! > 0 ? '▲' : delta! < 0 ? '▼' : '·');
	// Dataviz-scale colour by improvement (flat / no-data = neutral unknown).
	const colorVar = $derived.by(() => {
		if (!hasDelta || delta === 0) return 'var(--dataviz-status-unknown)';
		const improvement = higherIsBetter ? delta! > 0 : delta! < 0;
		return improvement ? 'var(--dataviz-status-on-time)' : 'var(--dataviz-severity-critical)';
	});
	const text = $derived(!hasDelta ? '' : (display ?? (delta! > 0 ? `+${delta}` : `${delta}`)));
	// When there is no delta, a `context` carries the REASON (e.g. "within noise" / "no prior
	// week") — fold it (+ noun) into the accessible name so assistive tech hears the localized
	// distinction, never the bare, misleading "no change data" (which falsely reads as absent a
	// real-but-insignificant change). No context → the plain no-data fallback (back-compat).
	const ariaLabel = $derived(
		!hasDelta
			? context
				? `${ariaNoun ? `${ariaNoun} ` : ''}${context}`
				: 'no change data'
			: `change ${text}${ariaNoun ? ` ${ariaNoun}` : ''}${context ? ` ${context}` : ''}`,
	);
</script>

<span
	bind:this={ref}
	class={cn(
		'dv-delta-stat inline-flex items-center gap-1 font-mono text-caption tabular-nums',
		className,
	)}
	style="color: {colorVar};"
	data-slot="delta-stat"
	role="img"
	aria-label={ariaLabel}
	{...restProps}
>
	<span aria-hidden="true">{glyph}</span>
	{#if hasDelta}<span aria-hidden="true">{text}</span>{/if}
	{#if context}<span aria-hidden="true" class="dv-delta-context text-muted-foreground"
			>{context}</span
		>{/if}
</span>

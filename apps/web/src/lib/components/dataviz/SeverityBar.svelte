<!--
  SeverityBar — a horizontal magnitude bar coloured by severity band.

  Encodes a normalized value [0,1] as bar length AND a SeverityCode as the bar
  colour. DOCTRINE: the fill is a data mark, so it draws from the dataviz
  severity scale only (var(--dataviz-severity-{critical|high|watch})) — never
  --primary/--destructive. The track is a neutral surface (muted), not a data
  colour. a11y: progressbar role with aria-valuenow + a severity label so the
  band is announced, not inferred from colour alone.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { SeverityCode } from '$lib/v1/schemas';
	import { severityVar } from './tokens';
	import ChartTooltip from './ChartTooltip.svelte';
	import { createChartTooltip } from './useChartTooltip.svelte';

	export interface SeverityBarProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** Severity band — drives the fill colour AND the announced a11y band. */
		severity: SeverityCode;
		/**
		 * Magnitude. WITHOUT `domain`: a normalized fraction in [0,1] (legacy path).
		 * WITH `domain`: the ABSOLUTE value in real units (e.g. 12 for 12%, 1.8 for
		 * 1.8 min) — the bar length is then `(value - min) / (max - min)`, a STABLE
		 * encoding identical across routes/grains/refreshes. `null` -> empty track.
		 */
		value: number | null;
		/**
		 * Fixed absolute [min,max] domain in real units. When set, `value` is absolute
		 * and the bar scales against THIS domain — never the in-view max. Pass a literal
		 * (e.g. SEVERE_DOMAIN); out-of-range values clamp. This is the relative-to-max fix.
		 */
		domain?: readonly [number, number];
		/** Unit appended to the absolute value in the hover readout (e.g. ' min', '%'). */
		unit?: string;
		/**
		 * Optional fill-colour override (a `var(--dataviz-*)` token). Use ONLY for a
		 * calm, honest encoding where the problem-severity scale would misframe the
		 * data — e.g. the live-bus roster colours early/on-time on the calm
		 * `--dataviz-status-*` scale rather than RED/amber. When omitted the fill
		 * defaults to the severity scale (the worst-offenders doctrine). The `label`
		 * carries the human band for screen readers, so colour is never the sole
		 * channel either way.
		 */
		colorVar?: string;
		/** Accessible label for the measured quantity (e.g. route name + metric). */
		label?: string;
		/** Bar thickness. */
		size?: 'sm' | 'md';
		/**
		 * Opt-in hover/focus interactivity: the track becomes a focus target and
		 * reveals a one-row <ChartTooltip>. Default off so existing call sites stay
		 * byte-identical. Pass `false` from RankedRow to avoid double tooltips.
		 */
		interactive?: boolean;
		class?: string;
	}

	let {
		severity,
		value,
		domain,
		unit,
		colorVar,
		label,
		size = 'md',
		interactive = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: SeverityBarProps = $props();

	const hasData = $derived(value != null && !Number.isNaN(value));
	// Bar length: from the FIXED absolute domain when given (stable across views),
	// else the legacy [0,1] fraction. Clamped to [0,100]% either way.
	const pct = $derived.by(() => {
		if (value == null || Number.isNaN(value)) return 0;
		if (domain) {
			const [lo, hi] = domain;
			return Math.min(100, Math.max(0, ((value - lo) / (hi - lo)) * 100));
		}
		return Math.min(1, Math.max(0, value)) * 100;
	});
	// Readout: the ABSOLUTE value (+unit) when domain-scaled, else the fill %.
	const readout = $derived(
		!hasData
			? 'no data'
			: domain
				? `${Math.round((value as number) * 10) / 10}${unit ?? ''}`
				: `${Math.round(pct)}%`,
	);
	const color = $derived(colorVar ?? severityVar(severity));
	const heightClass = { sm: 'h-1.5', md: 'h-2.5' } as const;

	// Interactive tooltip controller (only wired when `interactive`).
	const tip = createChartTooltip();

	function showTip() {
		if (!interactive) return;
		tip.show({
			xPct: 50,
			yPct: 0,
			heading: severity,
			rows: [
				{
					colorVar: color,
					label: label ?? severity,
					value: readout,
				},
			],
			side: 'top',
		});
	}
	function hideTip() {
		tip.hide();
	}
</script>

{#if interactive}
	<ChartTooltip
		open={tip.open}
		xPct={tip.xPct}
		yPct={tip.yPct}
		heading={tip.heading}
		rows={tip.rows}
		side={tip.side}
		id={tip.id}
	>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- progressbar is non-interactive, but the track is a deliberate focus target
		     so keyboard users can reveal the tooltip. -->
		<div
			bind:this={ref}
			class={cn(
				'dv-severity-track w-full overflow-hidden rounded-pill bg-muted',
				heightClass[size],
				className,
			)}
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={hasData ? Math.round(pct) : undefined}
			aria-label={label ? `${label}, ${severity}` : severity}
			aria-describedby={tip.open ? tip.id : undefined}
			tabindex={0}
			onpointerenter={showTip}
			onpointerleave={hideTip}
			onfocus={showTip}
			onblur={hideTip}
			data-slot="severity-bar"
			data-severity={severity}
			{...restProps}
		>
			{#if hasData}
				<div
					class="dv-severity-fill h-full rounded-pill"
					style="width: {pct}%; background: {color};"
				></div>
			{/if}
		</div>
	</ChartTooltip>
{:else}
	<div
		bind:this={ref}
		class={cn(
			'dv-severity-track w-full overflow-hidden rounded-pill bg-muted',
			heightClass[size],
			className,
		)}
		role="progressbar"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={hasData ? Math.round(pct) : undefined}
		aria-label={label ? `${label}, ${severity}` : severity}
		data-slot="severity-bar"
		data-severity={severity}
		{...restProps}
	>
		{#if hasData}
			<div
				class="dv-severity-fill h-full rounded-pill"
				style="width: {pct}%; background: {color};"
			></div>
		{/if}
	</div>
{/if}

<style>
	.rounded-pill {
		border-radius: var(--radius-pill);
	}
	.dv-severity-fill {
		min-width: 2px;
		transition: width 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	@media (prefers-reduced-motion: reduce) {
		.dv-severity-fill {
			transition: none;
		}
	}
</style>

<!--
  Dumbbell — a scheduled-vs-observed headway dumbbell (SVG, no chart lib).

  Two value ticks — the SCHEDULED gap and the OBSERVED gap — sit on a shared
  FIXED headway-minute axis (passed `domain`, e.g. HEADWAY_DOMAIN [0,35]); the
  same literal axis on every route/grain/refresh, never normalized to the data.
  A connecting SPAN between them is the rider-felt EXCESS WAIT (the overrun of
  observed past scheduled). Both ticks ride the dataviz scale (never --primary,
  an interactive-only token): scheduled = the calm "early/plan" blue token,
  observed = the amber "late/real-world" token. Direction is carried by position
  + a per-tick glyph + aria — never colour alone.

  Honest absence: when NEITHER endpoint resolves the whole figure routes through
  AbsentValue (says WHY), never a fabricated 0 / "·" / em-dash. A single present
  endpoint draws just that tick (no fake span). Deterministic, no Date.now /
  Math.random; 8px-grid padding. Reduced-motion safe (static).
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Locale } from '$lib/i18n';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import { AbsentValue } from '$lib/components/edge';
	import ChartTooltip from './ChartTooltip.svelte';
	import { createChartTooltip, type ChartTooltipRow } from './useChartTooltip.svelte';

	export interface DumbbellProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** Scheduled headway (min). null → that tick is omitted (no fake 0). */
		scheduledMin?: number | null;
		/** Observed headway (min). null → that tick is omitted (no fake 0). */
		observedMin?: number | null;
		/** Excess wait (min) — the rider-felt overrun. Annotated; null → omitted. */
		excessMin?: number | null;
		/** Fixed absolute [min,max] headway-minute axis (literal, e.g. HEADWAY_DOMAIN). */
		domain: readonly [number, number];
		/** Endpoint labels (already localized). */
		scheduledLabel: string;
		observedLabel: string;
		/** Excess-wait annotation prefix (already localized), given the formatted value. */
		excessLabel: (value: string) => string;
		/** Whole-figure accessible summary (already localized), given the two formatted values. */
		ariaLabel: (scheduled: string, observed: string) => string;
		/** UI language — drives the absence copy. */
		locale: Locale;
		/** Absence reason for the honest-empty state (the WHY). */
		absentReason?: AbsenceReasonKey;
		/** Short value-level no-data label for an absent single endpoint readout. */
		noDataLabel: string;
		/** Drawn width (viewBox units). */
		width?: number;
		/** Drawn height (viewBox units). */
		height?: number;
		/**
		 * Opt-in hover/focus interactivity: the scheduled tick, the observed tick, and
		 * the connecting span each become a focus/pointer target that reveals a one-row
		 * <ChartTooltip> (the endpoint's min value, or the excess-wait for the span).
		 * Default off so existing call sites stay byte-identical.
		 */
		interactive?: boolean;
		class?: string;
	}

	let {
		scheduledMin = null,
		observedMin = null,
		excessMin = null,
		domain,
		scheduledLabel,
		observedLabel,
		excessLabel,
		ariaLabel,
		locale,
		absentReason = 'no-observations',
		noDataLabel,
		width = 320,
		height = 44,
		interactive = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: DumbbellProps = $props();

	// ── geometry on the FIXED domain (literal, zero-based) — never derived ───────
	const PAD = 8; // 8px grid
	const innerW = $derived(width - PAD * 2);
	const trackY = $derived(height * 0.5);
	const TICK_H = 12; // tick height (viewBox units)
	const DOT_R = 4; // endpoint dot radius
	const HIT_HALF = 10; // half-width of an endpoint focus/pointer hit target (viewBox units)
	const HIT_SPAN_H = 16; // height of the span focus/pointer hit target (viewBox units)

	// Calm dataviz tokens (never --primary): scheduled = the plan/blue, observed =
	// the real-world amber. Glyph + aria carry meaning so colour is never sole.
	const SCHEDULED_VAR = 'var(--dataviz-status-early)';
	const OBSERVED_VAR = 'var(--dataviz-status-late)';
	const SCHEDULED_GLYPH = '◇';
	const OBSERVED_GLYPH = '●';

	const has = (v: number | null | undefined): v is number => v != null && !Number.isNaN(v);

	// x on the FIXED domain (clamped). A minute maps to a stable px on every render.
	function xOf(v: number): number {
		const [lo, hi] = domain;
		const span = hi - lo || 1;
		const clamped = Math.min(hi, Math.max(lo, v));
		return PAD + ((clamped - lo) / span) * innerW;
	}

	const schedX = $derived(has(scheduledMin) ? xOf(scheduledMin) : null);
	const obsX = $derived(has(observedMin) ? xOf(observedMin) : null);
	// The span (excess wait) is honest only when BOTH endpoints resolve.
	const hasSpan = $derived(schedX != null && obsX != null);
	// The figure is absent only when NEITHER endpoint resolves.
	const hasAny = $derived(schedX != null || obsX != null);

	const fmt1 = (v: number | null | undefined): string =>
		has(v) ? `${Math.round(v * 10) / 10}` : noDataLabel;
	const summary = $derived(ariaLabel(fmt1(scheduledMin), fmt1(observedMin)));
	const excessText = $derived(has(excessMin) ? excessLabel(fmt1(excessMin)) : null);

	// ── opt-in hover/focus tooltip (only wired when `interactive`) ───────────────
	const tip = createChartTooltip();

	// Half-track widths (viewBox units → % of the stretched viewBox) so each hit
	// target is wide enough to grab without overlapping its neighbour. The span hit
	// target sits between the two endpoint targets.
	function showSchedTip() {
		if (!interactive || schedX == null) return;
		tip.show({
			xPct: (schedX / width) * 100,
			yPct: 0,
			heading: scheduledLabel,
			rows: [
				{ colorVar: SCHEDULED_VAR, label: scheduledLabel, value: fmt1(scheduledMin) },
			] as ChartTooltipRow[],
			side: 'top',
		});
	}
	function showObsTip() {
		if (!interactive || obsX == null) return;
		tip.show({
			xPct: (obsX / width) * 100,
			yPct: 0,
			heading: observedLabel,
			rows: [
				{ colorVar: OBSERVED_VAR, label: observedLabel, value: fmt1(observedMin) },
			] as ChartTooltipRow[],
			side: 'top',
		});
	}
	function showSpanTip() {
		// The span readout exists only when both endpoints resolve AND the excess is present.
		if (!interactive || !hasSpan || excessText == null) return;
		tip.show({
			xPct: ((Math.min(schedX!, obsX!) + Math.max(schedX!, obsX!)) / 2 / width) * 100,
			yPct: 0,
			heading: excessText,
			rows: [
				{ colorVar: OBSERVED_VAR, label: excessText, value: fmt1(excessMin) },
			] as ChartTooltipRow[],
			side: 'top',
		});
	}
	function hideTip() {
		tip.hide();
	}
</script>

{#snippet svgBody()}
	<!-- The full-domain baseline track (neutral; the unused range reads as absent). -->
	<line x1={PAD} y1={trackY} x2={width - PAD} y2={trackY} stroke="var(--border)" stroke-width="1" />

	<!-- The excess-wait span (scheduled→observed) — a data mark on the amber token. -->
	{#if hasSpan}
		<line
			x1={Math.min(schedX!, obsX!)}
			y1={trackY}
			x2={Math.max(schedX!, obsX!)}
			y2={trackY}
			stroke={OBSERVED_VAR}
			stroke-width="3"
			data-slot="dumbbell-span"
		/>
	{/if}

	<!-- Scheduled tick (the plan) — calm blue, a vertical rule + endpoint dot. -->
	{#if schedX != null}
		<line
			x1={schedX}
			y1={trackY - TICK_H / 2}
			x2={schedX}
			y2={trackY + TICK_H / 2}
			stroke={SCHEDULED_VAR}
			stroke-width="2"
		/>
		<circle cx={schedX} cy={trackY} r={DOT_R} fill={SCHEDULED_VAR} data-end="scheduled" />
	{/if}

	<!-- Observed tick (the real world) — amber, a vertical rule + endpoint dot. -->
	{#if obsX != null}
		<line
			x1={obsX}
			y1={trackY - TICK_H / 2}
			x2={obsX}
			y2={trackY + TICK_H / 2}
			stroke={OBSERVED_VAR}
			stroke-width="2"
		/>
		<circle cx={obsX} cy={trackY} r={DOT_R} fill={OBSERVED_VAR} data-end="observed" />
	{/if}
{/snippet}

{#snippet chart()}
	<svg
		viewBox="0 0 {width} {height}"
		width="100%"
		{height}
		preserveAspectRatio="none"
		role="img"
		aria-label={summary}
		aria-hidden={interactive ? true : undefined}
		focusable="false"
	>
		{@render svgBody()}

		{#if interactive}
			<!-- Transparent focus/pointer hit targets on TOP of the marks: each named
			     mark (scheduled tick, observed tick, span) is its own keyboard-reachable
			     target carrying a full aria-label, so colour/position is never the sole
			     channel. An absent mark draws no target (no tooltip on absent data). -->
			{#if schedX != null}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<rect
					x={Math.max(0, schedX - HIT_HALF)}
					y="0"
					width={HIT_HALF * 2}
					{height}
					fill="transparent"
					tabindex={0}
					role="img"
					data-hit="scheduled"
					aria-label={`${scheduledLabel}, ${fmt1(scheduledMin)}`}
					aria-describedby={tip.open ? tip.id : undefined}
					onpointerenter={showSchedTip}
					onpointerleave={hideTip}
					onfocus={showSchedTip}
					onblur={hideTip}
				/>
			{/if}
			{#if hasSpan && excessText != null}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<rect
					x={Math.min(schedX!, obsX!)}
					y={trackY - HIT_SPAN_H / 2}
					width={Math.max(1, Math.abs(obsX! - schedX!))}
					height={HIT_SPAN_H}
					fill="transparent"
					tabindex={0}
					role="img"
					data-hit="span"
					aria-label={`${excessText}, ${fmt1(excessMin)}`}
					aria-describedby={tip.open ? tip.id : undefined}
					onpointerenter={showSpanTip}
					onpointerleave={hideTip}
					onfocus={showSpanTip}
					onblur={hideTip}
				/>
			{/if}
			{#if obsX != null}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<rect
					x={Math.max(0, obsX - HIT_HALF)}
					y="0"
					width={HIT_HALF * 2}
					{height}
					fill="transparent"
					tabindex={0}
					role="img"
					data-hit="observed"
					aria-label={`${observedLabel}, ${fmt1(observedMin)}`}
					aria-describedby={tip.open ? tip.id : undefined}
					onpointerenter={showObsTip}
					onpointerleave={hideTip}
					onfocus={showObsTip}
					onblur={hideTip}
				/>
			{/if}
		{/if}
	</svg>
{/snippet}

{#if hasAny}
	<figure
		bind:this={ref}
		class={cn('dv-dumbbell m-0', className)}
		data-slot="dumbbell"
		{...restProps}
	>
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
				{@render chart()}
			</ChartTooltip>
		{:else}
			{@render chart()}
		{/if}

		<!-- Endpoint legend: glyph + colour + value, so the two ticks are never colour-only. -->
		<figcaption class="dv-dumbbell-legend">
			<span class="dv-dumbbell-end" data-end="scheduled">
				<span class="dv-dumbbell-glyph" style="color: {SCHEDULED_VAR};" aria-hidden="true"
					>{SCHEDULED_GLYPH}</span
				>
				<span class="dv-dumbbell-label">{scheduledLabel}</span>
				<span class="dv-dumbbell-value">{fmt1(scheduledMin)}</span>
			</span>
			<span class="dv-dumbbell-end" data-end="observed">
				<span class="dv-dumbbell-glyph" style="color: {OBSERVED_VAR};" aria-hidden="true"
					>{OBSERVED_GLYPH}</span
				>
				<span class="dv-dumbbell-label">{observedLabel}</span>
				<span class="dv-dumbbell-value">{fmt1(observedMin)}</span>
			</span>
			{#if excessText}
				<span class="dv-dumbbell-excess" data-slot="dumbbell-excess">{excessText}</span>
			{/if}
		</figcaption>
	</figure>
{:else}
	<!-- Honest absence: neither endpoint resolves → say WHY, never a 0 dumbbell. -->
	<AbsentValue variant="block" reason={absentReason} {locale} />
{/if}

<style>
	.dv-dumbbell {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.dv-dumbbell-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem 1rem;
		margin: 0;
	}
	.dv-dumbbell-end {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
	}
	.dv-dumbbell-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1;
	}
	.dv-dumbbell-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.dv-dumbbell-value {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	.dv-dumbbell-excess {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--accent-text);
	}
</style>

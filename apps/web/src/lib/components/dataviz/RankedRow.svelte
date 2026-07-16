<!--
  RankedRow, one row of a ranked list: rank + title + severity bar + delta.

  Used for "worst offenders" / hotspot lists. The magnitude bar is a SeverityBar
  (dataviz severity scale only). The delta chip shows movement vs a prior period
  with a glyph (▲/▼/—) so direction is never colour-only; its colour is encoded
  on the dataviz scale (worse = severity-critical token, better = on-time green
  token, flat = unknown token). NEVER --primary for any data mark.

  a11y: a list-item with explicit rank + value + delta text; the SeverityBar
  carries its own progressbar semantics. Interactive rows expose a button-ish
  role only when `onSelect` is provided.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { SeverityCode } from '$lib/v1/schemas';
	import SeverityBar from './SeverityBar.svelte';
	import ChartTooltip from './ChartTooltip.svelte';
	import { createChartTooltip, type ChartTooltipRow } from './useChartTooltip.svelte';
	import type { ChartLegendItem } from './ChartLegend.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';

	export interface RankedRowProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** 1-based rank. */
		rank: number;
		/** Row title (route/stop name, already localized). */
		title: string;
		/** Optional secondary line (e.g. route id, branch). */
		subtitle?: string;
		/** Severity band, drives the bar fill AND the announced a11y band. */
		severity: SeverityCode;
		/**
		 * Optional fill-colour override (a `var(--dataviz-*)` token), forwarded to
		 * the SeverityBar. Use ONLY for a calm, honest encoding where the problem-
		 * severity scale would misframe the data (e.g. the live-bus roster colouring
		 * early/on-time on the calm `--dataviz-status-*` scale). Omit for the default
		 * worst-offenders severity colours.
		 */
		colorVar?: string;
		/**
		 * Bar magnitude. WITHOUT `domain`: a normalized [0,1] fraction (legacy).
		 * WITH `domain`: the ABSOLUTE value in real units — forwarded to SeverityBar so
		 * the bar scales against a FIXED domain, never the in-view max. `null` = no-data.
		 */
		value: number | null;
		/** Fixed absolute [min,max] domain (real units), forwarded to SeverityBar. */
		domain?: readonly [number, number];
		/** Unit for the SeverityBar hover readout when domain-scaled (e.g. ' min'). */
		unit?: string;
		/**
		 * Show the 1-based rank ordinal (default true). Set false for FIXED-category
		 * lists (time-of-day, weekday/weekend) where the row order is the meaning, not a
		 * ranking — a 1..N ordinal on a fixed axis is itself a doctrine violation.
		 */
		showRank?: boolean;
		/** Display value text (e.g. "12.4 min", "84%"). `null` = absent (no value). */
		display?: string | null;
		/**
		 * Optional typed absence reason for the DISPLAY value. When set (with
		 * `locale`) AND `value` is null, the display slot renders the styled
		 * honest-absence chip (AbsentValue: calm "unknown" tone + glyph + the WHY)
		 * instead of a plain no-data `display` string — the site-wide upgrade,
		 * mirroring MetricDisplay. Falls back to `display` when no reason/locale is
		 * supplied or when `value` is present. No business logic lives here.
		 */
		absentReason?: AbsenceReasonKey;
		/** Locale for the styled absence copy (required for `absentReason` to render). */
		locale?: Locale;
		/** Copy params interpolated into the absence WHY (e.g. { first: '06:00' }). */
		absentParams?: Readonly<Record<string, string | number>>;
		/**
		 * Delta vs prior period. Sign drives the glyph + colour. `null` = no
		 * comparison available (renders an em-dash, neutral).
		 */
		delta?: number | null;
		/** Formatted delta text (e.g. "+2.1"). Falls back to the raw number. */
		deltaDisplay?: string;
		/**
		 * Whether a positive delta is GOOD (improvement). For delay/severity lists
		 * a rising value is bad (default false). For on-time % a rise is good.
		 */
		higherIsBetter?: boolean;
		/** Make the row activatable (keyboard + click). */
		onSelect?: () => void;
		/**
		 * Render the root WITHOUT the self `role="listitem"` (a plain presentational
		 * container). Set this when the row is wrapped by an outer `<a>`/`<li>` that
		 * already owns the listitem semantics (the correct list > listitem > link
		 * shape), so the row never double-declares the role. Ignored when the row is
		 * interactive (an activatable row keeps its button role). Default false: the
		 * row self-declares `role="listitem"` for placement directly in a role="list".
		 */
		bare?: boolean;
		/**
		 * Opt-in richer breakdown tooltip on hover/focus, anchored to the row's
		 * right edge. Requires `tooltipRows`. Default off; when omitted the row is
		 * unchanged. Drives the embedded SeverityBar's `interactive` OFF so the two
		 * never double up.
		 */
		tooltip?: boolean;
		/** Breakdown rows shown when `tooltip` is set (swatch + label + value). */
		tooltipRows?: ChartLegendItem[];
		/**
		 * Make the embedded magnitude SeverityBar hoverable (its own one-row value/severity
		 * readout) WITHOUT the richer row breakdown — for fixed-category rows whose detail is
		 * already on screen. Ignored when `tooltip` is set (the row breakdown wins). Default
		 * off so existing call sites are unchanged.
		 */
		barInteractive?: boolean;
		class?: string;
	}

	let {
		rank,
		title,
		subtitle,
		severity,
		colorVar,
		value,
		domain,
		unit,
		showRank = true,
		display,
		absentReason,
		locale,
		absentParams,
		delta = null,
		deltaDisplay,
		higherIsBetter = false,
		onSelect,
		bare = false,
		tooltip = false,
		tooltipRows,
		barInteractive = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: RankedRowProps = $props();

	const hasDelta = $derived(delta != null && !Number.isNaN(delta));

	// Honest absence in the display slot: only when the DISPLAY value is genuinely
	// absent (display == null/"") AND a typed reason + locale are supplied. Keyed
	// off the display value (like MetricDisplay's empty branch), not the bar
	// magnitude, so a real measured value (including a true "0 min") always renders
	// its `display` string and never the absence chip.
	const showAbsent = $derived(
		(display == null || display === '') && absentReason != null && locale != null,
	);

	// Direction glyph, never colour-only.
	const deltaGlyph = $derived(!hasDelta ? '·' : delta! > 0 ? '▲' : delta! < 0 ? '▼' : '·');

	// Delta colour on the dataviz scale: improvement = on-time green token,
	// regression = severity-critical token, flat / no-data = unknown token.
	const deltaVar = $derived.by(() => {
		if (!hasDelta || delta === 0) return 'var(--dataviz-status-unknown)';
		const isImprovement = higherIsBetter ? delta! > 0 : delta! < 0;
		return isImprovement ? 'var(--dataviz-status-on-time)' : 'var(--dataviz-severity-critical)';
	});

	const deltaText = $derived(
		!hasDelta ? '' : (deltaDisplay ?? (delta! > 0 ? `+${delta}` : `${delta}`)),
	);

	const interactive = $derived(typeof onSelect === 'function');

	// Root role: an interactive row is a button; a default row self-declares
	// listitem for placement directly in a role="list"; a `bare` (non-interactive)
	// row drops the role entirely so an outer <li>/<a> owns the list semantics
	// (the correct list > listitem > link shape).
	const rootRole = $derived(interactive ? 'button' : bare ? undefined : 'listitem');

	function activate() {
		onSelect?.();
	}
	function onKeydown(e: KeyboardEvent) {
		if (!interactive) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect?.();
		}
	}

	// Richer-breakdown tooltip, anchored to the row's right edge. Active only when
	// both `tooltip` and rows are supplied. The row is made focusable for it.
	const tip = createChartTooltip();
	const hasTooltip = $derived(tooltip && (tooltipRows?.length ?? 0) > 0);
	// Map ChartLegendItem -> ChartTooltipRow (value is optional on legend items).
	const tipRows = $derived<ChartTooltipRow[]>(
		(tooltipRows ?? []).map((r) => ({
			colorVar: r.colorVar,
			label: r.label,
			value: r.value ?? '',
		})),
	);
	// Focusable when activatable OR when it owns a tooltip.
	const focusable = $derived(interactive || hasTooltip);

	function showTip() {
		if (!hasTooltip) return;
		tip.show({ xPct: 100, yPct: 50, heading: title, rows: tipRows, side: 'left' });
	}
	function hideTip() {
		tip.hide();
	}
</script>

{#snippet rowBody()}
	<!-- Rank, monospace ordinal, neutral. Hidden for fixed-category lists (showRank
	     false) where the row order is the meaning, not a ranking. -->
	{#if showRank}
		<span
			class="dv-rank w-6 text-right font-mono text-small tabular-nums text-muted-foreground"
			aria-hidden="true"
		>
			{rank}
		</span>
	{:else}
		<span aria-hidden="true"></span>
	{/if}

	<div class="min-w-0">
		<div class="flex items-baseline justify-between gap-2">
			<span class="truncate font-medium text-foreground">{title}</span>
			{#if showAbsent}
				<span class="shrink-0">
					<AbsentValue
						variant="inline"
						reason={absentReason!}
						locale={locale!}
						params={absentParams}
					/>
				</span>
			{:else if display}
				<span class="shrink-0 font-mono text-small tabular-nums text-foreground">{display}</span>
			{/if}
		</div>
		{#if subtitle}
			<span class="block truncate text-caption text-muted-foreground">{subtitle}</span>
		{/if}
		<div class="mt-1.5">
			<SeverityBar
				{severity}
				{colorVar}
				{value}
				{domain}
				{unit}
				label={`Rank ${rank}: ${title}`}
				size="sm"
				interactive={barInteractive && !tooltip}
			/>
		</div>
	</div>

	<!-- Delta chip: glyph + colour + text. -->
	<span
		class="dv-delta inline-flex shrink-0 items-center gap-1 font-mono text-caption tabular-nums"
		style="color: {deltaVar};"
		role="img"
		aria-label={hasDelta ? `change ${deltaText}` : 'no change data'}
	>
		<span aria-hidden="true">{deltaGlyph}</span>
		{#if hasDelta}<span aria-hidden="true">{deltaText}</span>{/if}
	</span>
{/snippet}

{#snippet rowEl()}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- role + tabindex are correlated: interactive => button + tabindex 0, else listitem + no tabindex (or no role when `bare`, so an outer li/a owns the listitem). The compiler cannot narrow the conditional. -->
	<div
		bind:this={ref}
		class={cn(
			'dv-ranked-row grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2',
			interactive &&
				'cursor-pointer transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
			!interactive &&
				hasTooltip &&
				'transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
			className,
		)}
		role={rootRole}
		tabindex={focusable ? 0 : undefined}
		onclick={interactive ? activate : undefined}
		onkeydown={interactive ? onKeydown : undefined}
		onpointerenter={hasTooltip ? showTip : undefined}
		onpointerleave={hasTooltip ? hideTip : undefined}
		onfocus={hasTooltip ? showTip : undefined}
		onblur={hasTooltip ? hideTip : undefined}
		aria-describedby={hasTooltip && tip.open ? tip.id : undefined}
		data-slot="ranked-row"
		{...restProps}
	>
		{@render rowBody()}
	</div>
{/snippet}

{#if hasTooltip}
	<ChartTooltip
		open={tip.open}
		xPct={tip.xPct}
		yPct={tip.yPct}
		heading={tip.heading}
		rows={tip.rows}
		side={tip.side}
		id={tip.id}
	>
		{@render rowEl()}
	</ChartTooltip>
{:else}
	{@render rowEl()}
{/if}

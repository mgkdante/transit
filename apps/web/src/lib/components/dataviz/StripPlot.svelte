<!--
  StripPlot — two honest small-multiple layouts on ONE shared value axis:

  1. The 1-D dot plot (`values`): one circle per observation on a single shared
     value axis. The honest small-sample distribution — when n is below the
     histogram floor you show every observation as a dot instead of a misleading
     histogram/box. Position (x) is the value — the accurate channel — so colour
     is a single calm hue, not a category; the count + range live in aria.

  2. The CATEGORICAL Cleveland dot plot (`rows`): one labelled row per category
     (e.g. the 5 time-of-day shifts) with a SINGLE dot positioned along the same
     shared, FIXED value axis (`domain`). The rows are NOT connected (a Cleveland
     dot plot, never a line). `order='given'` preserves the caller's order (a
     fixed chronological axis); `order='value'` sorts worst→best. An optional
     vertical `mean` rule marks the all-day reference. Only the extreme rows are
     direct-labelled (the cleanest read); every row still carries its value in
     aria/title. Colour is never the sole channel — each dot pairs its
     `--dataviz-*` token with a glyph + a per-row sr-only label. A null-value row
     routes through honest absence (no dot, a muted "no data" mark) — never a
     fabricated 0 / bare "·" / em-dash.

  DETERMINISM: the 1-D jitter to separate overlapping dots comes from
  hashJitter(id) (FNV-1a), NEVER Math.random — byte-identical across loads/SSR.
  Pass stable `ids`; without them the index is the seed. The categorical layout
  is fully deterministic (row index → y). Pin `domain` for a comparable axis.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import { hashJitter } from '$lib/utils/hash';
	import ChartTooltip from './ChartTooltip.svelte';
	import { createChartTooltip, type ChartTooltipRow } from './useChartTooltip.svelte';

	/**
	 * One category in the Cleveland dot-plot layout: a label, a single value on
	 * the shared axis, the dot's dataviz fill + glyph (colour is never alone), and
	 * a fully-formed accessible/display reading. A null `value` is honest absence.
	 */
	export interface StripPlotRow {
		/** Stable key (used for {#each} and deterministic ordering ties). */
		readonly key: string;
		/** Category label (already localized), shown to the left of the axis. */
		readonly label: string;
		/** The value on the shared axis (real units). `null` = honest absence. */
		readonly value: number | null;
		/**
		 * Optional sample size (n) shown ONLY in the interactive tooltip count line.
		 * Absent n simply omits the count. Never affects the dot position or the
		 * direct label.
		 */
		readonly n?: number;
		/** Dot fill — a `var(--dataviz-*)` token (never --primary). */
		readonly colorVar: string;
		/** Glyph paired with the fill (colour is never the sole channel). */
		readonly glyph: string;
		/** The formatted value text (e.g. "12%"), shown when direct-labelled. */
		readonly display: string;
		/** The honest no-data text, shown for a null-value row. */
		readonly emptyLabel: string;
	}

	export interface StripPlotProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** 1-D mode: the raw values, one dot each (e.g. per-trip signed delay min). */
		values?: number[];
		/** Stable id per value for deterministic jitter; falls back to the index. */
		ids?: string[];
		/**
		 * Categorical Cleveland mode: one labelled row per category, each a single
		 * dot on the shared axis. When set, the component renders the Cleveland
		 * layout instead of the 1-D dot cloud.
		 */
		rows?: StripPlotRow[];
		/**
		 * Row ordering for the categorical layout: `'given'` keeps the caller's
		 * order (a fixed chronological/category axis — re-sorting it is itself a
		 * doctrine violation); `'value'` sorts worst→best by value. Default 'given'.
		 */
		order?: 'given' | 'value';
		/**
		 * Optional vertical reference rule (value units) for the categorical layout
		 * — e.g. the all-day mean. Drawn as a dashed neutral line + an sr-only label.
		 */
		mean?: number | null;
		/** Accessible label for the mean rule (already localized). */
		meanLabel?: string;
		/** Pinned x value-domain [min, max]; defaults to the data's own range. */
		domain?: [number, number] | readonly [number, number];
		/** Dot fill (1-D mode) — a `var(--dataviz-*)` token (never --primary). */
		colorVar?: string;
		/** Optional median tick (value units) drawn as a vertical reference rule (1-D). */
		median?: number | null;
		/** Optional tinted reference band [from, to] (value units) e.g. the on-time band. */
		band?: [number, number] | null;
		/** Accessible summary (already localized). Falls back to "{n} values". */
		label?: string;
		width?: number;
		height?: number;
		/** Dot radius (viewBox units). */
		dotR?: number;
		/**
		 * Opt-in hover/focus interactivity: every dot (the categorical Cleveland dots
		 * AND the 1-D dots) becomes a focus/pointer target that reveals a one-row
		 * <ChartTooltip> with the row label, its value display, and its sample size n.
		 * Default off so existing call sites stay byte-identical.
		 */
		interactive?: boolean;
		class?: string;
	}

	let {
		values = [],
		ids,
		rows,
		order = 'given',
		mean = null,
		meanLabel,
		domain,
		colorVar = 'var(--dataviz-status-unknown)',
		median = null,
		band = null,
		label,
		width = 240,
		height = 48,
		dotR = 3,
		interactive = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: StripPlotProps = $props();

	// Categorical Cleveland layout when `rows` is supplied, else the 1-D dot cloud.
	const categorical = $derived((rows?.length ?? 0) > 0);

	const PAD = $derived(dotR + 2);
	const reals = $derived(values.filter((v) => v != null && !Number.isNaN(v)));
	// Shared axis domain: pinned when supplied, else the in-view data range. For the
	// categorical layout `domain` is REQUIRED for a stable axis (callers pass a fixed
	// literal); the fallback only protects the rare un-pinned 1-D usage.
	const catReals = $derived((rows ?? []).map((r) => r.value).filter((v): v is number => v != null));
	const allReals = $derived(categorical ? catReals : reals);
	const dMin = $derived(domain ? domain[0] : Math.min(...(allReals.length ? allReals : [0])));
	const dMax = $derived(domain ? domain[1] : Math.max(...(allReals.length ? allReals : [1])));
	const span = $derived(dMax - dMin || 1);
	const innerW = $derived(width - PAD * 2);
	const midY = $derived(height / 2);
	// Total vertical jitter band (1-D), capped so dots stay inside the plot.
	const jitterBand = $derived(Math.min(8, (height - dotR * 2 - 4) / 2));

	// x position as a PERCENT of the plot width (the categorical layout overlays an
	// HTML label column on a percent-positioned SVG, so the axis stays responsive).
	const scaleX = (v: number): number =>
		PAD + ((Math.min(dMax, Math.max(dMin, v)) - dMin) / span) * innerW;
	const scalePct = (v: number): number => ((Math.min(dMax, Math.max(dMin, v)) - dMin) / span) * 100;

	// ── 1-D dot cloud ──────────────────────────────────────────────────────────
	type Dot = { x: number; y: number; v: number };
	const dots = $derived<Dot[]>(
		values
			.map((v, i) => ({ v, seed: ids?.[i] ?? String(i) }))
			.filter((d) => d.v != null && !Number.isNaN(d.v))
			.map((d) => ({ x: scaleX(d.v), y: midY + hashJitter(d.seed, jitterBand), v: d.v })),
	);

	const summary = $derived(label ?? `${reals.length} values`);
	const bandX = $derived(band ? ([scaleX(band[0]), scaleX(band[1])] as const) : null);

	// ── Categorical Cleveland layout ─────────────────────────────────────────────
	// Order the rows: 'given' keeps the caller's fixed axis order; 'value' sorts
	// worst→best (descending value). A null value sorts last (honest absence is not
	// "best"). The sort is stable on `key` so a deterministic tie-break holds.
	const orderedRows = $derived.by<StripPlotRow[]>(() => {
		const src = rows ?? [];
		if (order === 'given') return src;
		return src
			.slice()
			.sort(
				(a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.key.localeCompare(b.key),
			);
	});

	// Direct-label only the EXTREMES (lowest + highest real value) — the cleanest
	// read; every other row carries its value in aria/title only. Keyed on `key` so
	// ties and re-renders are deterministic.
	const extremeKeys = $derived.by<Set<string>>(() => {
		const withVal = orderedRows.filter((r) => r.value != null);
		if (withVal.length === 0) return new Set();
		let lo = withVal[0];
		let hi = withVal[0];
		for (const r of withVal) {
			if ((r.value as number) < (lo.value as number)) lo = r;
			if ((r.value as number) > (hi.value as number)) hi = r;
		}
		return new Set([lo.key, hi.key]);
	});

	const hasMean = $derived(categorical && mean != null && !Number.isNaN(mean));
	const meanPct = $derived(hasMean ? scalePct(mean as number) : 0);

	// Per-row accessible reading: the label + the value (or the honest no-data text).
	function rowAria(r: StripPlotRow): string {
		return r.value != null ? `${r.label}: ${r.display}` : `${r.label}: ${r.emptyLabel}`;
	}

	// ── Interactive tooltip ─────────────────────────────────────────────────────
	// Opt-in: each dot (categorical AND 1-D) becomes a focus/pointer target that
	// reveals a one-row tooltip with the label, the value display, and the sample
	// size n (omitted when absent). Mirrors SeverityBar's controller usage.
	const tip = createChartTooltip();

	// A null/absent mark stays honest absence and never gets a tooltip.
	function showRowTip(r: StripPlotRow): void {
		if (!interactive || r.value == null) return;
		const rows: ChartTooltipRow[] = [{ colorVar: r.colorVar, label: r.label, value: r.display }];
		if (r.n != null) rows.push({ label: 'n', value: String(r.n) });
		tip.show({ xPct: scalePct(r.value), yPct: 0, heading: r.label, rows, side: 'top' });
	}

	// 1-D dot: the value carries the readout; there is no per-observation n.
	function dotAria(d: Dot): string {
		return label ? `${label}: ${d.v}` : String(d.v);
	}
	function showDotTip(d: Dot): void {
		if (!interactive) return;
		tip.show({
			xPct: (d.x / width) * 100,
			yPct: 0,
			heading: label,
			rows: [{ colorVar, label: label ?? summary, value: String(d.v) }],
			side: 'top',
		});
	}
	function hideTip(): void {
		tip.hide();
	}
</script>

{#snippet catGrid()}
	<!-- The plot grid: a label column + a SINGLE shared-axis plot column. Every dot
	     AND the all-day mean rule are percent-positioned against the same relative
	     plot column, so the axis is genuinely shared across rows. The per-row
	     title + the dot's aria-label are the a11y source of truth. -->
	<div class="dv-strip-plot__grid" role="presentation">
		<div class="dv-strip-plot__labels">
			{#each orderedRows as r (r.key)}
				<div class="dv-strip-plot__label" title={rowAria(r)}>{r.label}</div>
			{/each}
		</div>
		<div class="dv-strip-plot__plot">
			{#each orderedRows as r (r.key)}
				{@const labelled = extremeKeys.has(r.key)}
				<div class="dv-strip-plot__track">
					{#if r.value != null}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<!-- The dot is a non-interactive img mark; when `interactive` it also
						     becomes a deliberate focus/pointer target so keyboard + hover users
						     reveal the tooltip (label + value + n). The aria-label carries the
						     full reading either way, so colour/position is never the sole channel. -->
						<span
							class="dv-strip-plot__dot"
							class:dv-strip-plot__dot--interactive={interactive}
							style="left: {scalePct(r.value)}%; --dot-fill: {r.colorVar};"
							role="img"
							aria-label={rowAria(r)}
							title={rowAria(r)}
							aria-describedby={interactive && tip.open ? tip.id : undefined}
							tabindex={interactive ? 0 : undefined}
							onpointerenter={interactive ? () => showRowTip(r) : undefined}
							onpointerleave={interactive ? hideTip : undefined}
							onfocus={interactive ? () => showRowTip(r) : undefined}
							onblur={interactive ? hideTip : undefined}
						>
							<span class="dv-strip-plot__glyph" aria-hidden="true">{r.glyph}</span>
						</span>
						{#if labelled}
							<span
								class="dv-strip-plot__value"
								class:dv-strip-plot__value--right={scalePct(r.value) < 50}
								class:dv-strip-plot__value--left={scalePct(r.value) >= 50}
								style="left: {scalePct(r.value)}%;"
								aria-hidden="true"
							>
								{r.display}
							</span>
						{/if}
					{:else}
						<span class="dv-strip-plot__empty" title={rowAria(r)}>{r.emptyLabel}</span>
					{/if}
				</div>
			{/each}
			<!-- The all-day mean reference rule, spanning the plot column (NOT a data mark). -->
			{#if hasMean}
				<span
					class="dv-strip-plot__mean"
					style="left: {meanPct}%;"
					role="img"
					aria-label={meanLabel}
					title={meanLabel}
				></span>
			{/if}
		</div>
	</div>
{/snippet}

{#if categorical}
	<figure
		bind:this={ref}
		class={cn('dv-strip-plot dv-strip-plot--cat m-0', className)}
		data-slot="strip-plot"
		data-layout="categorical"
		aria-label={summary}
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
				{@render catGrid()}
			</ChartTooltip>
		{:else}
			{@render catGrid()}
		{/if}
	</figure>
{:else}
	{#snippet dotCloud()}
		<svg
			viewBox="0 0 {width} {height}"
			width="100%"
			{height}
			preserveAspectRatio="none"
			role="img"
			aria-hidden={!interactive}
			focusable="false"
		>
			<!-- Reference band (e.g. the on-time window) — structural tint, not a data mark. -->
			{#if bandX}
				<rect
					x={Math.min(bandX[0], bandX[1])}
					y="0"
					width={Math.abs(bandX[1] - bandX[0])}
					{height}
					fill="var(--muted)"
					opacity="0.5"
				/>
			{/if}
			<!-- Baseline axis rule (neutral). -->
			<line
				x1={PAD}
				y1={midY}
				x2={width - PAD}
				y2={midY}
				stroke="var(--border)"
				stroke-width="0.75"
			/>
			<!-- Median reference tick (value units). -->
			{#if median != null && !Number.isNaN(median)}
				<line
					x1={scaleX(median)}
					y1={PAD}
					x2={scaleX(median)}
					y2={height - PAD}
					stroke="var(--border-strong, var(--border))"
					stroke-width="1"
					stroke-dasharray="3 3"
				/>
			{/if}
			<!-- One dot per observation; x = the true value, deterministic y jitter. When
			     `interactive` each circle is also a focus/pointer target carrying its own
			     aria-label, so the value is reachable by keyboard + hover, not by sight. -->
			{#each dots as d, i (i)}
				{#if interactive}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<!-- the circle is a non-interactive img mark made a deliberate focus target
					     so keyboard users can reveal the tooltip (mirrors Distribution). -->
					<circle
						cx={d.x}
						cy={d.y}
						r={dotR}
						fill={colorVar}
						opacity="0.8"
						role="img"
						aria-label={dotAria(d)}
						aria-describedby={tip.open ? tip.id : undefined}
						tabindex={0}
						onpointerenter={() => showDotTip(d)}
						onpointerleave={hideTip}
						onfocus={() => showDotTip(d)}
						onblur={hideTip}
					/>
				{:else}
					<circle cx={d.x} cy={d.y} r={dotR} fill={colorVar} opacity="0.8" />
				{/if}
			{/each}
		</svg>
	{/snippet}

	<figure
		bind:this={ref}
		class={cn('dv-strip-plot m-0', className)}
		data-slot="strip-plot"
		aria-label={summary}
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
				{@render dotCloud()}
			</ChartTooltip>
		{:else}
			{@render dotCloud()}
		{/if}
	</figure>
{/if}

<style>
	/* Categorical Cleveland layout: a 2-col grid (label column | shared-axis plot
	   column). The plot column is the SINGLE relative origin so EVERY row's dot AND
	   the all-day mean rule are percent-positioned on the same axis. 8px-grid rhythm. */
	.dv-strip-plot__grid {
		display: grid;
		grid-template-columns: minmax(4.5rem, auto) 1fr;
		gap: 0.75rem;
		align-items: stretch;
	}
	.dv-strip-plot__labels {
		display: flex;
		flex-direction: column;
	}
	.dv-strip-plot__label {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		height: 1.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		white-space: nowrap;
		text-align: right;
	}
	/* The shared-axis plot column: one relative origin for all dots + the mean rule. */
	.dv-strip-plot__plot {
		position: relative;
	}
	.dv-strip-plot__track {
		position: relative;
		height: 1.5rem;
	}
	/* The per-row baseline guide rule (neutral), the dot rides its centre. */
	.dv-strip-plot__track::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 1px;
		background: var(--border);
		opacity: 0.6;
	}
	/* The single Cleveland dot: a fixed-domain fill (data mark) + glyph. */
	.dv-strip-plot__dot {
		position: absolute;
		top: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border-radius: 9999px;
		background: var(--dot-fill);
		/* A thin ring keeps the dot legible where it overlaps the mean rule / guide. */
		box-shadow: 0 0 0 1.5px var(--background);
		transform: translate(-50%, -50%);
	}
	/* Interactive dot affordance: a pointer cursor + a visible focus ring so the
	   tooltip target reads as reachable. --primary is interaction-only here (the
	   focus ring), never a data fill — the dot fill stays the dataviz token. */
	.dv-strip-plot__dot--interactive {
		cursor: pointer;
	}
	.dv-strip-plot__dot--interactive:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.dv-strip-plot__glyph {
		font-size: 0.6rem;
		line-height: 1;
		color: var(--background);
	}
	/* Direct value label, only on the extremes; sits just past the dot, inside the
	   axis edge (flips side near the right edge so it never clips). */
	.dv-strip-plot__value {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	.dv-strip-plot__value--right {
		margin-left: 0.85rem;
	}
	.dv-strip-plot__value--left {
		transform: translate(-100%, -50%);
		margin-left: -0.85rem;
	}
	/* Honest no-data row: a quiet muted reading, NOT a dot at 0. */
	.dv-strip-plot__empty {
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	/* All-day mean reference rule: a dashed neutral vertical line spanning the plot. */
	.dv-strip-plot__mean {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 1px dashed var(--border-strong, var(--border));
		pointer-events: none;
	}
</style>

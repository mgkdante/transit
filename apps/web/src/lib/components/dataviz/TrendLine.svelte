<!--
  TrendLine, dual-series trend chart (SVG, no chart lib).

  Renders two series over a shared x-domain: on-time % (green) and a delay /
  "retard" series (amber). Both colours come from the dataviz scale —
  --dataviz-status-on-time (green) and --dataviz-status-late (amber). `null`
  points break the line (gaps, never interpolated).

  DUAL Y-DOMAINS: the two series may carry DIFFERENT units (e.g. on-time % vs a
  p90 delay in MINUTES). Each scales to its OWN y-domain, `domain` for on-time,
  `retardDomain` for the retard series (defaults to `domain` when both are the
  same unit). This is why neither axis is numbered: the chart reads as two
  independent TREND SHAPES, not a shared-scale comparison, the tooltip carries
  the real per-series values. Plotting minutes on the 0–100 % axis would squash
  the delay line flat against the floor (and clamp it), so a caller mixing units
  MUST pass `retardDomain`.

  a11y: figure with an aria-label summary and a visually-hidden legend;
  decorative geometry is aria-hidden.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import ChartTooltip from './ChartTooltip.svelte';
	import ChartReadout from './ChartReadout.svelte';
	import ChartLegend from './ChartLegend.svelte';
	import { createChartTooltip, type ChartAxis } from './useChartTooltip.svelte';
	import { makeXScale } from './lineScale';

	type Series = Array<number | null>;

	export interface TrendLineProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** On-time % series (rendered green). */
		onTime: Series;
		/** Delay / retard series (rendered amber). */
		retard: Series;
		/**
		 * y-domain [min,max] for the ON-TIME series. Typically a percentage, so the
		 * default is [0,100].
		 */
		domain?: [number, number];
		/**
		 * y-domain [min,max] for the RETARD series. Defaults to `domain` (same unit
		 * as on-time). Pass this when the retard series uses a DIFFERENT unit (e.g.
		 * a delay in minutes) so it scales to its own range instead of being
		 * squashed/clamped against the on-time percentage axis.
		 */
		retardDomain?: [number, number];
		/**
		 * Optional confidence band for the ON-TIME series (e.g. Wilson 95% bounds, on the
		 * same % domain). Drawn as a shaded area BEHIND the on-time line so the interval
		 * recedes and the central estimate leads — the honest "point estimate → interval"
		 * upgrade. `null` points break the band (a gap, never interpolated). A fat band is
		 * itself the honest low-sample signal.
		 */
		band?: { lo: Series; hi: Series };
		/**
		 * Optional horizontal reference value on the on-time domain (e.g. 80 = the 80% OTP
		 * target). Drawn as a dashed hairline rule; label it in the caller's caption.
		 */
		target?: number;
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
		/**
		 * Opt into hover/focus tooltips: a vertical guide tracks the nearest
		 * x-index and a tooltip reads both series at that index. Per-index focus
		 * targets expose the same readout to keyboard + assistive tech. Default
		 * off, the chart stays a static figure.
		 */
		interactive?: boolean;
		/** Optional x-axis category labels (one per index) for the tooltip heading. */
		xLabels?: string[];
		/**
		 * Optional real timestamp per index (epoch ms, Date, or ISO string) — the
		 * bucket date of each point. When supplied with >=2 distinct values the chart
		 * spaces x by ELAPSED CALENDAR TIME instead of array index, so coarse grains
		 * (week/month) that collapse to a few points show their true spacing rather
		 * than a flattened even smear. Omit for categorical series — x falls back to
		 * index spacing and the render stays byte-identical.
		 */
		times?: Array<number | Date | string>;
		/**
		 * Left y-axis metadata for the ON-TIME series, a unit suffix for the
		 * tooltip value (e.g. "%") + an optional label/domain for the endpoint
		 * ticks. Optional + backward-compatible.
		 */
		yAxis?: ChartAxis;
		/**
		 * Right y-axis metadata for the RETARD series, its OWN unit (e.g. " min")
		 * + optional label/domain. Dual-axis honesty: each line is labelled in its
		 * own unit.
		 */
		retardAxis?: ChartAxis;
		/**
		 * Show min/max endpoint tick labels on each y-axis (on-time left, retard
		 * right). Default false → existing renders stay byte-identical. Ticks are
		 * HTML overlay spans because the SVG stretches (`preserveAspectRatio none`).
		 */
		showYTicks?: boolean;
		/**
		 * SINGLE-SERIES mode: the chart carries only the on-time channel and the
		 * `retard` series is decorative-empty (all-null). When set, the retard
		 * LEGEND swatch is suppressed (one line ⇒ one legend entry) AND the
		 * right-hand retard y-tick gutter is dropped (no second axis to label).
		 * Default false → dual-series renders stay byte-identical.
		 */
		singleSeries?: boolean;
		/**
		 * Show the first/last x-labels under the plot. `xLabels` already feeds the
		 * tooltip heading; this surfaces the endpoints visibly. Default false.
		 */
		showXTicks?: boolean;
		/**
		 * Track a focus DOT on each series at the hovered x-index (in addition to
		 * the vertical guide). Defaults to true when `interactive`.
		 */
		focusDots?: boolean;
		/**
		 * Place the hover/focus readout in a FIXED row ABOVE the plot instead of a
		 * floating overlay over the lines (the overlay covers the data on a line
		 * chart). Only takes effect with `interactive`. Default false → existing
		 * renders keep the floating ChartTooltip path byte-identical. The vertical
		 * guide + focus dots stay on-plot; only the value readout moves out.
		 */
		readout?: boolean;
		/** Hint shown in the fixed readout before anything is hovered. `readout` only. */
		readoutHint?: string;
		class?: string;
	}

	let {
		onTime,
		retard,
		domain = [0, 100],
		retardDomain,
		band,
		target,
		width = 320,
		height = 120,
		stroke = 2,
		onTimeLabel = 'On-time %',
		retardLabel = 'Delayed %',
		label,
		interactive = false,
		xLabels,
		times,
		yAxis,
		retardAxis,
		showYTicks = false,
		showXTicks = false,
		focusDots = true,
		readout = false,
		readoutHint,
		singleSeries = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: TrendLineProps = $props();

	const PAD = 6;
	const ON_TIME_VAR = 'var(--dataviz-status-on-time)';
	const RETARD_VAR = 'var(--dataviz-status-late)';

	const tip = createChartTooltip();
	let svgEl = $state<SVGSVGElement | null>(null);
	// Nearest x-index under the pointer / focus; -1 = none (guide hidden).
	let activeIndex = $state(-1);

	// The shared x-domain length (drives index targets + nearest-index math).
	const n = $derived(Math.max(onTime.length, retard.length, 1));

	// Shared x-scale: true-time spacing when `times` is supplied (>=2 distinct),
	// else index spacing (byte-identical for categorical callers). The forward x()
	// and the inverse indexAt() come from ONE scale object so the plotted points and
	// the hover/keyboard hit-test can never disagree.
	const xs = $derived(makeXScale({ count: n, width, pad: PAD, times }));

	// An axis tick / readout cell can't carry a sentence, so an absent value reads
	// as an empty string (no stray "·" ever appears), never a fabricated 0.
	const NO_DATA = '';

	function fmt(series: Series, i: number): string {
		const v = series[i];
		return v == null || Number.isNaN(v) ? NO_DATA : String(v);
	}

	// Like fmt(), but suffixes the axis unit on a real value (never on an empty
	// no-data cell, so a no-data readout stays empty rather than e.g. " %").
	function fmtUnit(series: Series, i: number, axis: ChartAxis | undefined): string {
		const s = fmt(series, i);
		return s === NO_DATA ? s : `${s}${axis?.unit ?? ''}`;
	}

	// Labels used for the tooltip rows + keyboard readout (axis label wins).
	const onTimeRowLabel = $derived(yAxis?.label ?? onTimeLabel);
	const retardRowLabel = $derived(retardAxis?.label ?? retardLabel);

	// viewBox x for an index — delegates to the shared scale (time-based when
	// `times` is supplied, else index spacing; single point centres).
	function indexX(i: number): number {
		return xs.x(i);
	}

	// Place + fill the tooltip for index `i`. The guide x is in viewBox units;
	// xPct/yPct are percentages of the wrapper (svg fills it, aspect 'none').
	function showAt(i: number): void {
		if (i < 0 || i >= n) return;
		activeIndex = i;
		const heading = xLabels?.[i] ?? `#${i + 1}`;
		tip.show({
			xPct: (indexX(i) / width) * 100,
			yPct: 0,
			side: 'bottom',
			heading,
			rows: [
				{ colorVar: ON_TIME_VAR, label: onTimeRowLabel, value: fmtUnit(onTime, i, yAxis) },
				{ colorVar: RETARD_VAR, label: retardRowLabel, value: fmtUnit(retard, i, retardAxis) },
			],
		});
	}

	function hide(): void {
		activeIndex = -1;
		tip.hide();
	}

	// Map a pointer to the nearest x-index using the svg's rendered box.
	function nearestIndex(clientX: number): number {
		const el = svgEl;
		if (!el) return -1;
		const r = el.getBoundingClientRect();
		if (r.width === 0) return -1;
		const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
		// Invert via the SAME shared scale the plot uses (time-based or index), so
		// the hover/keyboard target always lands on the point under the pointer.
		return xs.indexAt(frac);
	}

	function onPointerMove(e: PointerEvent): void {
		const i = nearestIndex(e.clientX);
		if (i >= 0) showAt(i);
	}

	// Touch DRAG scrubbing: on pointerdown we capture the pointer (so subsequent
	// moves keep targeting THIS plot even as the finger slides) and seat the
	// readout at the touched x. `touch-action: pan-y` on the plot lets a vertical
	// drag still scroll the page while a horizontal drag scrubs. Desktop hover is
	// untouched — a mouse never fires pointerdown to hover, it just moves.
	function onPointerDown(e: PointerEvent): void {
		const el = e.currentTarget as Element | null;
		// happy-dom (tests) + very old engines may lack pointer capture; guard it.
		if (el && typeof (el as HTMLElement).setPointerCapture === 'function') {
			try {
				(el as HTMLElement).setPointerCapture(e.pointerId);
			} catch {
				// A non-capturable pointer id is non-fatal — scrubbing still works
				// via the move handler, it just won't track outside the element.
			}
		}
		const i = nearestIndex(e.clientX);
		if (i >= 0) showAt(i);
	}

	// End a drag: release the capture and hide the readout (mirrors pointerleave on
	// desktop). Fires on lift (pointerup) and on an interrupted touch (pointercancel).
	function onPointerUp(e: PointerEvent): void {
		const el = e.currentTarget as Element | null;
		if (el && typeof (el as HTMLElement).releasePointerCapture === 'function') {
			try {
				if (
					typeof (el as HTMLElement).hasPointerCapture !== 'function' ||
					(el as HTMLElement).hasPointerCapture(e.pointerId)
				) {
					(el as HTMLElement).releasePointerCapture(e.pointerId);
				}
			} catch {
				// Already released / never captured — nothing to do.
			}
		}
		hide();
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape') hide();
	}

	type Pt = { x: number; y: number };

	function scale(series: Series, dom: [number, number]): Array<Pt | null> {
		const [min, max] = dom;
		const span = max - min || 1;
		const innerH = height - PAD * 2;
		return series.map((v, i) => {
			if (v == null || Number.isNaN(v)) return null;
			const x = xs.x(i);
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
				if (cur.length)
					segs.push(
						cur
							.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`)
							.join(' '),
					);
				cur = [];
			} else cur.push(p);
		}
		if (cur.length)
			segs.push(
				cur.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' '),
			);
		return segs;
	}

	function lastOf(pts: Array<Pt | null>): Pt | null {
		for (let i = pts.length - 1; i >= 0; i--) if (pts[i]) return pts[i];
		return null;
	}

	// Confidence-band polygons: a closed area between the hi and lo edges, broken into
	// runs wherever EITHER edge is null (a gap, never bridged). Each run goes forward
	// along the hi edge then back along the lo edge and closes. A 1-point run is a
	// zero-area path (invisible) — a band needs at least two points to read.
	function toBandSegments(loPts: Array<Pt | null>, hiPts: Array<Pt | null>): string[] {
		const segs: string[] = [];
		let run: Array<{ hi: Pt; lo: Pt }> = [];
		const flush = () => {
			if (run.length < 2) return;
			const top = run.map(
				(p, i) => `${i === 0 ? 'M' : 'L'}${p.hi.x.toFixed(2)},${p.hi.y.toFixed(2)}`,
			);
			const bottom = run
				.slice()
				.reverse()
				.map((p) => `L${p.lo.x.toFixed(2)},${p.lo.y.toFixed(2)}`);
			segs.push(`${top.join(' ')} ${bottom.join(' ')} Z`);
		};
		for (let i = 0; i < hiPts.length; i++) {
			const hi = hiPts[i];
			const lo = loPts[i];
			if (hi && lo) run.push({ hi, lo });
			else {
				flush();
				run = [];
			}
		}
		flush();
		return segs;
	}

	// Confidence band (e.g. Wilson) scaled to the ON-TIME domain, behind the line.
	const bandSegs = $derived(
		band ? toBandSegments(scale(band.lo, domain), scale(band.hi, domain)) : [],
	);
	// Target reference y (viewBox units) on the on-time domain, e.g. the 80% OTP line.
	const targetY = $derived.by(() => {
		if (target == null) return null;
		const [min, max] = domain;
		const span = max - min || 1;
		const c = Math.min(max, Math.max(min, target));
		return PAD + (1 - (c - min) / span) * (height - PAD * 2);
	});

	const onTimePts = $derived(scale(onTime, domain));
	// Retard scales to its OWN domain when given (different unit, e.g. minutes);
	// otherwise it shares the on-time domain (same unit).
	const retardPts = $derived(scale(retard, retardDomain ?? domain));
	const onTimeSegs = $derived(toSegments(onTimePts));
	const retardSegs = $derived(toSegments(retardPts));
	const onTimeLast = $derived(lastOf(onTimePts));
	const retardLast = $derived(lastOf(retardPts));

	// Midline gridline for orientation (neutral, not a data mark).
	const midY = $derived(PAD + (height - PAD * 2) / 2);
	const summary = $derived(label ?? `${onTimeLabel} vs ${retardLabel}`);

	// Vertical guide x (viewBox units) for the active index, when interactive.
	const guideX = $derived(activeIndex >= 0 ? indexX(activeIndex) : null);

	// Focus dots: the plotted point on each series at the active x-index (drawn in
	// addition to the guide line so the hover gives per-series feedback). They
	// reuse the series colour → still a data mark on the dataviz scale.
	const showFocusDots = $derived(interactive && focusDots && activeIndex >= 0);
	const onTimeFocus = $derived(showFocusDots ? onTimePts[activeIndex] : null);
	const retardFocus = $derived(showFocusDots ? retardPts[activeIndex] : null);

	// Endpoint-tick domains. On-time falls back to its [0,100] default; retard to
	// the on-time domain when it shares the unit. axis.domain overrides either.
	const onTimeTickDomain = $derived<[number, number]>(yAxis?.domain ?? domain);
	const retardTickDomain = $derived<[number, number]>(retardAxis?.domain ?? retardDomain ?? domain);
	const fmtTick = (v: number, axis: ChartAxis | undefined): string => `${v}${axis?.unit ?? ''}`;
	const firstXLabel = $derived(xLabels?.[0] ?? '');
	const lastXLabel = $derived(xLabels?.[n - 1] ?? '');

	// Decorative legend rows (dot swatches): on-time + retard series. In
	// single-series mode the retard channel is empty (all-null), so we drop its
	// swatch — one plotted line ⇒ one legend entry.
	const legendItems = $derived(
		singleSeries
			? [{ colorVar: ON_TIME_VAR, label: onTimeLabel, swatch: 'dot' as const }]
			: [
					{ colorVar: ON_TIME_VAR, label: onTimeLabel, swatch: 'dot' as const },
					{ colorVar: RETARD_VAR, label: retardLabel, swatch: 'dot' as const },
				],
	);
</script>

{#snippet chart()}
	<svg
		bind:this={svgEl}
		viewBox="0 0 {width} {height}"
		width="100%"
		{height}
		preserveAspectRatio="none"
		role="img"
		aria-hidden="true"
		focusable="false"
	>
		<!-- Neutral orientation grid (NOT data). -->
		<line
			x1={PAD}
			y1={midY}
			x2={width - PAD}
			y2={midY}
			stroke="var(--border)"
			stroke-width="0.75"
			stroke-dasharray="3 4"
		/>

		<!-- Confidence band (e.g. Wilson 95%) BEHIND the on-time line: a solid pre-mixed
		     muted green (color-mix to the signage bg, NOT runtime alpha on a surface), so
		     the interval recedes and the central line leads. -->
		{#each bandSegs as d, i (i)}
			<path {d} class="dv-trend-band" />
		{/each}

		<!-- Target reference rule (e.g. 80% OTP), labelled in the caller's caption. -->
		{#if targetY != null}
			<line
				x1={PAD}
				y1={targetY}
				x2={width - PAD}
				y2={targetY}
				stroke="var(--border-strong, var(--border))"
				stroke-width="0.75"
				stroke-dasharray="4 3"
			/>
		{/if}

		<!-- Vertical guide tracking the active x-index (interactive only). -->
		{#if guideX != null}
			<line
				x1={guideX}
				y1={PAD}
				x2={guideX}
				y2={height - PAD}
				stroke="var(--border-strong, var(--border))"
				stroke-width="0.75"
			/>
		{/if}

		<!-- Retard (amber) under on-time so green reads as the headline. -->
		{#each retardSegs as d, i (i)}
			<path
				{d}
				fill="none"
				stroke={RETARD_VAR}
				stroke-width={stroke}
				stroke-linecap="round"
				stroke-linejoin="round"
				opacity="0.95"
			/>
		{/each}
		{#if retardLast}
			<circle cx={retardLast.x} cy={retardLast.y} r={stroke + 0.5} fill={RETARD_VAR} />
		{/if}

		{#each onTimeSegs as d, i (i)}
			<path
				{d}
				fill="none"
				stroke={ON_TIME_VAR}
				stroke-width={stroke}
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{/each}
		{#if onTimeLast}
			<circle cx={onTimeLast.x} cy={onTimeLast.y} r={stroke + 0.5} fill={ON_TIME_VAR} />
		{/if}

		<!-- Focus dots tracking each series at the hovered x-index (data marks). -->
		{#if retardFocus}
			<circle cx={retardFocus.x} cy={retardFocus.y} r={stroke + 1.5} fill={RETARD_VAR} />
		{/if}
		{#if onTimeFocus}
			<circle cx={onTimeFocus.x} cy={onTimeFocus.y} r={stroke + 1.5} fill={ON_TIME_VAR} />
		{/if}
	</svg>
{/snippet}

{#snippet targets()}
	<!-- Keyboard / AT focus targets: one transparent strip per x-index,
	     overlaying the plot, each carrying the both-series readout. -->
	<div class="dv-trendline-targets" aria-hidden="false">
		{#each Array.from({ length: n }, (_, i) => i) as i (i)}
			<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
			<!-- Deliberate AT focus target: a focusable <button> that reads both
			     series at this x-index via role=img + aria-label (keyboard parity). -->
			<button
				type="button"
				class="dv-trendline-target"
				role="img"
				aria-label={`${xLabels?.[i] ?? `#${i + 1}`}: ${onTimeRowLabel} ${fmtUnit(
					onTime,
					i,
					yAxis,
				)}, ${retardRowLabel} ${fmtUnit(retard, i, retardAxis)}`}
				aria-describedby={tip.id}
				onfocus={() => showAt(i)}
				onblur={hide}
				onkeydown={onKeyDown}
			></button>
		{/each}
	</div>
{/snippet}

{#snippet plot()}
	{#if interactive && readout}
		<!-- Fixed-readout path: NO floating overlay over the lines. The pointer
		     handlers ride a plain plot <div>; the values read in the row above.
		     pointerdown/up/cancel add TOUCH-DRAG scrubbing (the readout slides with
		     the finger); pointermove keeps desktop hover identical. -->
		<div
			class="dv-trendline-plot dv-trendline-plot--scrub"
			onpointermove={onPointerMove}
			onpointerdown={onPointerDown}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
			onpointerleave={hide}
			onkeydown={onKeyDown}
			role="presentation"
		>
			{@render chart()}
			{@render targets()}
		</div>
	{:else if interactive}
		<div class="dv-trendline-plot">
			<!-- ChartTooltip spreads these onto its position:relative wrap div, so the
			     scrub handlers + touch-action land on the same box the chart sits in. -->
			<ChartTooltip
				{...tip}
				id={tip.id}
				class="dv-trendline-plot--scrub"
				onpointermove={onPointerMove}
				onpointerdown={onPointerDown}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}
				onpointerleave={hide}
				onkeydown={onKeyDown}
			>
				{@render chart()}
			</ChartTooltip>

			{@render targets()}
		</div>
	{:else}
		{@render chart()}
	{/if}
{/snippet}

{#snippet yTickGutter(dom: [number, number], axis: ChartAxis | undefined, side: 'left' | 'right')}
	<!-- Min/max endpoint ticks for one y-axis. HTML (not SVG <text>), the SVG is
	     stretched (`preserveAspectRatio none`). Neutral axis colour, never an
	     affordance token. -->
	<div
		class="dv-trendline-yticks"
		class:dv-trendline-yticks--right={side === 'right'}
		aria-hidden="true"
	>
		<span class="dv-trendline-tick">{fmtTick(dom[1], axis)}</span>
		<span class="dv-trendline-tick">{fmtTick(dom[0], axis)}</span>
	</div>
{/snippet}

<figure
	bind:this={ref}
	class={cn('dv-trendline m-0', className)}
	aria-label={summary}
	data-slot="trend-line"
	{...restProps}
>
	{#if interactive && readout}
		<!-- Fixed readout ABOVE the plot, updates on hover/focus, never over the line. -->
		<ChartReadout
			class="dv-trendline-readout"
			open={tip.open}
			heading={tip.heading}
			rows={tip.rows}
			id={tip.id}
			placeholder={readoutHint}
		/>
	{/if}

	{#if showYTicks}
		<div class="dv-trendline-frame">
			{@render yTickGutter(onTimeTickDomain, yAxis, 'left')}
			<div class="dv-trendline-frame-plot">{@render plot()}</div>
			<!-- Single-series mode has no second axis → drop the retard gutter. -->
			{#if !singleSeries}
				{@render yTickGutter(retardTickDomain, retardAxis, 'right')}
			{/if}
		</div>
	{:else}
		{@render plot()}
	{/if}

	{#if showXTicks && xLabels && xLabels.length > 0}
		<div class="dv-trendline-xticks" aria-hidden="true">
			<span class="dv-trendline-tick">{firstXLabel}</span>
			<span class="dv-trendline-tick">{lastXLabel}</span>
		</div>
	{/if}

	<ChartLegend class="mt-1.5" items={legendItems} />
</figure>

<style>
	/* Confidence-band fill: a SOLID pre-mixed muted on-time green (the dataviz token
	   mixed toward the signage bg) — never runtime alpha on a surface, so the
	   circuit-grid never bleeds through. The band recedes; the 2px line leads. */
	.dv-trend-band {
		fill: color-mix(in oklab, var(--dataviz-status-on-time) 20%, var(--signage-bg));
		stroke: none;
	}

	.dv-trendline-plot {
		position: relative;
	}

	/* TOUCH-DRAG scrub surface: pan-y lets a VERTICAL drag still scroll the page
	   while a HORIZONTAL drag is captured to scrub the readout along the line
	   (never touch-action:none, which would trap page scroll). Applies to the
	   plain readout plot AND — via the class passed to ChartTooltip — its wrap div.
	   Desktop hover is unaffected (mouse moves don't consult touch-action). */
	.dv-trendline-plot--scrub,
	:global(.chart-tooltip-wrap.dv-trendline-plot--scrub) {
		touch-action: pan-y;
	}

	/* Fixed readout sits above the plot with a small gap; it reserves its own
	   height so the chart doesn't shift as the reader hovers in/out. */
	:global(.dv-trendline-readout) {
		margin-bottom: 0.5rem;
	}

	/* Axis frame: y-tick gutters flank the stretched plot; plot grows to fill. */
	.dv-trendline-frame {
		display: flex;
		align-items: stretch;
		gap: 0.375rem;
	}
	.dv-trendline-frame-plot {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* Per-axis endpoint ticks (max on top, min on bottom). Mono micro text on the
	   neutral axis colour, never an affordance token; AA-tested. */
	.dv-trendline-yticks {
		display: flex;
		flex: none;
		flex-direction: column;
		justify-content: space-between;
		align-items: flex-end;
		text-align: end;
	}
	.dv-trendline-yticks--right {
		align-items: flex-start;
		text-align: start;
	}

	/* First/last x-labels, edge-aligned under the plot. */
	.dv-trendline-xticks {
		margin-top: 0.25rem;
		display: flex;
		justify-content: space-between;
	}

	.dv-trendline-tick {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--muted-foreground);
	}

	/* Invisible per-index focus strips overlaying the plot for keyboard + AT;
	   purely an affordance, so they carry no paint of their own. The pointer
	   tooltip is driven by the ChartTooltip wrapper below, so the strips let
	   pointer events fall through. */
	.dv-trendline-targets {
		position: absolute;
		inset: 0;
		display: flex;
		pointer-events: none;
	}

	.dv-trendline-target {
		flex: 1 1 0;
		min-width: 0;
		height: 100%;
		padding: 0;
		border: 0;
		background: none;
		pointer-events: none;
	}

	.dv-trendline-target:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -1px;
		border-radius: var(--radius-sm);
	}
</style>

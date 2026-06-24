<!--
  CyclePlot — a weekday-seasonality cycle plot (SVG, no chart lib).

  Seven Mon→Sun panels share ONE fixed y-axis (passed `domain`, e.g.
  DELAY_DOW_DOMAIN [0,6]); the SAME literal axis on every route/grain/refresh,
  never normalized to the in-view max. Each panel is a mini time-series of that
  weekday across recent weeks, and its DEFINING mark is a per-panel horizontal
  MEAN line — so the reader compares each weekday's level AND its within-day
  drift. A 1px channel gap separates the panels; the Y ticks print on the
  leftmost panel only; every panel is direct-labelled (Mon/Tue/…). The
  steepest-trend panel (largest |last − first| run) is annotated.

  TWO MODES, picked from the data (the current /v1 contract carries ONE value
  per weekday — no across-weeks series — so the cycle degrades honestly rather
  than faking a line):
    - 'cycle' — at least one panel carries ≥2 real points → the small-multiple
      time-series + mean lines above.
    - 'bars'  — every panel has ≤1 real point → a single magnitude bar per
      weekday on the SAME fixed `domain` (no fabricated series). Colour rides
      the dataviz severity scale + a glyph, so it degrades to the existing
      fixed-axis weekday read, never an invented trend.

  Second mark: each weekday also carries its SEVERE-delay share (a ◆ severe
  glyph + a `--dataviz-severity-*` swatch) whenever `severePct` is present. The
  thin-sample gate (n≥5) lives in the CONSUMER — it passes `severePct: null` for
  a weekday it can't trust, so this primitive simply omits the mark rather than
  fabricate one. The observation count renders as a visible `n=` per weekday.

  Colour is a data mark on the dataviz scale (severity for the bars/severe mark,
  the calm late/amber token for the mean + series) — NEVER --primary. Every
  severity mark also carries a glyph + aria, so colour is never the sole channel.
  Honest absence: a weekday with no real datum routes through AbsentValue (says
  WHY); the whole figure routes through AbsentValue when EVERY weekday is empty —
  never a fabricated 0, bare "·", or em-dash. Deterministic (no Date.now /
  Math.random); 8px-grid spacing; reduced-motion safe (static).
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Locale } from '$lib/i18n';
	import type { SeverityCode } from '$lib/v1/schemas';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import { AbsentValue } from '$lib/components/edge';
	import { severityVar } from './tokens';

	/** One weekday panel: its label, the across-weeks series, derived stats, the
	 *  trusted severe-share, and the observation count. `points` may be empty (no
	 *  data → honest absence) or a single value (the contract's current shape). */
	export interface CyclePlotPanel {
		/** Short weekday label (already localized, e.g. "Mon"). */
		readonly label: string;
		/** Full weekday name for the panel's accessible summary. */
		readonly fullLabel: string;
		/** Across-weeks avg-delay series for this weekday (oldest→newest); `null` breaks it. */
		readonly points: ReadonlyArray<number | null>;
		/** Severe-delay share (%) — the second mark. `null` = withheld (thin sample / no data). */
		readonly severePct: number | null;
		/** Severity band for the severe-share swatch + a11y. */
		readonly severity: SeverityCode;
		/** Observation count behind this weekday (drives the `n=` readout + the severe gate). */
		readonly observationCount: number | null;
	}

	export interface CyclePlotProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** Seven panels in Mon→Sun order (the cycle order IS the meaning, never sorted). */
		panels: ReadonlyArray<CyclePlotPanel>;
		/** Fixed absolute [min,max] y-axis (real units, e.g. DELAY_DOW_DOMAIN). Shared by all panels. */
		domain: readonly [number, number];
		/** Severe share on its OWN fixed domain (e.g. SEVERE_DOMAIN) — drives the second mark's bar. */
		severeDomain: readonly [number, number];
		/** UI language — drives the absence copy. */
		locale: Locale;
		/** Whole-figure accessible summary (already localized). */
		ariaLabel: string;
		/** Per-panel mean-line label (already localized) — given the formatted mean. */
		meanLabel: (value: string) => string;
		/** Severe-share label (already localized) — given the formatted share. */
		severeLabel: (value: string) => string;
		/** Observation-count prefix (already localized), e.g. n => `n=${n}`. */
		obsLabel: (n: number) => string;
		/** Steepest-trend annotation (already localized), given the panel label + signed delta. */
		steepestLabel: (day: string, delta: string) => string;
		/** Y-axis unit suffix for the tick + mean readouts (e.g. " min"). */
		unit?: string;
		/** Absence reason for an empty weekday's chip + the whole-figure empty. */
		absentReason?: AbsenceReasonKey;
		/** Drawn panel height (viewBox units). */
		panelHeight?: number;
		class?: string;
	}

	let {
		panels,
		domain,
		severeDomain,
		locale,
		ariaLabel,
		meanLabel,
		severeLabel,
		obsLabel,
		steepestLabel,
		unit = '',
		absentReason = 'no-observations',
		panelHeight = 72,
		class: className,
		ref = $bindable(null),
		...restProps
	}: CyclePlotProps = $props();

	// ── geometry on the FIXED domain (literal, zero-based) — never derived ───────
	const PAD = 8; // 8px grid
	const PANEL_W = 64; // each weekday panel's drawn width (viewBox units)
	// The 1px channel gap between panels is the CSS grid `gap` (.dv-cycleplot-panels).
	const DOT_R = 2.5;

	const has = (v: number | null | undefined): v is number => v != null && !Number.isNaN(v);

	// Real (non-null) points for a panel — the series the marks read.
	const realPoints = (p: CyclePlotPanel): number[] => p.points.filter(has);

	// MODE: 'cycle' when ANY panel carries ≥2 real points (a true across-weeks
	// series); else 'bars' (the contract's one-value-per-weekday shape) — the
	// honest degrade, never a fabricated line through a single point.
	const mode = $derived<'cycle' | 'bars'>(
		panels.some((p) => realPoints(p).length >= 2) ? 'cycle' : 'bars',
	);

	// A panel's mean (across its real points) — the cycle mode's defining mark;
	// also the single value the bars mode draws. `null` when the panel is empty.
	function meanOf(p: CyclePlotPanel): number | null {
		const real = realPoints(p);
		if (real.length === 0) return null;
		return real.reduce((a, b) => a + b, 0) / real.length;
	}

	// The figure is absent only when EVERY weekday is empty (no real point anywhere).
	const hasAny = $derived(panels.some((p) => realPoints(p).length > 0));

	// y on the FIXED domain (clamped) — a value maps to a stable px every render.
	function yOf(v: number): number {
		const [lo, hi] = domain;
		const span = hi - lo || 1;
		const clamped = Math.min(hi, Math.max(lo, v));
		const innerH = panelHeight - PAD * 2;
		return PAD + (1 - (clamped - lo) / span) * innerH;
	}

	// x within a panel for point index `i` of `count` (count 1 centres the dot).
	function xOf(i: number, count: number): number {
		const innerW = PANEL_W - PAD * 2;
		if (count <= 1) return PAD + innerW / 2;
		return PAD + (i / (count - 1)) * innerW;
	}

	const fmt1 = (v: number): string => `${Math.round(v * 10) / 10}`;

	// Per-panel derived render model (kept deterministic + pure).
	type PanelView = {
		readonly panel: CyclePlotPanel;
		readonly mean: number | null;
		readonly meanY: number | null;
		readonly seg: string | null; // the across-weeks polyline (cycle mode)
		readonly dots: ReadonlyArray<{ x: number; y: number }>;
		readonly barY: number | null; // bar top (bars mode)
		readonly trend: number | null; // last − first real point (signed)
		readonly severeBarW: number | null; // severe second-mark bar width (px)
		readonly empty: boolean;
	};

	// Severe second-mark bar width on its OWN fixed domain (a small inline bar
	// under each panel). `null` when the share is withheld.
	function severeWidth(pct: number | null): number | null {
		if (!has(pct)) return null;
		const [lo, hi] = severeDomain;
		const span = hi - lo || 1;
		const innerW = PANEL_W - PAD * 2;
		return Math.min(innerW, Math.max(0, ((pct - lo) / span) * innerW));
	}

	const views = $derived.by<PanelView[]>(() =>
		panels.map((panel) => {
			const real = realPoints(panel);
			const mean = meanOf(panel);
			const count = panel.points.length;
			// Across-weeks polyline (cycle mode): one point per week slot, null breaks.
			const pts = panel.points.map((v, i) => (has(v) ? { x: xOf(i, count), y: yOf(v) } : null));
			const dots = pts.filter((q): q is { x: number; y: number } => q != null);
			const seg =
				dots.length >= 2
					? dots
							.map((q, i) => `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`)
							.join(' ')
					: null;
			const trend = real.length >= 2 ? real[real.length - 1] - real[0] : null;
			return {
				panel,
				mean,
				meanY: mean != null ? yOf(mean) : null,
				seg,
				dots,
				barY: mean != null ? yOf(mean) : null,
				trend,
				severeBarW: severeWidth(panel.severePct),
				empty: real.length === 0,
			};
		}),
	);

	// Steepest-trend panel: the largest |last − first| run (cycle mode only — a
	// single value has no trend). Deterministic: first max on a tie (stable order).
	const steepestIdx = $derived.by<number>(() => {
		if (mode !== 'cycle') return -1;
		let best = -1;
		let bestAbs = -1;
		views.forEach((v, i) => {
			if (v.trend != null && Math.abs(v.trend) > bestAbs) {
				bestAbs = Math.abs(v.trend);
				best = i;
			}
		});
		return best;
	});

	const steepestText = $derived.by<string | null>(() => {
		if (steepestIdx < 0) return null;
		const v = views[steepestIdx];
		if (v.trend == null) return null;
		const signed = `${v.trend >= 0 ? '+' : ''}${fmt1(v.trend)}${unit}`;
		return steepestLabel(v.panel.fullLabel, signed);
	});

	// Calm data tokens (never --primary): the across-weeks series + mean line ride
	// the amber "late/real-world delay" token; the severe second mark + the bars
	// ride the dataviz severity scale (per panel). Glyph + aria carry meaning too.
	const DELAY_VAR = 'var(--dataviz-status-late)';
	const SEVERE_GLYPH = '◆'; // the shared severe glyph (tokens.ts STATUS_GLYPH.severe)
	const MEAN_GLYPH = '─'; // box-drawing horizontal line (reads as the mean rule; never an em dash)

	// Y-axis ticks (leftmost panel only): the fixed domain endpoints + midpoint.
	const yTicks = $derived.by(() => {
		const [lo, hi] = domain;
		const mid = (lo + hi) / 2;
		return [hi, mid, lo].map((v) => ({ v, y: yOf(v), text: `${fmt1(v)}${unit}` }));
	});
</script>

{#if hasAny}
	<figure
		bind:this={ref}
		class={cn('dv-cycleplot m-0', className)}
		data-slot="cycle-plot"
		data-mode={mode}
		{...restProps}
	>
		<div class="dv-cycleplot-frame" role="img" aria-label={ariaLabel}>
			<!-- Y-axis ticks: leftmost gutter only (one shared scale across the panels). -->
			<div class="dv-cycleplot-yticks" aria-hidden="true" style="height: {panelHeight}px;">
				{#each yTicks as t (t.v)}
					<span class="dv-cycleplot-tick" style="top: {(t.y / panelHeight) * 100}%;">{t.text}</span>
				{/each}
			</div>

			<!-- The seven Mon→Sun panels, 1px channel gaps between them. -->
			<div class="dv-cycleplot-panels">
				{#each views as v, i (v.panel.label)}
					<div
						class="dv-cycleplot-panel"
						class:dv-cycleplot-panel--steepest={i === steepestIdx}
						data-slot="cycle-plot-panel"
						data-day={v.panel.label}
					>
						{#if v.empty}
							<!-- Honest absence for one weekday: say WHY, never a fabricated 0 mark. -->
							<div class="dv-cycleplot-empty">
								<AbsentValue variant="inline" reason={absentReason} {locale} />
							</div>
						{:else}
							<svg
								class="dv-cycleplot-svg"
								viewBox="0 0 {PANEL_W} {panelHeight}"
								width="100%"
								height={panelHeight}
								preserveAspectRatio="none"
								role="presentation"
								aria-hidden="true"
							>
								<!-- Neutral panel baseline (NOT a data mark). -->
								<line
									x1={PAD}
									y1={panelHeight - PAD}
									x2={PANEL_W - PAD}
									y2={panelHeight - PAD}
									stroke="var(--border)"
									stroke-width="0.75"
								/>

								{#if mode === 'cycle'}
									<!-- The across-weeks series (amber) — null breaks the line. -->
									{#if v.seg}
										<path
											d={v.seg}
											fill="none"
											stroke={DELAY_VAR}
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"
											opacity="0.85"
										/>
									{/if}
									{#each v.dots as dot, di (di)}
										<circle cx={dot.x} cy={dot.y} r={DOT_R} fill={DELAY_VAR} />
									{/each}
									<!-- The DEFINING per-panel horizontal MEAN line (dashed, amber). -->
									{#if v.meanY != null}
										<line
											x1={PAD}
											y1={v.meanY}
											x2={PANEL_W - PAD}
											y2={v.meanY}
											stroke={DELAY_VAR}
											stroke-width="1.25"
											stroke-dasharray="3 2"
											data-slot="cycle-plot-mean"
										/>
									{/if}
								{:else}
									<!-- Bars mode: ONE magnitude bar per weekday on the SAME fixed domain,
									     coloured on the severity scale (severity prop). The bar runs from the
									     panel baseline up to the single value's y — no fabricated series. -->
									{#if v.barY != null}
										<rect
											x={PAD}
											y={v.barY}
											width={PANEL_W - PAD * 2}
											height={Math.max(0, panelHeight - PAD - v.barY)}
											rx="1.5"
											fill={severityVar(v.panel.severity)}
											data-slot="cycle-plot-bar"
										/>
									{/if}
								{/if}
							</svg>
						{/if}

						<!-- Direct label + readouts under each panel. The mean value carries the
						     metric (yellow/accent) voice; the severe + n= are quiet. -->
						<div class="dv-cycleplot-foot">
							<span class="dv-cycleplot-day">{v.panel.label}</span>
							{#if v.mean != null}
								<span class="dv-cycleplot-mean" data-slot="cycle-plot-mean-readout">
									<span
										class="dv-cycleplot-mean-glyph"
										style="color: {DELAY_VAR};"
										aria-hidden="true">{MEAN_GLYPH}</span
									>
									{meanLabel(`${fmt1(v.mean)}${unit}`)}
								</span>
							{/if}
							{#if v.panel.severePct != null}
								<!-- Severe second mark: glyph + severity swatch + the share (never colour-only). -->
								<span class="dv-cycleplot-severe" data-slot="cycle-plot-severe">
									<span
										class="dv-cycleplot-severe-glyph"
										style="color: {severityVar(v.panel.severity)};"
										aria-hidden="true">{SEVERE_GLYPH}</span
									>
									<span class="dv-cycleplot-severe-track" aria-hidden="true">
										{#if v.severeBarW != null}
											<span
												class="dv-cycleplot-severe-fill"
												style="width: {v.severeBarW}px; background: {severityVar(
													v.panel.severity,
												)};"
											></span>
										{/if}
									</span>
									<span class="dv-cycleplot-severe-val"
										>{severeLabel(`${fmt1(v.panel.severePct)}%`)}</span
									>
								</span>
							{/if}
							{#if v.panel.observationCount != null}
								<span class="dv-cycleplot-n" data-slot="cycle-plot-n"
									>{obsLabel(v.panel.observationCount)}</span
								>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Steepest-trend annotation (cycle mode only) — calls out the largest drift. -->
		{#if steepestText}
			<figcaption class="dv-cycleplot-steepest" data-slot="cycle-plot-steepest">
				{steepestText}
			</figcaption>
		{/if}
	</figure>
{:else}
	<!-- Honest absence: every weekday is empty → say WHY, never a 0 cycle plot. -->
	<AbsentValue variant="block" reason={absentReason} {locale} />
{/if}

<style>
	.dv-cycleplot {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.dv-cycleplot-frame {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
	}
	/* Leftmost shared y-axis ticks (the only numbered gutter). */
	.dv-cycleplot-yticks {
		position: relative;
		flex: none;
		width: 3.25rem;
	}
	.dv-cycleplot-tick {
		position: absolute;
		right: 0;
		transform: translateY(-50%);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	/* The seven panels — 1px channel gaps between them. */
	.dv-cycleplot-panels {
		flex: 1 1 auto;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 1px;
	}
	.dv-cycleplot-panel {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	/* The steepest-drift panel gets a quiet emphasis ring (neutral, not a data colour). */
	.dv-cycleplot-panel--steepest {
		outline: 1px solid var(--border-strong, var(--border));
		outline-offset: 1px;
		border-radius: var(--radius-sm);
	}
	.dv-cycleplot-svg {
		display: block;
		width: 100%;
	}
	.dv-cycleplot-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 2rem;
	}
	.dv-cycleplot-foot {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		align-items: flex-start;
	}
	.dv-cycleplot-day {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.dv-cycleplot-mean {
		display: inline-flex;
		align-items: baseline;
		gap: 0.2rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--accent-text);
	}
	.dv-cycleplot-mean-glyph {
		font-size: var(--text-micro);
		line-height: 1;
	}
	.dv-cycleplot-severe {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	.dv-cycleplot-severe-glyph {
		font-size: var(--text-micro);
		line-height: 1;
	}
	.dv-cycleplot-severe-track {
		display: inline-block;
		width: 1.5rem;
		height: 0.25rem;
		border-radius: var(--radius-pill);
		background: var(--muted);
		overflow: hidden;
	}
	.dv-cycleplot-severe-fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-pill);
		min-width: 1px;
	}
	.dv-cycleplot-severe-val {
		white-space: nowrap;
	}
	.dv-cycleplot-n {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	.dv-cycleplot-steepest {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>

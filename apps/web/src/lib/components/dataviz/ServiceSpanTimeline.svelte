<!--
  ServiceSpanTimeline — a service-span first→last departure timeline (SVG, no chart lib).

  Renders the day's service window as a horizontal bar from the FIRST-trip clock time
  to the LAST-trip clock time on a FIXED 24-hour domain (0..1440 minutes) — the same
  literal axis on every route/grain/refresh, never normalized to the data. The span
  bar rides the dataviz scale (never --primary, an interactive-only token). 24h grid
  ticks (06/12/18) are structural rules, not data marks.

  At each endpoint a signed PUNCTUALITY marker reads that departure's delay on the
  fixed DELAY_STOP_DOMAIN [-2,8]: a tick LEFT of its endpoint for an early departure
  (▼, on-time green), RIGHT for a late one (▲, late amber). Direction is carried by
  position + glyph + aria — never colour alone — and both hues are dataviz tokens.

  The span length + trip count are annotated beside the bar. Endpoints are passed as
  ISO-UTC instants and resolved to America/Toronto wall-clock minutes (deterministic;
  no Date.now / Math.random). When neither endpoint parses, the whole figure routes
  through AbsentValue (honest absence — says WHY), never a fabricated 0/“·”.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import { formatClock, minutesSinceMidnight } from '$lib/utils/time';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Locale } from '$lib/i18n';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import { AbsentValue } from '$lib/components/edge';
	import { DELAY_STOP_DOMAIN } from '$lib/features/reliability/shiftGrains';

	export interface ServiceSpanTimelineProps extends WithElementRef<HTMLAttributes<HTMLElement>> {
		/** First-departure instant (ISO-UTC). null/unparseable → honest absence. */
		firstTripUtc?: string | null;
		/** Last-departure instant (ISO-UTC). null/unparseable → honest absence. */
		lastTripUtc?: string | null;
		/** First-trip punctuality, minutes (signed; <0 early, >0 late). null = no marker. */
		firstDelayMin?: number | null;
		/** Last-trip punctuality, minutes (signed). null = no marker. */
		lastDelayMin?: number | null;
		/** Span length annotation, already formatted (e.g. "18h 30m"). null → omitted. */
		spanLabel?: string | null;
		/** Trip-count annotation, already formatted (e.g. "142 trips"). null → omitted. */
		tripsLabel?: string | null;
		/** Endpoint labels (already localized). */
		firstLabel: string;
		lastLabel: string;
		/** a11y prefixes for the two delay markers (already localized). */
		firstDelayLabel: string;
		lastDelayLabel: string;
		/** Whole-figure accessible summary (already localized), given the two clock times. */
		ariaLabel: (first: string, last: string) => string;
		/** UI language — drives the clock formatting + the absence copy. */
		locale: Locale;
		/** Absence reason for the honest-empty state (the WHY). */
		absentReason?: AbsenceReasonKey;
		/** Drawn width (viewBox units). */
		width?: number;
		/** Drawn height (viewBox units). */
		height?: number;
		class?: string;
	}

	let {
		firstTripUtc = null,
		lastTripUtc = null,
		firstDelayMin = null,
		lastDelayMin = null,
		spanLabel = null,
		tripsLabel = null,
		firstLabel,
		lastLabel,
		firstDelayLabel,
		lastDelayLabel,
		ariaLabel,
		locale,
		absentReason = 'no-observations',
		width = 320,
		height = 56,
		class: className,
		ref = $bindable(null),
		...restProps
	}: ServiceSpanTimelineProps = $props();

	// ── fixed 24h domain (literal, zero-based) — never derived from the data ─────
	const DAY_MIN = 1440;
	const PAD = 8; // 8px grid
	const innerW = $derived(width - PAD * 2);

	// Resolve an ISO-UTC instant to America/Toronto wall-clock minutes (0..1439),
	// or null when absent/unparseable. Deterministic: new Date(iso) is pure.
	function clockMinutes(iso: string | null): number | null {
		if (!iso) return null;
		const m = minutesSinceMidnight(new Date(iso));
		return Number.isNaN(m) ? null : m;
	}
	function clockText(iso: string | null): string {
		if (!iso) return '·';
		return formatClock(new Date(iso), locale);
	}

	const firstMin = $derived(clockMinutes(firstTripUtc));
	const lastMin = $derived(clockMinutes(lastTripUtc));
	// The span is honest only when BOTH endpoints resolve to a real clock time.
	const hasSpan = $derived(firstMin != null && lastMin != null);

	const firstClock = $derived(clockText(firstTripUtc));
	const lastClock = $derived(clockText(lastTripUtc));

	// x on the FIXED 0..1440 domain (clamped). A minute maps to a stable px on every
	// render — the doctrine's "same value, same length" law.
	const xOf = (min: number): number =>
		PAD + (Math.min(DAY_MIN, Math.max(0, min)) / DAY_MIN) * innerW;

	const firstX = $derived(firstMin != null ? xOf(firstMin) : null);
	const lastX = $derived(lastMin != null ? xOf(lastMin) : null);
	const barX = $derived(firstX != null && lastX != null ? Math.min(firstX, lastX) : null);
	const barW = $derived(firstX != null && lastX != null ? Math.abs(lastX - firstX) : 0);

	const trackY = $derived(height * 0.5);
	const barH = 8;

	// 24h structural grid ticks (06/12/18) — orientation rules, NOT data marks.
	const gridTicks = [360, 720, 1080];

	// ── signed punctuality markers on the FIXED DELAY_STOP_DOMAIN [-2,8] ─────────
	const [DELAY_MIN, DELAY_MAX] = DELAY_STOP_DOMAIN;
	const PIP_W = 28; // width (viewBox units) of the tiny per-endpoint delay scale
	const PIP_H = 7;
	const ON_TIME_VAR = 'var(--dataviz-status-on-time)';
	const LATE_VAR = 'var(--dataviz-status-late)';

	interface DelayMark {
		readonly has: boolean;
		readonly glyph: string;
		readonly fill: string;
		readonly cx: number; // pip-local x (0..PIP_W) of the value on DELAY_STOP_DOMAIN
		readonly zeroX: number; // pip-local x of the zero baseline
		readonly text: string;
	}
	function delayMark(v: number | null | undefined): DelayMark {
		const has = v != null && !Number.isNaN(v);
		const span = DELAY_MAX - DELAY_MIN || 1;
		const toX = (n: number): number =>
			((Math.min(DELAY_MAX, Math.max(DELAY_MIN, n)) - DELAY_MIN) / span) * PIP_W;
		const late = has && v! > 0;
		return {
			has,
			glyph: !has || v === 0 ? '·' : late ? '▲' : '▼',
			fill: late ? LATE_VAR : ON_TIME_VAR,
			cx: has ? toX(v!) : toX(0),
			zeroX: toX(0),
			text: !has ? '' : v! > 0 ? `+${v} min` : `${v} min`,
		};
	}
	const firstMark = $derived(delayMark(firstDelayMin));
	const lastMark = $derived(delayMark(lastDelayMin));

	const summary = $derived(ariaLabel(firstClock, lastClock));
</script>

{#if hasSpan}
	<figure
		bind:this={ref}
		class={cn('dv-span-timeline m-0', className)}
		data-slot="service-span-timeline"
		{...restProps}
	>
		<svg
			viewBox="0 0 {width} {height}"
			width="100%"
			{height}
			preserveAspectRatio="none"
			role="img"
			aria-label={summary}
		>
			<!-- Structural 24h grid ticks (06/12/18) — orientation rules, not data. -->
			{#each gridTicks as t (t)}
				<line
					x1={xOf(t)}
					y1={trackY - barH}
					x2={xOf(t)}
					y2={trackY + barH}
					stroke="var(--border)"
					stroke-width="0.75"
					stroke-dasharray="2 3"
				/>
			{/each}

			<!-- The full-day baseline track (neutral; the empty hours read as absent). -->
			<line
				x1={PAD}
				y1={trackY}
				x2={width - PAD}
				y2={trackY}
				stroke="var(--border)"
				stroke-width="1"
			/>

			<!-- The service-span bar (first→last) on the dataviz scale. -->
			{#if barX != null && barW > 0}
				<rect
					x={barX}
					y={trackY - barH / 2}
					width={barW}
					height={barH}
					rx="2"
					fill="var(--dataviz-status-on-time)"
				/>
			{/if}

			<!-- Endpoint caps so a zero-length span (first==last) is still visible. -->
			{#if firstX != null}
				<circle cx={firstX} cy={trackY} r="3" fill="var(--dataviz-status-on-time)" />
			{/if}
			{#if lastX != null}
				<circle cx={lastX} cy={trackY} r="3" fill="var(--dataviz-status-on-time)" />
			{/if}
		</svg>

		<!-- Endpoint clocks + their signed punctuality markers, below the track. -->
		<div class="dv-span-ends">
			<div class="dv-span-end" data-end="first">
				<span class="dv-span-end-label">{firstLabel}</span>
				<span class="dv-span-end-clock">{firstClock}</span>
				<span
					class="dv-span-delay"
					data-slot="span-delay"
					data-end="first"
					aria-label={firstMark.has
						? `${firstDelayLabel}: ${firstMark.text}`
						: `${firstDelayLabel}: no data`}
				>
					<svg
						class="dv-span-pip"
						viewBox="0 0 {PIP_W} {PIP_H}"
						width={PIP_W}
						height={PIP_H}
						preserveAspectRatio="none"
						role="presentation"
						aria-hidden="true"
					>
						<line
							x1={firstMark.zeroX}
							y1="0"
							x2={firstMark.zeroX}
							y2={PIP_H}
							stroke="var(--border-strong, var(--border))"
							stroke-width="1"
						/>
						{#if firstMark.has}
							<line
								x1={Math.min(firstMark.cx, firstMark.zeroX)}
								y1={PIP_H / 2}
								x2={Math.max(firstMark.cx, firstMark.zeroX)}
								y2={PIP_H / 2}
								stroke={firstMark.fill}
								stroke-width={PIP_H}
							/>
						{/if}
					</svg>
					<span class="dv-span-delay-glyph" style="color: {firstMark.fill};" aria-hidden="true"
						>{firstMark.glyph}</span
					>
					<span class="dv-span-delay-text">{firstMark.has ? firstMark.text : ''}</span>
				</span>
			</div>

			<div class="dv-span-end dv-span-end--last" data-end="last">
				<span class="dv-span-end-label">{lastLabel}</span>
				<span class="dv-span-end-clock">{lastClock}</span>
				<span
					class="dv-span-delay"
					data-slot="span-delay"
					data-end="last"
					aria-label={lastMark.has
						? `${lastDelayLabel}: ${lastMark.text}`
						: `${lastDelayLabel}: no data`}
				>
					<svg
						class="dv-span-pip"
						viewBox="0 0 {PIP_W} {PIP_H}"
						width={PIP_W}
						height={PIP_H}
						preserveAspectRatio="none"
						role="presentation"
						aria-hidden="true"
					>
						<line
							x1={lastMark.zeroX}
							y1="0"
							x2={lastMark.zeroX}
							y2={PIP_H}
							stroke="var(--border-strong, var(--border))"
							stroke-width="1"
						/>
						{#if lastMark.has}
							<line
								x1={Math.min(lastMark.cx, lastMark.zeroX)}
								y1={PIP_H / 2}
								x2={Math.max(lastMark.cx, lastMark.zeroX)}
								y2={PIP_H / 2}
								stroke={lastMark.fill}
								stroke-width={PIP_H}
							/>
						{/if}
					</svg>
					<span class="dv-span-delay-glyph" style="color: {lastMark.fill};" aria-hidden="true"
						>{lastMark.glyph}</span
					>
					<span class="dv-span-delay-text">{lastMark.has ? lastMark.text : ''}</span>
				</span>
			</div>
		</div>

		<!-- Span length + trip-count annotations (honest: omitted when absent). -->
		{#if spanLabel || tripsLabel}
			<figcaption class="dv-span-annot">
				{#if spanLabel}<span class="dv-span-annot-item" data-slot="span-length">{spanLabel}</span
					>{/if}
				{#if tripsLabel}<span class="dv-span-annot-item" data-slot="span-trips">{tripsLabel}</span
					>{/if}
			</figcaption>
		{/if}
	</figure>
{:else}
	<!-- Honest absence: no resolvable first/last departure → say WHY, never a 0 bar. -->
	<AbsentValue variant="block" reason={absentReason} {locale} />
{/if}

<style>
	.dv-span-timeline {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.dv-span-ends {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.dv-span-end {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.dv-span-end--last {
		align-items: flex-end;
		text-align: end;
	}
	.dv-span-end-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.dv-span-end-clock {
		font-family: var(--font-mono);
		font-size: var(--text-body);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}

	/* The signed punctuality marker: a tiny zero-anchored scale + glyph + value. */
	.dv-span-delay {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.dv-span-end--last .dv-span-delay {
		flex-direction: row-reverse;
	}
	.dv-span-pip {
		flex: none;
		display: block;
	}
	.dv-span-delay-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1;
	}
	.dv-span-delay-text {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}

	.dv-span-annot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin: 0;
	}
	.dv-span-annot-item {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
</style>

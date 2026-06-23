<!--
  Cluster01Punctuality, the "01 Punctuality" band of the slice-9.6 historic
  Reliability surface (approach B, one band per cluster).

  Reads a `PunctualityVM` (the pure mapper's per-band view-model) + locale +
  the co-located reliability copy. It answers, for the route's punctuality:

    - the headline, OTP %, avg delay, typical (p50) + worst-case (p90) delay
      (MetricDisplay) for the latest closed day;
    - the OTP trend SHAPE across the dated day series (TrendLine: OTP green vs
      the avg-delay/retard amber series, dual y-domains since the units differ),
      captioned with its window (last 30 days) and real dated x-ticks;
    - the SEVERE-DELAY SHARE magnitude of the headline day (SeverityBar, a
      [0,1] data mark on the dataviz severity scale, NEVER --primary) under its
      OWN dedicated label (it is NOT the p90);
    - the accountability element: the weakest stops ranked worst-delay first
      under an explicit heading + count (RankedRow, normalized against the worst
      stop on the route);
    - "By time of day" (A1), the time-of-day shift buckets + a weekday/weekend
      pair, ranked by severe-delay share, with the honest trailing-window caveat.

  HONESTY DOCTRINE upheld here:
    - vm.isEmpty → an explicit no-data note; never a fake 0 or a dropped band.
    - every headline is `number | null`; null renders an em-dash, not 0.
    - each data mark rides the dataviz scale; --primary is interaction-only.
    - the peak block prints its trailing-window / small-sample caveat (the shift
      buckets are an observation-weighted proxy, not certified OTP).

  Self-contained: takes its data + locale + copy as props (no resource load, no
  i18n context) so it compiles + renders in isolation before it is wired up.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { stopNameFallback } from '$lib/site/absence';
	import { fmtDelayMin, fmtPct } from '$lib/utils';
	import type { ReliabilityPeriod } from '$lib/v1';
	import type { SeverityCode } from '$lib/v1/schemas';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { TrendLine, SeverityBar, RankedRow } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { PunctualityVM, PeriodComparisonRow } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';
	import {
		shiftLabel as shiftGrainLabel,
		dayTypeLabel as dayTypeGrainLabel,
		severeShareToSeverity,
		SHIFT_GRAIN_ORDER,
		DAY_TYPE_GRAIN_ORDER,
	} from '$lib/features/reliability/shiftGrains';

	export interface Cluster01PunctualityProps {
		/** The punctuality view-model from `toReliabilityClusters`. */
		vm: PunctualityVM;
		/** Active locale (FR canonical). */
		locale: Locale;
		/** The co-located reliability copy bundle for this locale. */
		copy: ReliabilityCopy;
		/**
		 * Which grain the headline answers for. Defaults to 'day'; the band's
		 * headline tiles answer for the latest closed day (the strip is the
		 * canonical grain-aware headline). Threaded for parity with the spine.
		 */
		grain?: string;
	}

	let { vm, locale, copy }: Cluster01PunctualityProps = $props();

	// The in-app metric-explainer (i) affordance: the one-line tip + a localized
	// deep link to /metrics#<anchor>. An INTERACTIVE control beside each label,
	// never a data mark; doctrine-clean.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// The headline period: the most-recent dated day in the trend (the foundation
	// trend is day-only, ascending). The strip remains the canonical grain-aware
	// headline; this band's tiles answer for the latest closed day.
	const headline = $derived<ReliabilityPeriod | null>(
		vm.trend.length > 0 ? vm.trend[vm.trend.length - 1] : null,
	);

	// Honest absence → null (MetricDisplay renders the muted no-data label); a real
	// value speaks the amber metric voice. Never a bare "·", never a fabricated 0.
	const pct = (v: number | null | undefined): string | null => fmtPct(v);
	const min = (v: number | null | undefined): string | null =>
		fmtDelayMin(v, { rounding: 'fixed1' });

	// OTP trend SHAPE across the dated day series (chronological ascending): green
	// OTP %, amber avg-delay retard. The x-axis carries real ISO dates, never the
	// repeated grain word. Each series scales to its OWN y-domain (% vs minutes).
	const otpSeries = $derived(vm.trend.map((p) => p.otp_pct ?? null));
	const retardSeries = $derived(vm.trend.map((p) => p.avg_delay_min ?? null));
	const xLabels = $derived(vm.trend.map((p) => p.date ?? ''));
	const hasTrend = $derived(vm.trend.length > 1);
	// Retard y-domain padded to the observed max so the line is never clamped flat.
	const retardMax = $derived.by(() => {
		const reals = retardSeries.filter((v): v is number => v != null && !Number.isNaN(v));
		return reals.length ? Math.max(...reals) : 0;
	});
	const retardDomain = $derived<[number, number]>([0, Math.max(1, Math.ceil(retardMax))]);

	// Severe-share magnitude of the headline period, as a [0,1] data mark. The
	// contract carries severe_pct as a percentage (0..100); null = no data.
	const severePct = $derived(headline?.severe_pct ?? null);
	const severeValue = $derived<number | null>(
		severePct == null ? null : Math.min(1, Math.max(0, severePct / 100)),
	);
	// Severe share is itself a severity reading: band it so the bar colour is honest
	// (shared thresholds — see severeShareToSeverity; null bands to 'watch').
	const severeSeverity = $derived<SeverityCode>(severeShareToSeverity(severePct));

	// Weakest stops, worst mean-delay first, the accountability list. Normalize
	// each bar against the worst stop so the ranking reads as relative magnitude.
	const rankedStops = $derived.by(() => {
		const rows = vm.weakStops
			.filter((w) => w.avg_delay_min != null)
			.slice()
			.sort((a, b) => (b.avg_delay_min ?? 0) - (a.avg_delay_min ?? 0));
		const worst = rows.length ? (rows[0].avg_delay_min ?? 0) : 0;
		return rows.map((w, i) => {
			const delay = w.avg_delay_min ?? 0;
			const sev: SeverityCode = delay >= 10 ? 'critical' : delay >= 5 ? 'high' : 'watch';
			return {
				key: w.id,
				rank: i + 1,
				title: w.name ?? stopNameFallback(w.id, locale),
				severity: sev,
				value: worst > 0 ? Math.min(1, Math.max(0, delay / worst)) : null,
				display: min(w.avg_delay_min) ?? copy.strip.noData,
			};
		});
	});

	// Weak-stops heading carries the honest count, when fewer than 5 stops carry
	// a delay the heading still reads truthfully (it doesn't promise a fixed 5).
	const weakStopsHeading = $derived(`${copy.strip.weakStopsHeading} · ${rankedStops.length}`);

	/* ── By time of day (A1/A2) ──────────────────────────────────────────────
	   The granular shift + day-type buckets the contract already carries, ranked
	   by SEVERE-delay share (worst first). Each row's SeverityBar encodes the
	   severe share as a [0,1] magnitude; null severe → empty track (no fake 0).
	   These are a trailing-window observation-weighted proxy (date:null), NOT
	   certified OTP, the band prints that caveat below the block. */
	// Shift-grain labels come from the shared reliability vocabulary so the lines +
	// stops surfaces speak identical tokens (no re-invented labels here).
	function shiftLabel(g: string): string {
		return shiftGrainLabel(g, locale);
	}
	function dayTypeLabel(g: string): string {
		if (g === 'weekday') return copy.peak.weekday;
		if (g === 'weekend') return copy.peak.weekend;
		return g;
	}

	type PeakRow = {
		readonly key: string;
		readonly rank: number;
		readonly title: string;
		readonly severity: SeverityCode;
		readonly value: number | null;
		readonly display: string;
	};

	// Rank comparison rows by severe share, worst first; normalize each bar against
	// the worst severe share in the SAME group so the magnitudes read relative.
	function rankBySevere(
		rows: readonly PeriodComparisonRow[],
		label: (g: string) => string,
	): PeakRow[] {
		const real = rows.filter((r) => r.severePct != null);
		const worst = real.reduce((m, r) => Math.max(m, r.severePct ?? 0), 0);
		return real
			.slice()
			.sort((a, b) => (b.severePct ?? 0) - (a.severePct ?? 0))
			.map((r, i) => {
				const sev = r.severePct ?? 0;
				return {
					key: r.grain,
					rank: i + 1,
					title: label(r.grain),
					severity: severeShareToSeverity(r.severePct),
					value: worst > 0 ? Math.min(1, Math.max(0, sev / worst)) : null,
					display: pct(r.severePct) ?? copy.strip.noData,
				};
			});
	}

	const shiftPeakRows = $derived(rankBySevere(vm.peakOffPeak.byShift, shiftLabel));
	const dayTypePeakRows = $derived(rankBySevere(vm.peakOffPeak.byDayType, dayTypeLabel));
	const hasPeak = $derived(
		!vm.peakOffPeak.isEmpty && (shiftPeakRows.length > 0 || dayTypePeakRows.length > 0),
	);

	/* ── By shift and day type (G1) ───────────────────────────────────────────
	   The Tier-3 OTP/delay crosstab: a FIXED 5-shift × 2-day-type grid. The contract
	   is SPARSE (only cells WITH observations are present), so every grid cell is
	   resolved against an index — an absent (shift, day_type) cell, OR a present cell
	   whose otp_pct is null, renders the explicit no-data message. NEVER a "·" or a
	   fabricated 0. This per-empty-cell honesty is the explicit requirement. */
	// Index the sparse cells by "shift|day_type" for O(1) grid lookup. A plain record
	// (not a Map) keeps this a pure derived value with no reactivity.
	const crosstabIndex = $derived.by(() => {
		const index: Record<string, (typeof vm.byShiftDaytype)[number]> = {};
		for (const cell of vm.byShiftDaytype) index[`${cell.shift}|${cell.day_type}`] = cell;
		return index;
	});
	// The resolved grid: one row per shift (canonical order), one column per day-type.
	// Each cell carries the primary OTP display + secondary avg-delay/severe for the
	// caption, plus `present` (contract had this cell) and `hasOtp` (a real OTP).
	const crosstabRows = $derived(
		SHIFT_GRAIN_ORDER.map((shift) => ({
			shift,
			label: shiftLabel(shift),
			cells: DAY_TYPE_GRAIN_ORDER.map((dayType) => {
				const cell = crosstabIndex[`${shift}|${dayType}`];
				const otp = pct(cell?.otp_pct);
				const avgDelay = min(cell?.avg_delay_min);
				return {
					dayType,
					present: cell != null,
					hasOtp: otp != null,
					display: otp ?? copy.strip.noData,
					avgDelay,
					// Secondary caption: avg delay (when present) for the cell's title.
					title: otp != null && avgDelay != null ? `${copy.strip.avgDelayMin}: ${avgDelay}` : '',
				};
			}),
		})),
	);
	// The crosstab section renders only when SOME cell carries a real OTP — else the
	// whole grid would be a wall of "no data" (its honest-empty path: one note).
	const hasCrosstab = $derived(
		vm.byShiftDaytype.length > 0 && crosstabRows.some((r) => r.cells.some((c) => c.hasOtp)),
	);
	const dayTypeColLabels = $derived(
		DAY_TYPE_GRAIN_ORDER.map((d) => ({ key: d, label: dayTypeGrainLabel(d, locale) })),
	);
</script>

{#snippet metricInfo(key: MetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo
		class="cluster-info"
		tip={i.tip}
		href={i.href}
		label={i.label}
		linkLabel={i.linkLabel}
		side="bottom"
	/>
{/snippet}

<section class="cluster" aria-label={copy.clusters.punctuality}>
	<SectionLabel text={copy.clusters.punctuality} variant="station" />

	{#if vm.isEmpty}
		<!-- Honest empty: explicit no-data note, never a fake 0 / dropped band. -->
		<p class="cluster-empty" data-testid="punctuality-empty">{copy.strip.noDataNote}</p>
	{:else}
		<!-- Latest-day headline: OTP %, avg delay, typical (p50) + worst-case (p90). -->
		<div class="cluster-headline">
			<div class="metric-with-info">
				<MetricDisplay
					value={pct(headline?.otp_pct)}
					emptyLabel={copy.strip.noData}
					label={copy.strip.otpPct}
					size="lg"
				/>
				{@render metricInfo('otp', copy.strip.otpPct)}
			</div>
			<div class="metric-with-info">
				<MetricDisplay
					value={min(headline?.avg_delay_min)}
					emptyLabel={copy.strip.noData}
					label={copy.strip.avgDelayMin}
					size="md"
				/>
				{@render metricInfo('avgDelay', copy.strip.avgDelayMin)}
			</div>
			<div class="metric-with-info">
				<MetricDisplay
					value={min(headline?.p50_min)}
					emptyLabel={copy.strip.noData}
					label={copy.strip.p50Min}
					sublabel={copy.strip.p50Caption}
					size="md"
				/>
				{@render metricInfo('p50p90', copy.strip.p50Min)}
			</div>
			<div class="metric-with-info">
				<MetricDisplay
					value={min(headline?.p90_min)}
					emptyLabel={copy.strip.noData}
					label={copy.strip.p90Min}
					sublabel={copy.strip.p90Caption}
					size="md"
				/>
				{@render metricInfo('p50p90', copy.strip.p90Min)}
			</div>
		</div>

		<!-- OTP trend across the dated day series (green) vs avg-delay retard (amber). -->
		{#if hasTrend}
			<div class="cluster-block">
				<div class="cluster-block-head">
					<SectionLabel text={copy.strip.otpPct} variant="metric" />
					<span class="cluster-block-window" data-slot="trend-window">{copy.windows.trend}</span>
				</div>
				<TrendLine
					onTime={otpSeries}
					retard={retardSeries}
					domain={[0, 100]}
					{retardDomain}
					{xLabels}
					onTimeLabel={copy.strip.otpPct}
					retardLabel={copy.strip.avgDelayMin}
					yAxis={{ label: copy.strip.otpPct, unit: copy.units.pct, domain: [0, 100] }}
					retardAxis={{ label: copy.strip.avgDelayMin, unit: copy.units.min, domain: retardDomain }}
					showYTicks
					showXTicks
					interactive
					readout
					readoutHint={copy.strip.trendReadoutHint}
				/>
			</div>
		{/if}

		<!-- Severe-delay share of the headline day, its OWN label (NOT p90). -->
		<div class="cluster-block">
			<div class="cluster-block-head">
				<span class="label-with-info">
					<SectionLabel text={copy.strip.severePct} variant="metric" />
					{@render metricInfo('severe', copy.strip.severePct)}
				</span>
				<span class="cluster-block-value" class:cluster-block-value--empty={severePct == null}
					>{pct(severePct) ?? copy.strip.noData}</span
				>
			</div>
			<SeverityBar
				severity={severeSeverity}
				value={severeValue}
				label={copy.strip.severePct}
				interactive
			/>
			<p class="cluster-caption" data-slot="severe-caption">{copy.strip.severeCaption}</p>
		</div>

		<!-- Weakest stops, the accountability list, worst delay first + count. -->
		{#if rankedStops.length > 0}
			<div class="cluster-block">
				<span class="label-with-info">
					<SectionLabel text={weakStopsHeading} variant="metric" />
					{@render metricInfo('weakStops', copy.strip.weakStopsHeading)}
				</span>
				<p class="cluster-caption" data-slot="weak-stops-window">{copy.windows.weakStops}</p>
				<div class="cluster-ranked" role="list">
					{#each rankedStops as row (row.key)}
						<RankedRow
							rank={row.rank}
							title={row.title}
							severity={row.severity}
							value={row.value}
							display={row.display}
						/>
					{/each}
				</div>
			</div>
		{/if}

		<!-- By time of day (A1): shift buckets + weekday/weekend, ranked by severe share. -->
		{#if hasPeak}
			<div class="cluster-block" data-slot="peak-off-peak">
				<span class="label-with-info">
					<SectionLabel text={copy.peak.heading} variant="metric" />
					{@render metricInfo('severe', copy.peak.heading)}
				</span>
				{#if shiftPeakRows.length > 0}
					<div class="cluster-ranked" role="list" aria-label={copy.peak.heading}>
						{#each shiftPeakRows as row (row.key)}
							<RankedRow
								rank={row.rank}
								title={row.title}
								subtitle={copy.peak.dayOfWeekSevere}
								severity={row.severity}
								value={row.value}
								display={row.display}
							/>
						{/each}
					</div>
				{/if}

				{#if dayTypePeakRows.length > 0}
					<div class="cluster-peak-daytype" data-slot="peak-day-type">
						<SectionLabel text={copy.peak.dayType} variant="metric" />
						<div class="cluster-ranked" role="list" aria-label={copy.peak.dayType}>
							{#each dayTypePeakRows as row (row.key)}
								<RankedRow
									rank={row.rank}
									title={row.title}
									subtitle={copy.peak.dayOfWeekSevere}
									severity={row.severity}
									value={row.value}
									display={row.display}
								/>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Honest caveat: trailing-window observation-weighted proxy, small samples vary. -->
				<p class="cluster-caption" data-slot="peak-caveat">{copy.peak.caveat}</p>
			</div>
		{/if}

		<!-- By shift and day type (G1): the Tier-3 OTP crosstab, a fixed 5×2 grid.
		     SPARSE → an absent (shift, day_type) cell or a null OTP shows the explicit
		     no-data message in THAT cell, never a "·"/fake 0. -->
		{#if hasCrosstab}
			<div class="cluster-block" data-slot="shift-daytype-crosstab">
				<span class="label-with-info">
					<SectionLabel text={copy.crosstab.heading} variant="metric" />
					{@render metricInfo('otp', copy.crosstab.heading)}
				</span>
				<table class="cluster-crosstab" aria-label={copy.crosstab.heading}>
					<thead>
						<tr>
							<th scope="col" class="cluster-crosstab__corner">
								<span class="sr-only">{copy.crosstab.shiftHeader}</span>
							</th>
							{#each dayTypeColLabels as col (col.key)}
								<th scope="col" class="cluster-crosstab__colhead">{col.label}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each crosstabRows as row (row.shift)}
							<tr>
								<th scope="row" class="cluster-crosstab__rowhead">{row.label}</th>
								{#each row.cells as cell (cell.dayType)}
									<td
										class="cluster-crosstab__cell"
										class:cluster-crosstab__cell--empty={!cell.hasOtp}
										data-empty={!cell.hasOtp}
										title={cell.title || undefined}
									>
										{cell.display}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="cluster-caption" data-slot="crosstab-caption">{copy.crosstab.caption}</p>
			</div>
		{/if}
	{/if}
</section>

<style>
	.cluster {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.cluster-empty {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.cluster-headline {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem 2rem;
	}
	/* A metric tile + its explainer (i): the affordance rides the tile's top edge,
	   inline so the headline row keeps wrapping naturally (no layout disruption). The
	   tile keeps a measure (min-width:0) so a long label wraps cleanly; the (i) wrapper
	   never shrinks (flex:none) so the glyph stays whole beside it, never colliding. */
	.metric-with-info {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.35rem;
	}
	.metric-with-info :global([data-slot='metric-display']) {
		min-width: 0;
	}
	.metric-with-info :global(.cluster-info) {
		flex: none;
	}
	/* A block overline + its explainer (i), kept centred on the label. The label
	   keeps a measure (min-width:0) so a long overline wraps cleanly; the (i)
	   wrapper never shrinks (flex:none) so the glyph stays whole beside it. */
	.label-with-info {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.label-with-info :global([data-slot='section-label']) {
		min-width: 0;
	}
	.label-with-info :global(.cluster-info) {
		flex: none;
	}
	.cluster-block {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.cluster-block-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.cluster-block-value {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	/* Honest no-data reading of the inline severe value: quiet muted mono. */
	.cluster-block-value--empty {
		color: var(--muted-foreground);
	}
	/* Quiet mono caption (window label / honest caveat), AA both themes. */
	.cluster-block-window,
	.cluster-caption {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.cluster-caption {
		margin: 0;
		max-width: 52ch;
	}
	.cluster-block-window {
		font-variant-numeric: tabular-nums;
	}
	.cluster-ranked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.cluster-peak-daytype {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	/* By-shift-and-day-type crosstab: a compact 5×2 reading grid. Header + row labels
	   are quiet mono; cells are tabular-num OTP readings. An empty cell rides the
	   muted voice with the honest no-data message (never a "·"/0). */
	.cluster-crosstab {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-small);
	}
	.cluster-crosstab th,
	.cluster-crosstab td {
		padding: 0.4rem 0.6rem;
		text-align: right;
		border-bottom: 1px solid var(--border);
	}
	.cluster-crosstab__corner {
		border-bottom: 1px solid var(--border);
	}
	.cluster-crosstab__colhead {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.cluster-crosstab__rowhead {
		text-align: left;
		font-weight: 500;
		color: var(--foreground);
	}
	.cluster-crosstab__cell {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	/* Honest no-data cell: quiet muted mono, the explicit message, never a "·"/0. */
	.cluster-crosstab__cell--empty {
		color: var(--muted-foreground);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>

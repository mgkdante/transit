<!--
  §3 Run & Fit — "Will the bus run, and will you fit?"

  Merges the old Cluster03 (service delivered: cancellations + skipped stops) and
  Cluster04 (crowding: occupancy mix + delay-by-crowding) into ONE rider-question
  section. Two labelled sub-blocks live under the section overline:

    - "run" sub-block (copy.clusters.serviceDelivered): the two RAMP-IN reliability
      rates the route accrues forward — cancellation_rate_pct + skipped_stop_rate_pct
      (MetricDisplay) each over a STABLE absolute completeness bar + the honest
      "X of Y" raw counts, plus the prominent ramp-in caveat.
    - "fit" sub-block (copy.clusters.crowding): the trailing-window occupancy mix as
      a 100%-stacked proportion bar (StackedBar, scale='occupancy') + the dominant
      band lifted to a MetricDisplay headline.

  PRIMARY (always visible): both rate tiles + their completeness bars + fractions,
  the ramp-in note, the occupancy-mix bar + dominant tile.

  DETAIL (one progressive-disclosure expander): the delay-by-crowding magnitude
  bars, the weekday-vs-weekend occupancy 2-col, and the per-ISO-weekday occupancy
  small multiple.

  HONESTY DOCTRINE upheld verbatim from both sources:
    - S7: a flat ~0% rate sparkline conveyed nothing → completeness bars ride a FIXED
      absolute % domain (the same share renders the same length every visit), never
      a per-chart zoom; every data mark rides the dataviz scale (amber "late" voice
      for problem-rates, the occupancy scale for the mix), NEVER --primary.
    - RAMP-IN shown PROMINENTLY (copy.strip.rampInNote): history accrues forward, no
      backfill — an early low number is not "good".
    - occupancy_mix is null when there is no telemetry; the VM resolves that (and an
      all-zero mix) to a null dominant — we render the explicit AbsentValue chip,
      never a fabricated bar or an even split.
    - number | null guarded everywhere; null means "no data", never 0. Each half /
      chart / cell self-handles its own absence.
    - Whole-section honest empty: BOTH service.isEmpty AND crowding dominant == null
      → one AbsentValue block.

  Band labels reuse the canonical `lines` detail copy (detailCopy[locale].occupancyBands)
  so the vocabulary stays DRY across surfaces.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { SeverityCode } from '$lib/v1/schemas';
	import { fmtPct, fmtCount, fmtDelayMin as sharedFmtDelayMin } from '$lib/utils';
	import { MetricDisplay, SectionLabel } from '$lib/components/brand';
	import { AbsentValue } from '$lib/components/edge';
	import { SeverityBar, StackedBar, type StackedSegment } from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import {
		CANCEL_RATE_DOMAIN,
		SKIPPED_RATE_DOMAIN,
		weekdayLabel,
	} from '$lib/features/reliability/shiftGrains';
	import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas';
	import { selectCrowdingDelay } from '../selectors/crowdingDelay';
	import { detailCopy } from '../../lines.copy';
	import type { ServiceDeliveredVM, CrowdingVM } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';
	import Detail from '$lib/components/shared/Detail.svelte';

	interface Section3RunAndFitProps {
		/** The 03 Service-delivered slice of the cluster view-model (the "will it run?" half). */
		service: ServiceDeliveredVM;
		/** The 04-crowding view-model (the "will you fit?" half). */
		crowding: CrowdingVM;
		/** Active locale (FR canonical), threaded in, not looked up here. */
		locale: Locale;
		/** The co-located reliability copy bundle for this locale. */
		copy: ReliabilityCopy;
		/**
		 * The grain rail's active-window label (Today / This week / This month / Date
		 * range). The rate completeness + occupancy mix follow the selected grain, so
		 * this caption names the window. Falls back to the fixed window copy when not
		 * threaded (isolated render).
		 */
		windowLabel?: string;
	}

	let { service, crowding, locale, copy, windowLabel }: Section3RunAndFitProps = $props();

	// ── Shared explainer (i) wiring ────────────────────────────────────────────
	// The in-app metric-explainer (i) affordance: the one-line tip + a localized
	// deep link to /metrics#<anchor>. An INTERACTIVE control beside each label.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// ── "Will it run?" half (Cluster03 — service delivered) ─────────────────────
	// A problem-rate is the late/amber voice on the dataviz scale (never --primary).
	const RATE_VAR = 'var(--dataviz-status-late)';
	// S7: a flat sparkline of a ~0% rate conveys nothing. The completeness bar uses a
	// STABLE absolute % domain (0% reads as an empty bar = good news) plus the raw
	// "X of Y" counts. The domains are the STRUCTURAL [0,100] percentage scale from
	// the shared module — never an inline per-chart zoom.
	const RATE_SEVERITY: SeverityCode = 'watch';

	/** Format a rate as a percentage, else null (the muted no-data label). */
	const pct = (v: number | null): string | null => fmtPct(v, { rounding: 'fixed1' });

	// Headline rate = the grain-windowed rate the mapper already computed (the SAME
	// number the snapshot strip shows), so picking Today / week / month moves this
	// tile in lockstep with the strip.
	const cancellationRatePct = $derived(service.cancellationRatePct);
	const skippedStopRatePct = $derived(service.skippedStopRatePct);

	/** Sum a count pair over the window → {part, total, sharePct}; null when none observed. */
	function completeness<T>(
		rows: readonly T[],
		part: (r: T) => number | null | undefined,
		whole: (r: T) => number | null | undefined,
	): { part: number; total: number; sharePct: number } | null {
		let partSum = 0,
			total = 0,
			any = false;
		for (const r of rows) {
			const w = whole(r);
			if (w != null) {
				total += w;
				partSum += part(r) ?? 0;
				any = true;
			}
		}
		return any && total > 0 ? { part: partSum, total, sharePct: (partSum / total) * 100 } : null;
	}

	const cancellation = $derived(
		completeness(
			service.cancellations,
			(c) => c.canceled_trip_days,
			(c) => c.total_trip_days,
		),
	);
	const skipped = $derived(
		completeness(
			service.skippedStops,
			(s) => s.skipped_stop_count,
			(s) => s.stop_time_update_count,
		),
	);

	const t = $derived(copy.strip);
	// Grouped thousands separators (locale-aware: "3,975" en / "3 975" fr) so the
	// raw "X of Y" counts read cleanly instead of "3975" / "20189695".
	const num = (v: number): string => fmtCount(v, { locale }) ?? `${v}`;

	// ── "Will you fit?" half (Cluster04 — crowding) ─────────────────────────────
	/** Canonical occupancy band labels (legend + a11y), keyed by OccupancyCode. */
	const bands = $derived(detailCopy[locale].occupancyBands);

	// S7: the GRAIN-AWARE mix — the occupancy_by_grain entry the mapper already
	// resolved for the selected grain, falling back to the scalar trailing-window mix
	// (older snapshots / a grain with no telemetry). The headline + bar follow the
	// rail's grain through this single derived.
	const activeMix = $derived(crowding.mixByGrain ?? crowding.mix);

	/** Build the five occupancy bands as StackedBar segments (fractions 0..1). */
	const toSegments = (mix: typeof crowding.mix): StackedSegment[] =>
		OCCUPANCY_CODES.map((code: OccupancyCode) => ({
			code,
			value: mix ? mix[code] : null,
			label: bands[code],
		}));
	const mixHasShare = (mix: typeof crowding.mix): boolean =>
		mix != null && OCCUPANCY_CODES.some((code) => (mix[code] ?? 0) > 0);

	/** The (grain-aware) headline occupancy bar segments. */
	const segments = $derived<StackedSegment[]>(toSegments(activeMix));

	// S7 §04: weekday (ISO 1-5) vs weekend (ISO 6-7) occupancy split, a 2-col small
	// multiple. The mapper folds the per-ISO-weekday shares into one weekday + one
	// weekend mix; null when occupancy_by_dow is absent (then the sub-block is omitted).
	const weekdayWeekendCols = $derived.by(() => {
		const ww = crowding.weekdayWeekend;
		if (!ww) return null;
		return {
			weekday: { segs: toSegments(ww.weekday), has: mixHasShare(ww.weekday) },
			weekend: { segs: toSegments(ww.weekend), has: mixHasShare(ww.weekend) },
		};
	});

	// P11 §04: the per-ISO-weekday occupancy SMALL MULTIPLE — up to 7 stacked strips,
	// Mon→Sun, each its own occupancy StackedBar (the same primitive + scale as the
	// headline mix). The mapper hands a FIXED 1..7 frame; a weekday with no telemetry
	// (mix:null OR all-zero shares) carries `has: false` so its cell renders the honest
	// AbsentValue chip in the SAME box, never a fabricated bar or a dropped strip. null
	// when occupancy_by_dow is absent → the small-multiple is omitted entirely.
	const weekdayStrips = $derived.by(() => {
		const rows = crowding.byWeekday;
		if (!rows) return null;
		return rows.map((d) => ({
			iso: d.iso,
			label: weekdayLabel(d.iso, locale),
			segs: toSegments(d.mix),
			has: mixHasShare(d.mix),
		}));
	});

	/** Total band share (guards the dominant-band headline + share math). */
	const total = $derived(
		segments.reduce((sum, s) => sum + (s.value != null && s.value > 0 ? s.value : 0), 0),
	);

	/** The largest band — lifted to a MetricDisplay as the single-glance read. */
	const dominant = $derived.by(() => {
		if (total <= 0) return null;
		let best: { code: OccupancyCode; label: string; share: number } | null = null;
		for (const code of OCCUPANCY_CODES) {
			const v = activeMix ? activeMix[code] : null;
			if (v == null || v <= 0) continue;
			if (best == null || v > best.share) best = { code, label: bands[code], share: v };
		}
		return best;
	});

	/** Dominant-band share as a whole-percent string (e.g. "62%"). */
	const dominantPct = $derived(dominant ? `${Math.round((dominant.share / total) * 100)}%` : null);

	// The in-app metric-explainer (i) for the occupancy band: the one-line tip + a
	// localized deep link to /metrics#occupancy. An INTERACTIVE control beside the
	// label, never a data mark.
	const occupancyInfo = $derived.by(() => {
		const i = metricInfoFor('occupancy', locale);
		return {
			...i,
			label: explainerCopy.info.trigger(copy.clusters.crowding),
			linkLabel: explainerCopy.info.link,
		};
	});
	// The dominant-band tile's own (i): same occupancy tip + deep link, but a distinct
	// aria-label naming THAT band (e.g. "About Crushed") so the trigger beside the
	// headline never collides with the cluster-heading (i) above.
	const dominantInfo = $derived.by(() => {
		const i = metricInfoFor('occupancy', locale);
		return {
			...i,
			label: explainerCopy.info.trigger(dominant?.label ?? copy.clusters.crowding),
			linkLabel: explainerCopy.info.link,
		};
	});

	/* ── Delay by crowding (G1) ────────────────────────────────────────────────
	   Does crowding correlate with delay? The contract's per-band avg delay, laid
	   out on the FIXED occupancy axis (empty→full) so the reading is consistent and
	   honest about gaps. SPARSE: a band the contract omits, OR a present band whose
	   avg_delay is null, renders the explicit no-data message — NEVER a "·" or a
	   fake 0. Honest per-band absence is the explicit requirement. */
	const fmtMin = (v: number | null | undefined): string | null =>
		sharedFmtDelayMin(v, { rounding: 'fixed1' });

	// §04 delay-by-crowding MAGNITUDE BARS (A12) — selectCrowdingDelay owns the fixed
	// empty→full occupancy axis, the abs DELAY_POS_DOMAIN, and the honest per-band absence
	// (an omitted/null band keeps its labelled row but reads "no data", never a fake-0 bar).
	// "More crowded → more delay" reads as a downward slope, and the same delay renders the
	// same length as the worst-stops list. The p50-typical + sample n ride the hover tooltip
	// via `note`. Rendered through the ONE <Chart> (it shows the honest-absence chip itself
	// when no band has a measured delay).
	const crowdingDelay = $derived(
		selectCrowdingDelay(crowding.delayByCrowding, locale, {
			title: copy.delayByCrowding.heading,
			xLabel: copy.strip.avgDelayMin,
			unit: copy.units.min,
			bandLabel: (code) => bands[code],
			noDataMarker: copy.strip.noData,
			noteFor: (cell) => {
				const p50 = fmtMin(cell.p50_min);
				const n = cell.observation_count ?? null;
				const typical = p50 ? copy.delayByCrowding.typical(p50) : null;
				const nNote = n != null ? `n=${n}` : null;
				return [typical, nNote].filter(Boolean).join(' · ') || undefined;
			},
		}),
	);

	// ── Whole-section honest empty ──────────────────────────────────────────────
	// Nothing run- or fit-shaped to show at all: both the service half is empty AND
	// crowding resolves to a null dominant (no telemetry / all-zero mix). One styled
	// AbsentValue chip stands for the whole section.
	const sectionEmpty = $derived(service.isEmpty && dominant == null);
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

<section class="section" data-section="run-and-fit" aria-label={copy.sections.runAndFit.label}>
	<header class="section-head">
		<SectionLabel text={copy.sections.runAndFit.label} variant="station" />
		<p class="section-question" data-slot="section-question">{copy.sections.runAndFit.question}</p>
	</header>

	{#if sectionEmpty}
		<div data-slot="run-and-fit-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<!-- ── "Will it run?" sub-block (service delivered) ───────────────────── -->
		<div class="sub-block" data-slot="run-sub-block">
			<div class="sub-head">
				<SectionLabel text={copy.clusters.serviceDelivered} variant="metric" />
				<!-- Window caption: the rate histories cover the most-recent closed days. -->
				<p class="sub-window" data-slot="service-window">{windowLabel ?? copy.windows.trend}</p>
				<!-- RAMP-IN is the band's defining caveat → surfaced prominently at the top. -->
				<p class="sub-rampin" data-slot="ramp-in-note">{t.rampInNote}</p>
			</div>

			{#if service.isEmpty}
				<!-- Honest empty: the styled honest-absence chip (says WHY), no fabricated zero. -->
				<div data-slot="service-empty-note">
					<AbsentValue variant="block" reason="no-observations" {locale} />
				</div>
			{:else}
				<div class="run-metrics">
					<!-- Cancellations -->
					<article class="run-metric" data-slot="cancellations">
						<div class="metric-with-info">
							<MetricDisplay
								value={pct(cancellationRatePct)}
								emptyLabel={t.noData}
								absentReason="no-observations"
								{locale}
								label={t.cancellationRatePct}
								size="md"
							/>
							{@render metricInfo('cancellation', t.cancellationRatePct)}
						</div>
						{#if cancellation}
							<div class="run-completeness" data-slot="cancellations-completeness">
								<SeverityBar
									severity={RATE_SEVERITY}
									value={cancellation.sharePct}
									domain={CANCEL_RATE_DOMAIN}
									unit="%"
									colorVar={RATE_VAR}
									label={t.cancellationRatePct}
									interactive
								/>
								<p class="run-fraction">
									{t.cancellationFraction(num(cancellation.part), num(cancellation.total))}
								</p>
							</div>
						{:else}
							<div data-slot="cancellations-empty">
								<AbsentValue variant="block" reason="no-observations" {locale} />
							</div>
						{/if}
					</article>

					<!-- Skipped stops -->
					<article class="run-metric" data-slot="skipped-stops">
						<div class="metric-with-info">
							<MetricDisplay
								value={pct(skippedStopRatePct)}
								emptyLabel={t.noData}
								absentReason="no-observations"
								{locale}
								label={t.skippedStopRatePct}
								size="md"
							/>
							{@render metricInfo('skippedStop', t.skippedStopRatePct)}
						</div>
						{#if skipped}
							<div class="run-completeness" data-slot="skipped-stops-completeness">
								<SeverityBar
									severity={RATE_SEVERITY}
									value={skipped.sharePct}
									domain={SKIPPED_RATE_DOMAIN}
									unit="%"
									colorVar={RATE_VAR}
									label={t.skippedStopRatePct}
									interactive
								/>
								<p class="run-fraction">
									{t.skippedFraction(num(skipped.part), num(skipped.total))}
								</p>
							</div>
						{:else}
							<div data-slot="skipped-stops-empty">
								<AbsentValue variant="block" reason="no-observations" {locale} />
							</div>
						{/if}
					</article>
				</div>
			{/if}
		</div>

		<!-- ── "Will you fit?" sub-block (crowding) ───────────────────────────── -->
		<div class="sub-block" data-slot="fit-sub-block">
			<div class="sub-head">
				<span class="label-with-info">
					<SectionLabel
						id="run-and-fit-crowding-label"
						text={copy.clusters.crowding}
						variant="metric"
					/>
					<MetricInfo
						class="cluster-info"
						tip={occupancyInfo.tip}
						href={occupancyInfo.href}
						label={occupancyInfo.label}
						linkLabel={occupancyInfo.linkLabel}
						side="bottom"
					/>
				</span>
				<!-- Window caption: the occupancy mix is a fixed trailing window. -->
				<p class="sub-window" data-slot="crowding-window">
					{windowLabel ?? copy.windows.crowding}
				</p>
			</div>

			{#if dominant == null}
				<!-- Honest empty: the styled honest-absence chip (says WHY, no telemetry), never a fake bar. -->
				<div data-slot="crowding-empty">
					<AbsentValue variant="block" reason="no-observations" {locale} />
				</div>
			{:else}
				<div class="crowding-headline-row">
					<MetricDisplay
						value={dominantPct}
						emptyLabel={copy.strip.noData}
						absentReason="no-observations"
						{locale}
						label={dominant.label}
						size="lg"
						class="crowding-headline"
					/>
					<MetricInfo
						class="cluster-info"
						tip={dominantInfo.tip}
						href={dominantInfo.href}
						label={dominantInfo.label}
						linkLabel={dominantInfo.linkLabel}
						side="bottom"
					/>
				</div>
				<!-- Interactive: each band's share reveals on hover/focus (#11). -->
				<StackedBar
					scale="occupancy"
					{segments}
					label={copy.clusters.crowding}
					size="sm"
					legend
					interactive
					class="crowding-bar"
				/>
			{/if}
		</div>

		<!-- ── DETAIL — the analyst layer, one progressive-disclosure deep ───────
		     delay-by-crowding + weekday/weekend split + per-ISO-weekday small multiple. -->
		<Detail label={copy.sections.detailShow} labelOpen={copy.sections.detailHide}>
			<!-- Delay by crowding (G1): per-band avg delay on the fixed occupancy axis.
			     Rendered independently of the mix empty-state so a route with delay data
			     but no mix still surfaces it. SPARSE: an absent band or a null delay shows
			     the honest no-data message in that cell, never a "·" / fake 0. -->
			<div class="crowding-delay" data-slot="delay-by-crowding">
				<SectionLabel text={copy.delayByCrowding.heading} variant="metric" />
				<!-- A12 magnitude bars on the fixed occupancy axis; the <Chart> renders the
				     honest-absence chip itself when no band carries a measured delay. -->
				<Chart spec={crowdingDelay.spec} />
			</div>

			{#if weekdayWeekendCols}
				<!-- S7 §04: weekday vs weekend occupancy split — a 2-col small multiple that
				     reflows to a single column on mobile. Each side is its own occupancy
				     StackedBar, or an honest no-data chip when that side has no telemetry. -->
				<div class="crowding-2col" data-slot="crowding-weekday-weekend">
					<SectionLabel text={copy.peak.dayType} variant="metric" />
					<div class="crowding-2col-grid">
						<div class="crowding-2col-cell" data-slot="crowding-weekday">
							<span class="crowding-2col-label">{copy.peak.weekday}</span>
							{#if weekdayWeekendCols.weekday.has}
								<StackedBar
									scale="occupancy"
									segments={weekdayWeekendCols.weekday.segs}
									label={copy.peak.weekday}
									size="sm"
									interactive
								/>
							{:else}
								<AbsentValue variant="block" reason="no-observations" {locale} />
							{/if}
						</div>
						<div class="crowding-2col-cell" data-slot="crowding-weekend">
							<span class="crowding-2col-label">{copy.peak.weekend}</span>
							{#if weekdayWeekendCols.weekend.has}
								<StackedBar
									scale="occupancy"
									segments={weekdayWeekendCols.weekend.segs}
									label={copy.peak.weekend}
									size="sm"
									interactive
								/>
							{:else}
								<AbsentValue variant="block" reason="no-observations" {locale} />
							{/if}
						</div>
					</div>
				</div>
			{/if}

			{#if weekdayStrips}
				<!-- P11 §04: per-ISO-weekday occupancy small multiple — up to 7 stacked strips,
				     Mon→Sun, on the SAME occupancy scale as the headline mix. A weekday with no
				     telemetry renders the honest no-data chip in the same box height, never a
				     fabricated bar. Reflows to fewer columns on narrow viewports. -->
				<div class="crowding-dow" data-slot="crowding-by-dow">
					<SectionLabel text={copy.byDow.heading} variant="metric" />
					<p class="crowding-dow-caption">{copy.byDow.caption}</p>
					<ul class="crowding-dow-grid" aria-label={copy.byDow.heading}>
						{#each weekdayStrips as day (day.iso)}
							<li class="crowding-dow-cell" data-slot="crowding-dow-cell" data-iso={day.iso}>
								<span class="crowding-dow-label">{day.label}</span>
								{#if day.has}
									<StackedBar
										scale="occupancy"
										segments={day.segs}
										label={day.label}
										size="sm"
										interactive
									/>
								{:else}
									<AbsentValue variant="block" reason="no-observations" {locale} />
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</Detail>
	{/if}
</section>

<style>
	/* Section rhythm: generous BETWEEN-block air (research: within ≤ between), all on
	   the 8px grid. The section owns its inner stack; the orchestrator owns the
	   between-section gap. */
	.section {
		display: flex;
		flex-direction: column;
		gap: clamp(1.25rem, 3vw, 2rem);
		width: 100%;
	}
	.section-head {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	/* The rider question — the section's plain-language frame, quiet under the overline. */
	.section-question {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-subheading);
		font-weight: 600;
		line-height: 1.3;
		color: var(--foreground);
		max-inline-size: 42ch;
	}

	/* Each rider-answer sub-block (run / fit) owns its own inner stack. */
	.sub-block {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.sub-head {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	/* The ramp-in caveat: quiet mono caption, but always present + legible (AA). */
	.sub-rampin {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* Window caption: quiet mono, same register as the ramp-in note. */
	.sub-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}

	/* S7: each rate metric gets its OWN full-width row (single column at every width)
	   so the completeness reads have room — no longer two cramped cards per row. */
	.run-metrics {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: 1fr;
	}
	/* Completeness read: the share bar over the honest "X of Y" raw-count fraction. */
	.run-completeness {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.run-fraction {
		margin: 0;
		font-size: var(--text-caption, 0.8125rem);
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.run-metric {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
		box-shadow: var(--shadow-card);
	}
	/* A metric tile + its explainer (i), kept on the tile's top edge. The tile keeps
	   a measure (min-width:0) so a long label wraps cleanly; the (i) wrapper never
	   shrinks (flex:none) so the glyph stays whole beside it, never colliding. */
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

	/* The fit sub-block's heading + its explainer (i), kept centred on the label. The
	   label keeps a measure (min-width:0) so a long overline wraps cleanly; the (i)
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

	/* The dominant-band headline + its explainer (i), kept on the tile's top edge.
	   The tile keeps a measure (min-width:0) so a long band label wraps cleanly; the
	   (i) wrapper never shrinks (flex:none) so the glyph stays whole beside it. */
	.crowding-headline-row {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.35rem;
	}
	.crowding-headline-row :global([data-slot='metric-display']) {
		min-width: 0;
	}
	.crowding-headline-row :global(.cluster-info) {
		flex: none;
	}

	/* Delay-by-crowding sub-block: a quiet ranked-by-axis list (band label + its
	   avg delay), seated with its own overline. */
	.crowding-delay {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
	}

	/* S7 weekday/weekend 2-col: auto-fit so it's two columns on desktop and reflows
	   to a single column on mobile (each cell needs ~14rem before it shares a row). */
	.crowding-2col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: var(--spacing-3, 0.75rem);
	}
	.crowding-2col-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		gap: 1rem 1.5rem;
	}
	.crowding-2col-cell {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.crowding-2col-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}

	/* P11 per-ISO-weekday small multiple: a Mon→Sun grid of occupancy strips. auto-fit
	   so it packs as many ~9rem strips per row as fit (≈7 on a wide cluster, fewer on
	   narrow), each cell its own label + bar (or honest no-data chip). 8px-grid gaps. */
	.crowding-dow {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: var(--spacing-3, 0.75rem);
	}
	.crowding-dow-caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.crowding-dow-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.crowding-dow-cell {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.crowding-dow-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>

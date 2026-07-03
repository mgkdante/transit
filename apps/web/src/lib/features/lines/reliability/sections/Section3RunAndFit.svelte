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
	import { fmtPct, fmtCount, fmtDelayMin as sharedFmtDelayMin } from '$lib/utils';
	import { SectionLabel } from '$lib/components/brand';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import { ChartLegend } from '$lib/components/dataviz';
	import { occupancyVar } from '$lib/components/dataviz/tokens';
	import { Chart } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import {
		CANCEL_RATE_DOMAIN,
		SKIPPED_RATE_DOMAIN,
		SHARE_DOMAIN,
		weekdayLabel,
	} from '$lib/features/reliability/shiftGrains';
	import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas';
	import { selectCrowdingDelay } from '../selectors/crowdingDelay';
	import { selectBullet } from '../selectors/bullet';
	import { selectOccupancyShare } from '../selectors/occupancyShare';
	import { detailCopy } from '../../lines.copy';
	import type { ServiceDeliveredVM, CrowdingVM } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';
	import Detail from '$lib/components/shared/Detail.svelte';
	import MetricBullet from './MetricBullet.svelte';

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
	// S7: a flat sparkline of a ~0% rate conveys nothing. The KPI bullet rides a STABLE
	// absolute [0,100] % domain (0% reads as an empty bar = good news) plus the raw
	// "X of Y" counts in its caption. The domains are the STRUCTURAL percentage scale
	// from the shared module — never an inline per-chart zoom.

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
			const p = part(r);
			// Skip a row whose numerator is UNKNOWN (null/NaN) — matching clusters.ts pooledRate — so
			// the "X of Y" caption sums the exact same rows as the pooled rate tile and the two can
			// NEVER disagree (a null numerator is not a real 0; coercing it to 0 would diverge them).
			if (w == null || w <= 0 || p == null || Number.isNaN(p)) continue;
			total += w;
			partSum += p;
			any = true;
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

	/** Resolve a band's human label for the share strip + legend. */
	const bandLabel = (code: OccupancyCode): string => bands[code];
	/** Sum the positive band shares of a mix (guards the dominant math). */
	const mixTotal = (mix: typeof crowding.mix): number =>
		mix ? OCCUPANCY_CODES.reduce((s, c) => s + ((mix[c] ?? 0) > 0 ? (mix[c] as number) : 0), 0) : 0;

	/** The (grain-aware) headline occupancy mix as a 100%-stacked LayerChart share strip.
	    selectOccupancyShare returns null on no telemetry / all-zero mix (→ honest absence). */
	const mixShareSpec = $derived(
		selectOccupancyShare(activeMix, locale, { title: copy.clusters.crowding, label: bandLabel }),
	);

	// S7 §04: weekday (ISO 1-5) vs weekend (ISO 6-7) occupancy split, a 2-col small multiple.
	// Each side is its own share strip (or null → the honest no-data chip in the cell).
	const weekdayWeekendCols = $derived.by(() => {
		const ww = crowding.weekdayWeekend;
		if (!ww) return null;
		return {
			weekday: selectOccupancyShare(ww.weekday, locale, {
				title: copy.peak.weekday,
				label: bandLabel,
			}),
			weekend: selectOccupancyShare(ww.weekend, locale, {
				title: copy.peak.weekend,
				label: bandLabel,
			}),
		};
	});

	// P11 §04: the per-ISO-weekday occupancy SMALL MULTIPLE — up to 7 share strips, Mon→Sun,
	// the same mark + scale as the headline mix. The mapper hands a FIXED 1..7 frame; a weekday
	// with no telemetry resolves to a null spec → its cell renders the honest AbsentValue chip
	// in the SAME box, never a fabricated bar or a dropped strip.
	const weekdayStrips = $derived.by(() => {
		const rows = crowding.byWeekday;
		if (!rows) return null;
		return rows.map((d) => ({
			iso: d.iso,
			label: weekdayLabel(d.iso, locale),
			spec: selectOccupancyShare(d.mix, locale, {
				title: weekdayLabel(d.iso, locale),
				label: bandLabel,
			}),
		}));
	});

	/** Total band share (guards the dominant-band headline + share math). */
	const total = $derived(mixTotal(activeMix));

	/** Headline-mix legend — band swatch + share %, paired with the colour (a11y). */
	const mixLegend = $derived(
		(mixShareSpec?.segments ?? []).map((s) => ({
			colorVar: occupancyVar((s.occupancy ?? 'empty') as OccupancyCode),
			label: `${s.label} ${Math.round(s.share)}%`,
			swatch: 'square' as const,
		})),
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

	/** Dominant-band share as a whole-percent number + string (e.g. 62 / "62%"). */
	const dominantSharePct = $derived(dominant ? (dominant.share / total) * 100 : null);
	const dominantPct = $derived(
		dominantSharePct != null ? `${Math.round(dominantSharePct)}%` : null,
	);

	// ── KPI bullets — each headline rate gets a scale-context bullet beneath its number
	// (the "every KPI is a LayerChart mark" mandate, reusing §0's MetricBullet). Both
	// problem-rates ride the amber "late" voice (tone='warn', matching the old RATE_VAR)
	// on the fixed [0,100] percentage scale, so a near-empty bar honestly reads "rare".
	// A null rate renders the styled absence chip + NO bar (never a fabricated 0-length).
	const cancellationBullet = $derived(
		selectBullet(cancellationRatePct, locale, {
			title: t.cancellationRatePct,
			xLabel: t.cancellationRatePct,
			unit: copy.units.pct,
			domain: CANCEL_RATE_DOMAIN,
			tone: 'warn',
		}),
	);
	const skippedBullet = $derived(
		selectBullet(skippedStopRatePct, locale, {
			title: t.skippedStopRatePct,
			xLabel: t.skippedStopRatePct,
			unit: copy.units.pct,
			domain: SKIPPED_RATE_DOMAIN,
			tone: 'warn',
		}),
	);
	// The dominant occupancy band: how much of the mix that single band owns, on the fixed
	// [0,100] share scale. Neutral tone — crowding is not "good/bad", the band label carries
	// the identity. Null when there's no telemetry (the tile shows the honest absence chip).
	const dominantBullet = $derived(
		selectBullet(dominantSharePct, locale, {
			title: dominant?.label ?? copy.clusters.crowding,
			xLabel: dominant?.label ?? copy.clusters.crowding,
			unit: copy.units.pct,
			domain: SHARE_DOMAIN,
			tone: 'neutral',
		}),
	);

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

<!-- Per-KPI explainer snippets — the (i) trigger MetricBullet renders beside each tile label. -->
{#snippet cancellationInfo()}{@render metricInfo('cancellation', t.cancellationRatePct)}{/snippet}
{#snippet skippedInfo()}{@render metricInfo('skippedStop', t.skippedStopRatePct)}{/snippet}
{#snippet dominantBandInfo()}
	<MetricInfo
		class="cluster-info"
		tip={dominantInfo.tip}
		href={dominantInfo.href}
		label={dominantInfo.label}
		linkLabel={dominantInfo.linkLabel}
		side="bottom"
	/>
{/snippet}

<CollapsibleSection
	dataSection="run-and-fit"
	number={4}
	eyebrow={copy.sections.runAndFit.label}
	question={copy.sections.runAndFit.question}
>
	{#if sectionEmpty}
		<div data-slot="run-and-fit-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<!-- ── "Will it run?" sub-block (service delivered) ───────────────────── -->
		<div class="sub-block" data-slot="run-sub-block" data-card>
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
					<!-- Cancellations — text-led rate number + a LayerChart bullet on the fixed
					     [0,100] scale; the honest "X of Y" raw count rides the caption. -->
					<MetricBullet
						label={t.cancellationRatePct}
						valueText={pct(cancellationRatePct)}
						spec={cancellationBullet}
						{locale}
						info={cancellationInfo}
						caption={cancellation
							? t.cancellationFraction(num(cancellation.part), num(cancellation.total))
							: undefined}
						data-slot="cancellations"
					/>

					<!-- Skipped stops -->
					<MetricBullet
						label={t.skippedStopRatePct}
						valueText={pct(skippedStopRatePct)}
						spec={skippedBullet}
						{locale}
						info={skippedInfo}
						caption={skipped ? t.skippedFraction(num(skipped.part), num(skipped.total)) : undefined}
						data-slot="skipped-stops"
					/>
				</div>
			{/if}
		</div>

		<!-- ── "Will you fit?" sub-block (crowding) ───────────────────────────── -->
		<div class="sub-block" data-slot="fit-sub-block" data-card>
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
				<!-- Dominant band — text-led share number + a LayerChart bullet on the fixed
				     [0,100] share scale (neutral tone; the band label carries the identity). -->
				<MetricBullet
					label={dominant.label}
					valueText={dominantPct}
					spec={dominantBullet}
					{locale}
					size="lg"
					info={dominantBandInfo}
					data-slot="dominant-band"
				/>
				<!-- The mix as a 100%-stacked LayerChart share strip + a labelled legend (the
				     colour is paired with each band's name + share, never hue alone). -->
				{#if mixShareSpec}
					<div class="crowding-bar" data-slot="crowding-mix">
						<Chart spec={mixShareSpec} />
						<ChartLegend items={mixLegend} />
					</div>
				{/if}
			{/if}
		</div>

		<!-- ── DETAIL — the analyst layer, one progressive-disclosure deep ───────
		     delay-by-crowding + weekday/weekend split + per-ISO-weekday small multiple. -->
		<Detail label={copy.sections.detailShow} labelOpen={copy.sections.detailHide}>
			<!-- Delay by crowding (G1): per-band avg delay on the fixed occupancy axis.
			     Rendered independently of the mix empty-state so a route with delay data
			     but no mix still surfaces it. SPARSE: an absent band or a null delay shows
			     the honest no-data message in that cell, never a "·" / fake 0. -->
			<div class="crowding-delay" data-slot="delay-by-crowding" data-card>
				<SectionLabel text={copy.delayByCrowding.heading} variant="metric" />
				<!-- A12 magnitude bars on the fixed occupancy axis; the <Chart> renders the
				     honest-absence chip itself when no band carries a measured delay. FIX-3: the
				     per-band delay is now TRULY co-observed (each delay row carries its own vehicle's
				     occupancy), so the old "day-level, not per-trip" caveat no longer applies. -->
				<Chart spec={crowdingDelay.spec} />
			</div>

			{#if weekdayWeekendCols}
				<!-- S7 §04: weekday vs weekend occupancy split — a 2-col small multiple that
				     reflows to a single column on mobile. Each side is its own occupancy
				     StackedBar, or an honest no-data chip when that side has no telemetry. -->
				<div class="crowding-2col" data-slot="crowding-weekday-weekend" data-card>
					<SectionLabel text={copy.peak.dayType} variant="metric" />
					<div class="crowding-2col-grid">
						<div class="crowding-2col-cell" data-slot="crowding-weekday">
							<span class="crowding-2col-label">{copy.peak.weekday}</span>
							{#if weekdayWeekendCols.weekday}
								<Chart spec={weekdayWeekendCols.weekday} />
							{:else}
								<AbsentValue variant="block" reason="no-observations" {locale} />
							{/if}
						</div>
						<div class="crowding-2col-cell" data-slot="crowding-weekend">
							<span class="crowding-2col-label">{copy.peak.weekend}</span>
							{#if weekdayWeekendCols.weekend}
								<Chart spec={weekdayWeekendCols.weekend} />
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
				<div class="crowding-dow" data-slot="crowding-by-dow" data-card>
					<SectionLabel text={copy.byDow.heading} variant="metric" />
					<p class="crowding-dow-caption">{copy.byDow.caption}</p>
					<ul class="crowding-dow-grid" aria-label={copy.byDow.heading}>
						{#each weekdayStrips as day (day.iso)}
							<li class="crowding-dow-cell" data-slot="crowding-dow-cell" data-iso={day.iso}>
								<span class="crowding-dow-label">{day.label}</span>
								{#if day.spec}
									<Chart spec={day.spec} />
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
</CollapsibleSection>

<style>
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

	/* KPI tiles: a responsive RAM grid (the same rhythm as §0's verdict KPIs), never
	   below one column on a phone. Each tile is a MetricBullet (number + scale bullet). */
	.run-metrics {
		display: grid;
		gap: var(--space-card-gap, 1rem);
		grid-template-columns: repeat(auto-fit, minmax(min(13rem, 100%), 1fr));
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
	/* S7 polish (operator: crowding strips read as an ugly vertical wall): one full-width
	   HORIZONTAL row per day, Mon→Sun stacked, so the occupancy strips are directly
	   comparable + the week reads as a timeline (not a grid of narrow columns). */
	.crowding-dow-grid {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.crowding-dow-cell {
		display: grid;
		grid-template-columns: 6.5rem 1fr;
		align-items: center;
		gap: 0.85rem;
		min-width: 0;
	}
	.crowding-dow-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		white-space: nowrap;
	}
</style>

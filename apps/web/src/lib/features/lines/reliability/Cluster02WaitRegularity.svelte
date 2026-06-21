<!--
  Cluster02WaitRegularity, the "02 Wait & regularity" band of the slice-9.6
  historic Reliability surface.

  Reads two contract slices, both guarded by the foundation VM mapper:
    · headway[]       (WaitRegularityVM), scheduled-vs-observed headway +
      excess wait per shift, plus the regularity readings (CoV, bunched %).
    · service_spans[] (ServiceSpanPeriod[]), the most-recent service-span day:
      first/last trip span (min) + first/last-trip punctuality.

  Per shift we render a RankedRow whose SeverityBar encodes EXCESS WAIT
  (normalized within the band) as the magnitude, the rider-felt penalty over
  the scheduled gap. The bar colour is a SeverityCode (the dataviz severity
  scale only), never --primary. Scheduled / observed / excess-wait sit beside it
  as MetricDisplays; CoV + bunched % are the regularity caption.

  DOCTRINE upheld here:
    · every data mark rides the dataviz scale (SeverityBar owns that); --primary
      stays interactive-only.
    · honest empties, when headway is empty we render the band's no-data note,
      not a zeroed bar; same for the service-span sub-block. A null metric shows
      "—", never a fabricated 0.
  Bilingual: FR is canonical; band-local labels are co-located below and the
  shared honest-state notes + cluster overline come from the passed copy.
  Reduced-motion is honoured by the primitives (SeverityBar guards its own
  transition).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { SeverityCode, ServiceSpanPeriod } from '$lib/v1';
	import { RankedRow } from '$lib/components/dataviz';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		metricInfoFor,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { WaitRegularityVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';
	import { shiftLabel as baseShiftLabel } from '$lib/features/reliability/shiftGrains';

	export interface Cluster02WaitRegularityProps {
		/** The wait-regularity VM (headway rows carrying a signal, contract order). */
		wait: WaitRegularityVM;
		/**
		 * Service-span history (foundation VM: only rows carrying a signal). The
		 * band reads the most-recent row for the span + first/last punctuality
		 * block. Empty array → the sub-block is omitted with no fabrication.
		 */
		serviceSpans?: ServiceSpanPeriod[];
		/** Active locale (FR canonical). */
		locale: Locale;
		/** The shared reliability copy, cluster overline + honest-state notes. */
		copy: ReliabilityCopy;
	}

	let { wait, serviceSpans = [], locale, copy }: Cluster02WaitRegularityProps = $props();

	/* ── band-local copy ──────────────────────────────────────────────────────
	   Labels this band needs that are NOT in the shared copy live here, co-located
	   and bilingual (FR canonical). The plain wait-regularity term microcopy
	   (scheduled gap / observed gap / excess wait / spread / clumped) lives in the
	   shared `copy.regularityTerms`; the cluster overline + the ramp-in / no-data
	   notes are read from the passed `copy` so the surface stays the one source of
	   truth for those. */
	interface BandCopy {
		readonly headwaySection: string;
		/** Composes the per-shift CoV/bunching reading from the shared term words. */
		readonly regularityReading: (
			spread: string,
			cov: string,
			clumped: string,
			bunched: string,
		) => string;
		readonly spanSection: string;
		readonly serviceSpan: string;
		readonly firstTripDelay: string;
		readonly lastTripDelay: string;
		readonly tripCount: string;
		/** a11y prefix for the per-shift excess-wait magnitude bar. */
		readonly excessWaitMagnitude: (shift: string) => string;
		/** "more detail" reveal label for the per-direction / weekend shift rows. */
		readonly moreDetail: string;
		/** Heading for the per-direction observed-gap comparison inside the reveal. */
		readonly directionGap: string;
	}

	const BAND_COPY: Record<Locale, BandCopy> = {
		fr: {
			headwaySection: 'Attente par période',
			regularityReading: (spread, cov, clumped, bunched) =>
				`${spread} ${cov} · ${clumped} ${bunched}`,
			spanSection: 'Plage de service',
			serviceSpan: 'Durée de service',
			firstTripDelay: 'Retard 1er départ',
			lastTripDelay: 'Retard dernier départ',
			tripCount: 'Voyages',
			excessWaitMagnitude: (shift) => `Attente excédentaire, ${shift}`,
			moreDetail: 'Plus de détail · intervalle observé par direction',
			directionGap: 'Intervalle observé par direction',
		},
		en: {
			headwaySection: 'Wait by shift',
			regularityReading: (spread, cov, clumped, bunched) =>
				`${spread} ${cov} · ${clumped} ${bunched}`,
			spanSection: 'Service span',
			serviceSpan: 'Span',
			firstTripDelay: 'First-trip delay',
			lastTripDelay: 'Last-trip delay',
			tripCount: 'Trips',
			excessWaitMagnitude: (shift) => `Excess wait, ${shift}`,
			moreDetail: 'More detail · observed gap by direction',
			directionGap: 'Observed gap by direction',
		},
	};

	const t = $derived(BAND_COPY[locale]);
	/** Plain-language term microcopy (shared, FR canonical). */
	const terms = $derived(copy.regularityTerms);
	const overline = $derived(copy.clusters.waitRegularity);
	const noData = $derived(copy.strip.noDataNote);

	// The in-app metric-explainer (i) affordance: the one-line tip + a localized
	// deep link to /metrics#<anchor>. An INTERACTIVE control beside each label.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey | SupplementalMetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	/* ── formatters (pure) ───────────────────────────────────────────────────
	   Absence → null (MetricDisplay renders the muted no-data label); inline
	   string consumers fall back to `valueNoData`. Never a bare "·", never 0. */
	const fmtMin = (v: number | null | undefined): string | null =>
		v == null ? null : `${v.toFixed(1)} min`;
	const fmtCov = (v: number | null | undefined): string | null => (v == null ? null : v.toFixed(2));
	const fmtPct = (v: number | null | undefined): string | null =>
		v == null ? null : `${Math.round(v)}%`;
	const fmtCount = (v: number | null | undefined): string | null => (v == null ? null : `${v}`);
	/** Short value-level no-data label for absent inline values + empty tiles. */
	const valueNoData = $derived(copy.strip.noData);

	/* ── headway rows → per-shift magnitude rows ───────────────────────────────
	   Magnitude = excess wait, normalized within the band's max so the bars stay
	   comparable across shifts (a relative read, not a fabricated absolute). The
	   severity band is derived from bunching: heavier bunching = a worse rider
	   experience. All purely from present fields; nulls stay null → empty bar. */
	const maxExcess = $derived(
		Math.max(0, ...wait.headway.map((h) => (h.excess_wait_min == null ? 0 : h.excess_wait_min))),
	);

	/** Bunching → severity band (glyph+colour via SeverityBar); null bunching = watch. */
	function severityFor(bunchedPct: number | null | undefined): SeverityCode {
		if (bunchedPct == null) return 'watch';
		if (bunchedPct >= 30) return 'critical';
		if (bunchedPct >= 15) return 'high';
		return 'watch';
	}

	interface ShiftRow {
		readonly shift: string;
		readonly scheduled: number | null;
		readonly observed: number | null;
		readonly excessWait: number | null;
		readonly cov: number | null;
		readonly bunched: number | null;
		/** [0,1] normalized excess wait, or null when no excess signal. */
		readonly magnitude: number | null;
		readonly severity: SeverityCode;
	}

	const shiftRows = $derived<ShiftRow[]>(
		wait.headway.map((h) => ({
			shift: h.shift,
			scheduled: h.scheduled_min ?? null,
			observed: h.observed_min ?? null,
			excessWait: h.excess_wait_min ?? null,
			cov: h.cov ?? null,
			bunched: h.bunched_pct ?? null,
			magnitude:
				h.excess_wait_min == null || maxExcess <= 0
					? null
					: Math.min(1, Math.max(0, h.excess_wait_min / maxExcess)),
			severity: severityFor(h.bunched_pct),
		})),
	);

	/* ── primary vs advanced shifts ────────────────────────────────────────────
	   The base periods (am/pm peak · midday · evening · night) show by default;
	   per-direction (`_dir*`) and weekend variants are a noisier advanced grain
	   tucked behind a "more detail" reveal, per the 9.6 control-spine doctrine
	   (advanced grains never crowd the headline). Raw shift keys decode to
	   readable, bilingual labels: the base am_peak/midday/… token resolves through
	   the SHARED shift vocabulary (so every surface speaks one language), and this
	   band keeps its own per-direction / weekend suffix decoration on top. */
	function shiftLabel(shift: string): string {
		const weekend = shift.includes('_weekend');
		const dir = shift.match(/_dir(\d)/)?.[1] ?? null;
		const base = shift.replace(/_dir\d/, '').replace(/_weekend/, '');
		const baseLabel = baseShiftLabel(base, locale);
		const extras: string[] = [];
		if (dir != null) extras.push(`dir ${dir}`);
		if (weekend) extras.push(locale === 'fr' ? 'fin de sem.' : 'weekend');
		return extras.length > 0 ? `${baseLabel} · ${extras.join(' · ')}` : baseLabel;
	}
	const isPrimaryShift = (shift: string): boolean =>
		!shift.includes('_dir') && !shift.includes('_weekend');
	const primaryRows = $derived(shiftRows.filter((r) => isPrimaryShift(r.shift)));
	const advancedRows = $derived(shiftRows.filter((r) => !isPrimaryShift(r.shift)));
	// Show primary by default; if a route only has advanced rows, surface those
	// in the open list rather than hiding everything behind the reveal.
	const mainRows = $derived(primaryRows.length > 0 ? primaryRows : advancedRows);
	const hasAdvancedReveal = $derived(primaryRows.length > 0 && advancedRows.length > 0);

	/* ── service span, the most-recent row carrying a signal ──────────────────
	   serviceSpans arrives in contract order (chronological); the foundation VM
	   has already dropped signal-less rows, so the tail is the latest day. */
	const latestSpan = $derived<ServiceSpanPeriod | null>(
		serviceSpans.length > 0 ? serviceSpans[serviceSpans.length - 1] : null,
	);
	const hasSpan = $derived(latestSpan != null);
</script>

{#snippet metricInfo(key: MetricKey | SupplementalMetricKey, name: string)}
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

<section class="cluster" data-cluster="wait-regularity" aria-label={overline}>
	<SectionLabel text={overline} variant="station" />

	{#if wait.isEmpty && !hasSpan}
		<!-- Honest empty: nothing to draw in either sub-block. -->
		<p class="cluster-empty">{noData}</p>
	{:else}
		<!-- Headway-by-shift sub-block. -->
		<div class="cluster-sub" data-sub="headway">
			<span class="label-with-info">
				<SectionLabel text={t.headwaySection} variant="metric" />
				{@render metricInfo('headway', t.headwaySection)}
				{@render metricInfo('regularityCov', copy.strip.headwayRegularityCov)}
			</span>
			{#snippet shiftItem(row: ShiftRow, i: number)}
				<li class="shift-row">
					<RankedRow
						rank={i + 1}
						title={shiftLabel(row.shift)}
						subtitle={t.regularityReading(
							terms.spread,
							fmtCov(row.cov) ?? valueNoData,
							terms.clumped,
							fmtPct(row.bunched) ?? valueNoData,
						)}
						severity={row.severity}
						value={row.magnitude}
						display={fmtMin(row.excessWait) ?? valueNoData}
						aria-label={t.excessWaitMagnitude(shiftLabel(row.shift))}
					/>
					<div class="shift-metrics">
						<MetricDisplay
							value={fmtMin(row.scheduled)}
							emptyLabel={valueNoData}
							label={terms.scheduledGap}
							size="sm"
						/>
						<MetricDisplay
							value={fmtMin(row.observed)}
							emptyLabel={valueNoData}
							label={terms.observedGap}
							size="sm"
						/>
						<MetricDisplay
							value={fmtMin(row.excessWait)}
							emptyLabel={valueNoData}
							label={terms.excessWait}
							size="sm"
						/>
					</div>
				</li>
			{/snippet}
			{#if shiftRows.length > 0}
				<ul class="shift-list" role="list">
					{#each mainRows as row, i (row.shift + '-' + i)}
						{@render shiftItem(row, i)}
					{/each}
				</ul>
				<!-- What the excess-wait magnitude encodes: 0 is the GOOD case, not missing. -->
				<p class="shift-caption" data-slot="excess-wait-caption">
					{copy.strip.excessWaitCaption}
					{@render metricInfo('excessWait', terms.excessWait)}
				</p>
				<!-- A3: per-direction rows carry ONLY observed_min (scheduled/excess/cov
				     null), so the SeverityBar + scheduled/excess tiles are empty for them.
				     Present them as a compact observed-gap-by-direction comparison instead
				     of an empty RankedRow, their only real signal. -->
				{#if hasAdvancedReveal}
					<details class="shift-more">
						<summary class="shift-more-summary">{t.moreDetail}</summary>
						<div class="shift-direction" data-slot="direction-gaps">
							<SectionLabel text={t.directionGap} variant="metric" />
							<div class="shift-metrics shift-metrics--direction">
								{#each advancedRows as row, ai (row.shift + '-' + ai)}
									<MetricDisplay
										value={fmtMin(row.observed)}
										emptyLabel={valueNoData}
										label={shiftLabel(row.shift)}
										size="sm"
									/>
								{/each}
							</div>
						</div>
					</details>
				{/if}
			{:else}
				<p class="cluster-empty">{noData}</p>
			{/if}
		</div>

		<!-- Service-span sub-block, only when a signal-carrying day exists. -->
		{#if hasSpan && latestSpan}
			<div class="cluster-sub" data-sub="service-span">
				<div class="span-head">
					<span class="label-with-info">
						<SectionLabel text={t.spanSection} variant="metric" />
						{@render metricInfo('serviceSpan', t.spanSection)}
					</span>
					<span class="span-window" data-slot="service-span-window">
						{copy.windows.serviceSpan(latestSpan.date ?? null)}
					</span>
				</div>
				<div class="shift-metrics">
					<div class="metric-with-info">
						<MetricDisplay
							value={fmtMin(latestSpan.service_span_min)}
							emptyLabel={valueNoData}
							label={t.serviceSpan}
							size="sm"
						/>
						{@render metricInfo('serviceSpan', t.serviceSpan)}
					</div>
					<div class="metric-with-info">
						<MetricDisplay
							value={fmtMin(latestSpan.first_trip_delay_min)}
							emptyLabel={valueNoData}
							label={t.firstTripDelay}
							size="sm"
						/>
						{@render metricInfo('serviceSpan', t.firstTripDelay)}
					</div>
					<div class="metric-with-info">
						<MetricDisplay
							value={fmtMin(latestSpan.last_trip_delay_min)}
							emptyLabel={valueNoData}
							label={t.lastTripDelay}
							size="sm"
						/>
						{@render metricInfo('serviceSpan', t.lastTripDelay)}
					</div>
					<div class="metric-with-info">
						<MetricDisplay
							value={fmtCount(latestSpan.trip_count)}
							emptyLabel={valueNoData}
							label={t.tripCount}
							size="sm"
						/>
						{@render metricInfo('serviceSpan', t.tripCount)}
					</div>
				</div>
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
	.cluster-sub {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* A sub-block overline + its explainer (i)s, kept on the label's baseline. */
	.label-with-info {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.cluster-empty {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.shift-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.shift-row {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.shift-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}
	/* A second-tier metric tile + its explainer (i), kept on the tile's top edge. */
	.metric-with-info {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.35rem;
	}
	/* What the excess-wait magnitude encodes (0 = on schedule, not missing). */
	.shift-caption {
		margin: 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* A3: the per-direction observed-gap comparison inside the reveal. */
	.shift-direction {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.shift-metrics--direction {
		gap: 1.5rem 1.25rem;
	}
	/* Service-span sub-block heading + its window label. */
	.span-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem 1rem;
	}
	.span-window {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	/* "More detail" reveal, the per-direction / weekend shifts, calm by default
	   so the headline shifts never get crowded. The +/− marker is an INTERACTION
	   accent (--primary belongs here, never on a data mark). */
	.shift-more {
		margin-top: 0.25rem;
	}
	.shift-more-summary {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		letter-spacing: 0.04em;
		color: var(--muted-foreground);
		list-style: none;
		padding: 0.35rem 0;
	}
	.shift-more-summary::-webkit-details-marker {
		display: none;
	}
	.shift-more-summary::before {
		content: '+';
		display: inline-grid;
		place-items: center;
		width: 1.15rem;
		height: 1.15rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm, 0.25rem);
		color: var(--primary);
		font-weight: 600;
		line-height: 1;
	}
	.shift-more[open] .shift-more-summary::before {
		content: '−';
	}
	.shift-more-summary:hover {
		color: var(--foreground);
	}
	.shift-more-summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.shift-more[open] .shift-direction {
		margin-top: 0.85rem;
	}
</style>

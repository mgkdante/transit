<!--
  Cluster02WaitRegularity — the "02 Wait & regularity" band of the slice-9.6
  historic Reliability surface.

  Reads two contract slices, both guarded by the foundation VM mapper:
    · headway[]       (WaitRegularityVM) — scheduled-vs-observed headway +
      excess wait per shift, plus the regularity readings (CoV, bunched %).
    · service_spans[] (ServiceSpanPeriod[]) — the most-recent service-span day:
      first/last trip span (min) + first/last-trip punctuality.

  Per shift we render a RankedRow whose SeverityBar encodes EXCESS WAIT
  (normalized within the band) as the magnitude — the rider-felt penalty over
  the scheduled gap. The bar colour is a SeverityCode (the dataviz severity
  scale only), never --primary. Scheduled / observed / excess-wait sit beside it
  as MetricDisplays; CoV + bunched % are the regularity caption.

  DOCTRINE upheld here:
    · every data mark rides the dataviz scale (SeverityBar owns that); --primary
      stays interactive-only.
    · honest empties — when headway is empty we render the band's no-data note,
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
	import type { WaitRegularityVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';

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
		/** The shared reliability copy — cluster overline + honest-state notes. */
		copy: ReliabilityCopy;
	}

	let { wait, serviceSpans = [], locale, copy }: Cluster02WaitRegularityProps = $props();

	/* ── band-local copy ──────────────────────────────────────────────────────
	   Labels this band needs that are NOT in the shared snapshot strip live here,
	   co-located and bilingual (FR canonical). The cluster overline + the ramp-in
	   / no-data notes are read from the passed `copy` so the surface stays the one
	   source of truth for those. */
	interface BandCopy {
		readonly headwaySection: string;
		readonly scheduled: string;
		readonly observed: string;
		readonly excessWait: string;
		readonly regularityReading: (cov: string, bunched: string) => string;
		readonly spanSection: string;
		readonly serviceSpan: string;
		readonly firstTripDelay: string;
		readonly lastTripDelay: string;
		readonly tripCount: string;
		/** a11y prefix for the per-shift excess-wait magnitude bar. */
		readonly excessWaitMagnitude: (shift: string) => string;
		/** "more detail" reveal label for the per-direction / weekend shift rows. */
		readonly moreDetail: string;
	}

	const BAND_COPY: Record<Locale, BandCopy> = {
		fr: {
			headwaySection: 'Attente par période',
			scheduled: 'Intervalle prévu',
			observed: 'Intervalle observé',
			excessWait: 'Attente excédentaire',
			regularityReading: (cov, bunched) => `CV ${cov} · groupés ${bunched}`,
			spanSection: 'Plage de service',
			serviceSpan: 'Durée de service',
			firstTripDelay: 'Retard 1er départ',
			lastTripDelay: 'Retard dernier départ',
			tripCount: 'Voyages',
			excessWaitMagnitude: (shift) => `Attente excédentaire — ${shift}`,
			moreDetail: 'Plus de détail · par direction et fin de semaine',
		},
		en: {
			headwaySection: 'Wait by shift',
			scheduled: 'Scheduled gap',
			observed: 'Observed gap',
			excessWait: 'Excess wait',
			regularityReading: (cov, bunched) => `CoV ${cov} · bunched ${bunched}`,
			spanSection: 'Service span',
			serviceSpan: 'Span',
			firstTripDelay: 'First-trip delay',
			lastTripDelay: 'Last-trip delay',
			tripCount: 'Trips',
			excessWaitMagnitude: (shift) => `Excess wait — ${shift}`,
			moreDetail: 'More detail · by direction & weekend',
		},
	};

	const t = $derived(BAND_COPY[locale]);
	const overline = $derived(copy.clusters.waitRegularity);
	const noData = $derived(copy.strip.noDataNote);

	/* ── formatters (pure) ─────────────────────────────────────────────────── */
	const fmtMin = (v: number | null | undefined): string =>
		v == null ? '—' : `${v.toFixed(1)} min`;
	const fmtCov = (v: number | null | undefined): string => (v == null ? '—' : v.toFixed(2));
	const fmtPct = (v: number | null | undefined): string => (v == null ? '—' : `${Math.round(v)}%`);
	const fmtCount = (v: number | null | undefined): string => (v == null ? '—' : `${v}`);

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
	   readable, bilingual labels. */
	const SHIFT_BASE: Record<string, Record<Locale, string>> = {
		am_peak: { fr: 'Pointe AM', en: 'AM peak' },
		pm_peak: { fr: 'Pointe PM', en: 'PM peak' },
		midday: { fr: 'Journée', en: 'Midday' },
		evening: { fr: 'Soirée', en: 'Evening' },
		night: { fr: 'Nuit', en: 'Night' },
	};
	function shiftLabel(shift: string): string {
		const weekend = shift.includes('_weekend');
		const dir = shift.match(/_dir(\d)/)?.[1] ?? null;
		const base = shift.replace(/_dir\d/, '').replace(/_weekend/, '');
		const baseLabel = SHIFT_BASE[base]?.[locale] ?? base;
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

	/* ── service span — the most-recent row carrying a signal ──────────────────
	   serviceSpans arrives in contract order (chronological); the foundation VM
	   has already dropped signal-less rows, so the tail is the latest day. */
	const latestSpan = $derived<ServiceSpanPeriod | null>(
		serviceSpans.length > 0 ? serviceSpans[serviceSpans.length - 1] : null,
	);
	const hasSpan = $derived(latestSpan != null);
</script>

<section class="cluster" data-cluster="wait-regularity" aria-label={overline}>
	<SectionLabel text={overline} variant="station" />

	{#if wait.isEmpty && !hasSpan}
		<!-- Honest empty: nothing to draw in either sub-block. -->
		<p class="cluster-empty">{noData}</p>
	{:else}
		<!-- Headway-by-shift sub-block. -->
		<div class="cluster-sub" data-sub="headway">
			<SectionLabel text={t.headwaySection} variant="metric" />
			{#snippet shiftItem(row: ShiftRow, i: number)}
				<li class="shift-row">
					<RankedRow
						rank={i + 1}
						title={shiftLabel(row.shift)}
						subtitle={t.regularityReading(fmtCov(row.cov), fmtPct(row.bunched))}
						severity={row.severity}
						value={row.magnitude}
						display={fmtMin(row.excessWait)}
						aria-label={t.excessWaitMagnitude(shiftLabel(row.shift))}
					/>
					<div class="shift-metrics">
						<MetricDisplay value={fmtMin(row.scheduled)} label={t.scheduled} size="sm" />
						<MetricDisplay value={fmtMin(row.observed)} label={t.observed} size="sm" />
						<MetricDisplay value={fmtMin(row.excessWait)} label={t.excessWait} size="sm" />
					</div>
				</li>
			{/snippet}
			{#if shiftRows.length > 0}
				<ul class="shift-list" role="list">
					{#each mainRows as row, i (row.shift)}
						{@render shiftItem(row, i)}
					{/each}
				</ul>
				{#if hasAdvancedReveal}
					<details class="shift-more">
						<summary class="shift-more-summary">{t.moreDetail}</summary>
						<ul class="shift-list shift-list--more" role="list">
							{#each advancedRows as row, i (row.shift)}
								{@render shiftItem(row, i)}
							{/each}
						</ul>
					</details>
				{/if}
			{:else}
				<p class="cluster-empty">{noData}</p>
			{/if}
		</div>

		<!-- Service-span sub-block — only when a signal-carrying day exists. -->
		{#if hasSpan && latestSpan}
			<div class="cluster-sub" data-sub="service-span">
				<SectionLabel text={t.spanSection} variant="metric" />
				<div class="shift-metrics">
					<MetricDisplay
						value={fmtMin(latestSpan.service_span_min)}
						label={t.serviceSpan}
						size="sm"
					/>
					<MetricDisplay
						value={fmtMin(latestSpan.first_trip_delay_min)}
						label={t.firstTripDelay}
						size="sm"
					/>
					<MetricDisplay
						value={fmtMin(latestSpan.last_trip_delay_min)}
						label={t.lastTripDelay}
						size="sm"
					/>
					<MetricDisplay value={fmtCount(latestSpan.trip_count)} label={t.tripCount} size="sm" />
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
	/* "More detail" reveal — the per-direction / weekend shifts, calm by default
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
	.shift-list--more {
		margin-top: 0.85rem;
	}
</style>

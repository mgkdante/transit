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
	import { fmtCount, fmtDelayMin, fmtPct } from '$lib/utils';
	import type { HeadwayPeriod, SeverityCode, ServiceSpanPeriod } from '$lib/v1';
	import {
		RankedRow,
		ExplainedMetricCard,
		ServiceSpanTimeline,
		SeverityBar,
	} from '$lib/components/dataviz';
	import { Chart } from '$lib/components/dataviz/chart';
	import { selectHeadwayDumbbell } from './selectors/headwayDumbbell';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		metricInfoFor,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { WaitRegularityVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';
	import {
		shiftLabel as baseShiftLabel,
		bunchingToSeverity,
		covToSeverity,
		HEADWAY_DOMAIN,
		COV_DOMAIN,
		BUNCHED_DOMAIN,
	} from '$lib/features/reliability/shiftGrains';

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
		/**
		 * dir (direction_id) → real destination headsign, from the route file. The
		 * observed-gap-by-direction table labels its columns with these ("Est"/"Ouest")
		 * instead of "Direction 1/2"; a dir with no headsign falls back to "Direction N".
		 */
		directionHeadsigns?: Record<number, string>;
	}

	let {
		wait,
		serviceSpans = [],
		locale,
		copy,
		directionHeadsigns = {},
	}: Cluster02WaitRegularityProps = $props();

	/* ── band-local copy ──────────────────────────────────────────────────────
	   Labels this band needs that are NOT in the shared copy live here, co-located
	   and bilingual (FR canonical). The plain wait-regularity term microcopy
	   (scheduled gap / observed gap / excess wait / spread / clumped) lives in the
	   shared `copy.regularityTerms`; the cluster overline + the ramp-in / no-data
	   notes are read from the passed `copy` so the surface stays the one source of
	   truth for those. */
	interface BandCopy {
		readonly headwaySection: string;
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
		/** Direction-table column header for the shift/row axis. */
		readonly directionShiftCol: string;
		/** Direction-table column header, 1-indexed (Direction 1 / Direction 2). */
		readonly directionCol: (n: number) => string;
		/** Direction-table row-label suffix for the weekend variant. */
		readonly weekendSuffix: string;
		/** Suffix for the whole-day excess-wait headline (mean across the shifts). */
		readonly allDay: string;
		/** Always-visible explanation of excess wait — the "over WHAT" baseline. */
		readonly excessWaitExplain: string;
		/** Whole-dumbbell accessible summary, given the scheduled + observed readings. */
		readonly dumbbellAria: (scheduled: string, observed: string) => string;
		/** Excess-wait annotation prefix beside the dumbbell, given the formatted value. */
		readonly dumbbellExcess: (value: string) => string;
		/** a11y prefix for the per-shift CoV (regularity) magnitude bar. */
		readonly covMagnitude: (shift: string) => string;
		/** a11y prefix for the per-shift bunched-share magnitude bar. */
		readonly bunchedMagnitude: (shift: string) => string;
		/** Value-axis title for the scheduled-vs-observed headway dumbbell. */
		readonly headwayAxis: string;
	}

	const BAND_COPY: Record<Locale, BandCopy> = {
		fr: {
			headwaySection: 'Attente par période',
			spanSection: 'Plage de service',
			serviceSpan: 'Durée de service',
			firstTripDelay: 'Retard 1er départ',
			lastTripDelay: 'Retard dernier départ',
			tripCount: 'Voyages',
			excessWaitMagnitude: (shift) => `Attente excédentaire, ${shift}`,
			moreDetail: 'Plus de détail · intervalle observé par direction',
			directionGap: 'Intervalle observé par direction',
			directionShiftCol: 'Période',
			directionCol: (n) => `Direction ${n}`,
			weekendSuffix: 'fin de sem.',
			allDay: 'sur la journée',
			excessWaitExplain:
				"Le temps d'attente en plus de l'intervalle prévu entre les bus. 0 signifie que la ligne respecte (ou dépasse) sa fréquence prévue.",
			dumbbellAria: (scheduled, observed) =>
				`Intervalle prévu ${scheduled} min, intervalle observé ${observed} min`,
			dumbbellExcess: (value) => `Attente excédentaire ${value} min`,
			covMagnitude: (shift) => `Régularité (CV), ${shift}`,
			bunchedMagnitude: (shift) => `Part de bus collés, ${shift}`,
			headwayAxis: 'Intervalle (min)',
		},
		en: {
			headwaySection: 'Wait by shift',
			spanSection: 'Service span',
			serviceSpan: 'Span',
			firstTripDelay: 'First-trip delay',
			lastTripDelay: 'Last-trip delay',
			tripCount: 'Trips',
			excessWaitMagnitude: (shift) => `Excess wait, ${shift}`,
			moreDetail: 'More detail · observed gap by direction',
			directionGap: 'Observed gap by direction',
			directionShiftCol: 'Shift',
			directionCol: (n) => `Direction ${n}`,
			weekendSuffix: 'weekend',
			allDay: 'across the day',
			excessWaitExplain:
				'The extra time riders wait beyond the scheduled gap between buses. 0 means the line met (or beat) its planned frequency.',
			dumbbellAria: (scheduled, observed) =>
				`Scheduled gap ${scheduled} min, observed gap ${observed} min`,
			dumbbellExcess: (value) => `Excess wait ${value} min`,
			covMagnitude: (shift) => `Regularity (CoV), ${shift}`,
			bunchedMagnitude: (shift) => `Bunched share, ${shift}`,
			headwayAxis: 'Headway (min)',
		},
	};

	const t = $derived(BAND_COPY[locale]);

	// Column labels for the direction table: the real headsign when the route publishes one
	// (dir0 → "Direction 1" position, dir1 → "Direction 2"), else the neutral fallback. A
	// rider reads "Est / Ouest", never "direction 0/1".
	const dir0Label = $derived(directionHeadsigns[0] ?? t.directionCol(1));
	const dir1Label = $derived(directionHeadsigns[1] ?? t.directionCol(2));
	/** Plain-language term microcopy (shared, FR canonical). */
	const terms = $derived(copy.regularityTerms);
	const overline = $derived(copy.clusters.waitRegularity);

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
	const min = (v: number | null | undefined): string | null =>
		fmtDelayMin(v, { rounding: 'fixed1' });
	const fmtCov = (v: number | null | undefined): string | null => (v == null ? null : v.toFixed(2));
	const pct = (v: number | null | undefined): string | null => fmtPct(v, { rounding: 'round' });
	const count = (v: number | null | undefined): string | null => fmtCount(v);
	/** Short value-level no-data label for absent inline values + empty tiles. */
	const valueNoData = $derived(copy.strip.noData);

	/* ── service-span timeline copy + formatters ──────────────────────────────
	   The first/last-trip clock times resolve inside ServiceSpanTimeline (it owns the
	   UTC→wall-clock + the fixed 24h axis); here we only shape the two TEXT annotations
	   it renders (span length + trip count), both honest-null when absent. */
	const spanCopy = $derived(copy.serviceSpanTimeline);
	/** A whole-minute span → a compact "{H}h {MM}m" / "{M}m" duration. null when absent. */
	const spanDuration = (v: number | null | undefined): string | null => {
		if (v == null || Number.isNaN(v)) return null;
		const total = Math.max(0, Math.round(v));
		const h = Math.floor(total / 60);
		const m = total % 60;
		return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
	};

	/* ── headway rows → per-shift magnitude rows ───────────────────────────────
	   S7: magnitude = the ABSOLUTE excess wait (min), scaled by the fixed HEADWAY_DOMAIN
	   at the bar — identical across routes/grains/refreshes (no more excess/maxExcess
	   in-view normalization). The severity band is derived from bunching: heavier
	   bunching = a worse rider experience. Nulls stay null → empty bar. */

	interface ShiftRow {
		readonly shift: string;
		/** Bare time-of-day token (am_peak/…) for label + primary/advanced split. */
		readonly baseShift: string;
		readonly directionId: number | null;
		readonly dayType: string | null;
		readonly scheduled: number | null;
		readonly observed: number | null;
		readonly excessWait: number | null;
		readonly cov: number | null;
		readonly bunched: number | null;
		/** ABSOLUTE excess wait (min), scaled by HEADWAY_DOMAIN at the bar; null = no signal. */
		readonly magnitude: number | null;
		/** Severity from BUNCHING — drives the excess-wait row + the bunched-share bar. */
		readonly severity: SeverityCode;
		/** Severity from the headway CoV — drives the dedicated regularity bar. */
		readonly covSeverity: SeverityCode;
	}

	/* S7-B Pattern A: read the TYPED direction_id / day_type fields. Fall back to the
	   legacy packed `{shift}_dir{N}_weekend` string for snapshots published before the
	   cutover, so the band renders correctly across the deploy window. */
	function decodeShift(h: HeadwayPeriod): {
		baseShift: string;
		directionId: number | null;
		dayType: string | null;
	} {
		if (h.direction_id != null || h.day_type != null) {
			return {
				baseShift: h.shift,
				directionId: h.direction_id ?? null,
				dayType: h.day_type ?? null,
			};
		}
		const dirMatch = h.shift.match(/_dir(\d)/)?.[1];
		const weekend = h.shift.includes('_weekend');
		return {
			baseShift: h.shift.replace(/_dir\d/, '').replace(/_weekend/, ''),
			directionId: dirMatch != null ? Number(dirMatch) : null,
			dayType: dirMatch != null ? (weekend ? 'weekend' : 'weekday') : null,
		};
	}

	const shiftRows = $derived<ShiftRow[]>(
		wait.headway.map((h) => ({
			shift: h.shift,
			...decodeShift(h),
			scheduled: h.scheduled_min ?? null,
			observed: h.observed_min ?? null,
			excessWait: h.excess_wait_min ?? null,
			cov: h.cov ?? null,
			bunched: h.bunched_pct ?? null,
			magnitude: h.excess_wait_min ?? null,
			severity: bunchingToSeverity(h.bunched_pct),
			covSeverity: covToSeverity(h.cov),
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
	function shiftLabel(row: ShiftRow): string {
		const baseLabel = baseShiftLabel(row.baseShift, locale);
		const extras: string[] = [];
		if (row.directionId != null) extras.push(`dir ${row.directionId}`);
		if (row.dayType === 'weekend') extras.push(locale === 'fr' ? 'fin de sem.' : 'weekend');
		return extras.length > 0 ? `${baseLabel} · ${extras.join(' · ')}` : baseLabel;
	}
	// Primary = the headline busiest-direction rows (no direction / day-type); the
	// per-direction + weekend siblings are the advanced grain.
	const isPrimaryShift = (row: ShiftRow): boolean => row.directionId == null && row.dayType == null;
	const primaryRows = $derived(shiftRows.filter((r) => isPrimaryShift(r)));
	const advancedRows = $derived(shiftRows.filter((r) => !isPrimaryShift(r)));
	// Show primary by default; if a route only has advanced rows, surface those
	// in the open list rather than hiding everything behind the reveal.
	const mainRows = $derived(primaryRows.length > 0 ? primaryRows : advancedRows);
	const hasAdvancedReveal = $derived(primaryRows.length > 0 && advancedRows.length > 0);

	// §02 headway DUMBBELL (A8): ALL primary shifts in ONE comparable chart on the fixed
	// HEADWAY_DOMAIN — scheduled ● —— ● observed, the connector span = the excess wait, so
	// the gap reads at a glance AND across shifts. Severity (bunching) colours the observed
	// dot; CoV + bunched ride the hover tooltip. Replaces the N isolated per-row dumbbells
	// with one cross-shift comparison (the per-shift detail rows stay below for the drill).
	const headwayDumbbell = $derived(
		selectHeadwayDumbbell(
			mainRows.map((r, i) => ({
				key: `${r.shift}-${i}`,
				label: shiftLabel(r),
				scheduled: r.scheduled,
				observed: r.observed,
				excess: r.excessWait,
				severity: r.severity,
				note:
					[
						r.cov != null ? `${terms.spread} ${fmtCov(r.cov)}` : null,
						r.bunched != null ? `${terms.clumped} ${pct(r.bunched)}` : null,
					]
						.filter(Boolean)
						.join(' · ') || undefined,
			})),
			locale,
			{
				title: t.headwaySection,
				xLabel: t.headwayAxis,
				unit: ' min',
				scheduledLabel: terms.scheduledGap,
				observedLabel: terms.observedGap,
				noDataMarker: copy.strip.noData,
			},
		),
	);

	// The "observed gap by direction" disclosure as a real TABLE, not a tile cloud (operator
	// ask). The advanced rows are a clean cube — shift × direction(0/1) × day-type(week/wknd)
	// — so we PIVOT to one row per (shift, day-type) with the two directions as columns. A
	// missing cell routes through the honest no-data chip, never a bare/zero tile.
	const SHIFT_ORDER = ['am_peak', 'midday', 'pm_peak', 'evening', 'night'];
	interface DirectionRow {
		readonly key: string;
		readonly label: string;
		readonly dir0: number | null;
		readonly dir1: number | null;
		readonly order: number;
	}
	const directionRows = $derived.by<DirectionRow[]>(() => {
		// Plain object (not a Map) — this is throwaway computation inside the derivation,
		// not reactive state, so SvelteMap would be the wrong tool (and the lint rule agrees).
		const groups: Record<
			string,
			{ base: string; weekend: boolean; dir0: number | null; dir1: number | null }
		> = {};
		for (const r of advancedRows) {
			// Read the decoded TYPED fields (decodeShift already applied the legacy
			// fallback) — NOT the raw shift token: post-cutover r.shift is the bare
			// base token with no _dir/_weekend suffix to parse, so the old string
			// regex would silently yield an empty table on fresh snapshots.
			const weekend = r.dayType === 'weekend';
			const dir = r.directionId != null ? String(r.directionId) : null;
			const base = r.baseShift;
			const key = `${base}__${weekend ? 'wknd' : 'week'}`;
			let g = groups[key];
			if (!g) {
				g = { base, weekend, dir0: null, dir1: null };
				groups[key] = g;
			}
			if (dir === '0') g.dir0 = r.observed;
			else if (dir === '1') g.dir1 = r.observed;
		}
		return Object.entries(groups)
			.map(([key, g]) => {
				const si = SHIFT_ORDER.indexOf(g.base);
				return {
					key,
					label: g.weekend
						? `${baseShiftLabel(g.base, locale)} · ${t.weekendSuffix}`
						: baseShiftLabel(g.base, locale),
					dir0: g.dir0,
					dir1: g.dir1,
					// canonical shift order; weekday before its weekend twin.
					order: (si < 0 ? 99 : si) * 2 + (g.weekend ? 1 : 0),
				};
			})
			.sort((a, b) => a.order - b.order);
	});

	// The headline excess-wait read, lifted to a prominent ExplainedMetricCard so the
	// "extra wait over WHAT" baseline is ALWAYS visible beside the number (the operator's
	// "1.8 min over what" fix). It represents the WHOLE DAY — the mean excess wait across the
	// shifts that carry a value — NOT a cherry-picked shift (a single time-of-day in the
	// headline reads as arbitrary "why morning?"). The per-shift breakdown below shows the
	// variation, so the bad shifts stay visible; the headline is just the at-a-glance typical.
	const excessWaitValues = $derived(
		mainRows.map((r) => r.excessWait).filter((v): v is number => v != null),
	);
	const allDayExcessWait = $derived<number | null>(
		excessWaitValues.length > 0
			? excessWaitValues.reduce((sum, v) => sum + v, 0) / excessWaitValues.length
			: null,
	);
	const hasExcessHeadline = $derived(allDayExcessWait != null);

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
		<!-- Honest empty: the styled honest-absence chip (says WHY), nothing to draw in either sub-block. -->
		<AbsentValue variant="block" reason="no-observations" {locale} />
	{:else}
		<!-- Headway-by-shift sub-block. -->
		<div class="cluster-sub" data-sub="headway">
			<span class="label-with-info">
				<SectionLabel text={t.headwaySection} variant="metric" />
				{@render metricInfo('headway', t.headwaySection)}
				{@render metricInfo('regularityCov', copy.strip.headwayRegularityCov)}
			</span>

			<!-- S7: the headline excess-wait read, lifted to a prominent 2-col card whose
			     always-visible explanation states the baseline ("over the scheduled gap")
			     beside the number — the operator's "1.8 min over what" fix. -->
			{#if hasExcessHeadline}
				<ExplainedMetricCard
					label={`${terms.excessWait} · ${t.allDay}`}
					value={min(allDayExcessWait)}
					explanation={t.excessWaitExplain}
					emptyLabel={valueNoData}
					absentReason="no-observations"
					{locale}
					size="lg"
					class="excess-wait-headline"
				>
					{#snippet info()}{@render metricInfo('excessWait', terms.excessWait)}{/snippet}
				</ExplainedMetricCard>
			{/if}

			<!-- A8: the consolidated scheduled-vs-observed DUMBBELL — ALL shifts in ONE chart on
			     the fixed HEADWAY_DOMAIN, so the gap reads at a glance AND across the day. The
			     <Chart> renders the honest-absence chip itself when no shift has both endpoints. -->
			<div class="headway-dumbbell" data-slot="headway-dumbbell">
				<Chart spec={headwayDumbbell.spec} />
			</div>

			{#snippet shiftItem(row: ShiftRow, i: number)}
				<li class="shift-row">
					<RankedRow
						rank={i + 1}
						title={shiftLabel(row)}
						severity={row.severity}
						value={row.magnitude}
						domain={HEADWAY_DOMAIN}
						unit=" min"
						showRank={false}
						display={min(row.excessWait) ?? valueNoData}
						aria-label={t.excessWaitMagnitude(shiftLabel(row))}
						barInteractive
					/>

					<!-- P8: dedicated magnitude bars for the two regularity readings — CoV on
					     COV_DOMAIN, bunched share on BUNCHED_DOMAIN — both formerly subtitle TEXT
					     only. Each rides its own FIXED domain (stable across routes/grains), with a
					     severity band (covToSeverity / bunchingToSeverity), a glyph-free numeric
					     readout, and an a11y label so colour is never the sole channel. -->
					<div class="shift-regularity" data-slot="regularity-bars">
						<div class="regularity-metric" data-metric="cov">
							<div class="regularity-head">
								<span class="regularity-label">{terms.spread}</span>
								<span class="regularity-value">{fmtCov(row.cov) ?? valueNoData}</span>
							</div>
							<SeverityBar
								severity={row.covSeverity}
								value={row.cov}
								domain={COV_DOMAIN}
								unit=""
								size="sm"
								label={t.covMagnitude(shiftLabel(row))}
								interactive
							/>
						</div>
						<div class="regularity-metric" data-metric="bunched">
							<div class="regularity-head">
								<span class="regularity-label">{terms.clumped}</span>
								<span class="regularity-value">{pct(row.bunched) ?? valueNoData}</span>
							</div>
							<SeverityBar
								severity={row.severity}
								value={row.bunched}
								domain={BUNCHED_DOMAIN}
								unit="%"
								size="sm"
								label={t.bunchedMagnitude(shiftLabel(row))}
								interactive
							/>
						</div>
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
							<!-- Semantic table (operator: a real table, desktop + mobile). Rows = shift ×
							     day-type; columns = the two directions; a missing cell shows the honest
							     no-data chip. The table reflows to stacked rows under ~28rem via CSS. -->
							<table class="direction-table" data-slot="direction-table">
								<thead>
									<tr>
										<th scope="col">{t.directionShiftCol}</th>
										<th scope="col">{dir0Label}</th>
										<th scope="col">{dir1Label}</th>
									</tr>
								</thead>
								<tbody>
									{#each directionRows as row (row.key)}
										<tr>
											<th scope="row">{row.label}</th>
											<td data-col={dir0Label}>
												{#if row.dir0 != null}{min(row.dir0)}{:else}<AbsentValue
														variant="inline"
														reason="no-observations"
														{locale}
													/>{/if}
											</td>
											<td data-col={dir1Label}>
												{#if row.dir1 != null}{min(row.dir1)}{:else}<AbsentValue
														variant="inline"
														reason="no-observations"
														{locale}
													/>{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</details>
				{/if}
			{:else}
				<AbsentValue variant="block" reason="no-observations" {locale} />
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

				<!-- P3: the first→last service-span TIMELINE on a fixed 24h axis, with signed
				     first/last-trip punctuality markers (DELAY_STOP_DOMAIN). The numeric tiles
				     below remain the exact reading; this is the at-a-glance shape. Honest
				     absence (no resolvable first/last departure) lives inside the primitive. -->
				<ServiceSpanTimeline
					firstTripUtc={latestSpan.first_trip_utc ?? null}
					lastTripUtc={latestSpan.last_trip_utc ?? null}
					firstDelayMin={latestSpan.first_trip_delay_min ?? null}
					lastDelayMin={latestSpan.last_trip_delay_min ?? null}
					spanLabel={spanDuration(latestSpan.service_span_min) != null
						? spanCopy.span(spanDuration(latestSpan.service_span_min)!)
						: null}
					tripsLabel={count(latestSpan.trip_count) != null
						? spanCopy.trips(count(latestSpan.trip_count)!)
						: null}
					firstLabel={spanCopy.firstTrip}
					lastLabel={spanCopy.lastTrip}
					firstDelayLabel={spanCopy.firstDelay}
					lastDelayLabel={spanCopy.lastDelay}
					ariaLabel={spanCopy.ariaLabel}
					{locale}
					absentReason="no-observations"
					interactive
				/>
				<p class="span-caption" data-slot="service-span-caption">{spanCopy.caption}</p>

				<div class="shift-metrics">
					<div class="metric-with-info">
						<MetricDisplay
							value={min(latestSpan.service_span_min)}
							emptyLabel={valueNoData}
							absentReason="no-observations"
							{locale}
							label={t.serviceSpan}
							size="sm"
						/>
						{@render metricInfo('serviceSpan', t.serviceSpan)}
					</div>
					<div class="metric-with-info">
						<MetricDisplay
							value={min(latestSpan.first_trip_delay_min)}
							emptyLabel={valueNoData}
							absentReason="no-observations"
							{locale}
							label={t.firstTripDelay}
							size="sm"
						/>
						{@render metricInfo('serviceSpan', t.firstTripDelay)}
					</div>
					<div class="metric-with-info">
						<MetricDisplay
							value={min(latestSpan.last_trip_delay_min)}
							emptyLabel={valueNoData}
							absentReason="no-observations"
							{locale}
							label={t.lastTripDelay}
							size="sm"
						/>
						{@render metricInfo('serviceSpan', t.lastTripDelay)}
					</div>
					<div class="metric-with-info">
						<MetricDisplay
							value={count(latestSpan.trip_count)}
							emptyLabel={valueNoData}
							absentReason="no-observations"
							{locale}
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
	/* A sub-block overline + its explainer (i)s, kept centred on the label. The
	   label keeps a measure (min-width:0) so a long overline wraps cleanly; each
	   (i) wrapper never shrinks (flex:none) so the glyphs stay whole beside it. */
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
	.shift-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	/* Each shift is its OWN card (operator: clear separation between shifts). A bordered,
	   padded surface makes the inter-shift boundary unmistakable — previously the 0.6rem
	   intra-row gap ≈ the 1rem inter-row gap, so the shifts blurred into one stack. */
	.shift-row {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--border);
		border-radius: 0.6rem;
		background: color-mix(in oklab, var(--card) 55%, transparent);
	}
	.shift-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}
	/* P8: the two dedicated regularity magnitude bars (CoV + bunched share), each a
	   label/value head over a fixed-domain SeverityBar. Two columns on wide rows,
	   stacking on narrow ones; the bars never share an axis (different domains). */
	.shift-regularity {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.75rem 1.25rem;
	}
	.regularity-metric {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}
	.regularity-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.regularity-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	/* The metric VALUE rides the wayfinding (yellow) accent, per the four-color doctrine. */
	.regularity-value {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--accent-text);
	}
	/* A second-tier metric tile + its explainer (i), kept on the tile's top edge. The
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
	/* What the excess-wait magnitude encodes (0 = on schedule, not missing). */
	.shift-caption {
		margin: 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* The (i) flows after the caption text; keep the glyph whole and hugging the last
	   word so it never shrinks or breaks across the caption's wrap. */
	.shift-caption :global(.cluster-info) {
		flex: none;
		white-space: nowrap;
	}
	/* A3: the per-direction observed-gap comparison inside the reveal. */
	.shift-direction {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	/* The observed-gap-by-direction TABLE. Tabular numbers, zebra rows, sticky-ish row
	   headers; the two direction columns are right-aligned numerics. */
	.direction-table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
		font-size: var(--text-small);
	}
	.direction-table th,
	.direction-table td {
		padding: 0.4rem 0.6rem;
		text-align: right;
		white-space: nowrap;
	}
	.direction-table thead th {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted-foreground);
		border-bottom: 1px solid var(--border);
	}
	.direction-table th[scope='col']:first-child,
	.direction-table th[scope='row'] {
		text-align: left;
		font-weight: 500;
		color: var(--foreground);
	}
	.direction-table tbody tr + tr th[scope='row'],
	.direction-table tbody tr + tr td {
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	/* Mobile: under ~28rem the table reflows to stacked label/value rows so the two
	   direction columns never clip — each cell announces its column via its data-col. */
	@media (max-width: 28rem) {
		.direction-table,
		.direction-table thead,
		.direction-table tbody,
		.direction-table tr,
		.direction-table th,
		.direction-table td {
			display: block;
			text-align: left;
			white-space: normal;
		}
		.direction-table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
		}
		.direction-table tbody tr {
			padding: 0.5rem 0;
			border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		}
		.direction-table th[scope='row'] {
			margin-bottom: 0.2rem;
		}
		.direction-table td {
			display: flex;
			justify-content: space-between;
			gap: 1rem;
			padding: 0.15rem 0;
			border: 0;
		}
		.direction-table td::before {
			content: attr(data-col);
			font-family: var(--font-mono);
			font-size: var(--text-micro);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--muted-foreground);
		}
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
	/* What the first/last-trip endpoint markers encode (early ▼ / late ▲). */
	.span-caption {
		margin: 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
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

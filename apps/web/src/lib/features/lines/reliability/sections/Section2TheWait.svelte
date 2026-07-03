<!--
  §2 The wait — "How long until the next bus, and is it steady?"

  The wait-and-regularity rider-question section. Leads with the ONE always-visible
  PRIMARY chart — the scheduled-vs-observed headway DUMBBELL, all shifts in one
  comparable chart on the fixed HEADWAY_DOMAIN, the connector span = the excess wait
  — then tucks the analyst detail behind the progressive-disclosure `<Detail>`:
  the whole-day excess-wait headline, the per-shift breakdown (excess-wait RankedRow
  + CoV/bunched SeverityBars), the observed-gap-by-direction table, and the
  service-span timeline + its four numeric tiles.

  Reads two contract slices, both guarded by the foundation VM mapper:
    · headway[]       (WaitRegularityVM), scheduled-vs-observed headway +
      excess wait per shift, plus the regularity readings (CoV, bunched %).
    · service_spans[] (ServiceSpanPeriod[]), the most-recent service-span day:
      first/last trip span (min) + first/last-trip punctuality.

  DOCTRINE upheld here:
    · every data mark rides the dataviz scale (SeverityBar owns that); --primary
      stays interactive-only.
    · honest empties, when headway is empty we render the section's no-data note,
      not a zeroed bar; same for the service-span sub-block. A null metric shows
      "—", never a fabricated 0.
  Bilingual: FR is canonical; band-local labels are co-located below (BAND_COPY) and
  the shared honest-state notes + section overline/question come from the passed copy.
  Reduced-motion is honoured by the primitives (SeverityBar guards its own transition).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { fmtCount, fmtDelayMin, fmtPct } from '$lib/utils';
	import type { HeadwayPeriod, SeverityCode, ServiceSpanPeriod } from '$lib/v1';
	import { Chart } from '$lib/components/dataviz/chart';
	import { DeltaStat } from '$lib/components/dataviz';
	import { meanPriorDelta, type PriorDelta } from '../selectors/priorDelta';
	import { selectHeadwayDumbbell } from '../selectors/headwayDumbbell';
	import { selectShiftBars } from '../selectors/shiftBars';
	import { selectDirectionAsymmetry } from '../selectors/directionAsymmetry';
	import { selectBullet } from '../selectors/bullet';
	import { selectServiceSpan } from '../selectors/serviceSpan';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import MetricBullet from './MetricBullet.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import Detail from '$lib/components/shared/Detail.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		metricInfoFor,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { WaitRegularityVM } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';
	import {
		shiftLabel as baseShiftLabel,
		bunchingToSeverity,
		covToSeverity,
		HEADWAY_DOMAIN,
		COV_DOMAIN,
		BUNCHED_DOMAIN,
	} from '$lib/features/reliability/shiftGrains';

	interface Section2TheWaitProps {
		/** The wait-regularity VM (headway rows carrying a signal, contract order). */
		wait: WaitRegularityVM;
		/**
		 * Service-span history (foundation VM: only rows carrying a signal). The
		 * section reads the most-recent row for the span + first/last punctuality
		 * block. Empty array → the sub-block is omitted with no fabrication.
		 */
		serviceSpans?: ServiceSpanPeriod[];
		/** Active locale (FR canonical). */
		locale: Locale;
		/** The shared reliability copy, section overline/question + honest-state notes. */
		copy: ReliabilityCopy;
		/**
		 * dir (direction_id) → real destination headsign, from the route file. The
		 * observed-gap-by-direction table labels its columns with these ("Est"/"Ouest")
		 * instead of "Direction 1/2"; a dir with no headsign falls back to "Direction N".
		 */
		directionHeadsigns?: Record<number, string>;
		/**
		 * Active window (day|week|month|range) — names the "vs prior {window}" wait comparison.
		 * The headway breakdown re-shapes on this window via the mapper (headway_by_grain);
		 * `range` reads the day-anchored windowed breakdown, so it borrows the 'day' phrasing.
		 */
		mode?: 'day' | 'week' | 'month' | 'range';
	}

	let {
		wait,
		serviceSpans = [],
		locale,
		copy,
		directionHeadsigns = {},
		mode = 'day',
	}: Section2TheWaitProps = $props();

	// Resolved window grain for the comparison phrasing (a custom range reads the day window).
	const win = $derived<'day' | 'week' | 'month'>(
		mode === 'week' || mode === 'month' ? mode : 'day',
	);

	/* ── band-local copy ──────────────────────────────────────────────────────
	   Labels this section needs that are NOT in the shared copy live here, co-located
	   and bilingual (FR canonical). The plain wait-regularity term microcopy
	   (scheduled gap / observed gap / excess wait / spread / clumped) lives in the
	   shared `copy.regularityTerms`; the section overline/question + the ramp-in /
	   no-data notes are read from the passed `copy` so the surface stays the one
	   source of truth for those. */
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
		/** Excess-wait explainer for the WINDOWED grains (true passenger-weighted EWT). */
		readonly excessWaitExplain: string;
		/** Excess-wait explainer for the SCALAR whole-history rows (the typical-gap proxy, which
		 *  carries no variance term — those rows read off route_headway_by_shift, no moment sums). */
		readonly excessWaitProxyExplain: string;
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
		/** Overline for the always-visible direction-asymmetry callout. */
		readonly directionAsymmetryLabel: string;
		/** The callout sentence: the shift + the slower/faster direction waits. */
		readonly directionAsymmetry: (
			shift: string,
			slowerDir: string,
			slowerVal: string,
			fasterDir: string,
			fasterVal: string,
		) => string;
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
				"Le temps d'attente supplémentaire réel des usagers, au-delà d'un bus parfaitement régulier. C'est pondéré par les passagers : quand les bus se collent, les longs intervalles touchent plus de monde et font monter ce chiffre. 0 signifie que le service vaut (ou dépasse) ce que l'horaire promet.",
			excessWaitProxyExplain:
				"De combien l'intervalle TYPIQUE entre les bus dépasse l'intervalle prévu. 0 signifie que la ligne respecte (ou dépasse) sa fréquence prévue. C'est l'excédent d'intervalle typique, pas une attente pondérée par la variance; quand les bus se collent, certains usagers attendent plus longtemps.",
			dumbbellAria: (scheduled, observed) =>
				`Intervalle prévu ${scheduled} min, intervalle observé ${observed} min`,
			dumbbellExcess: (value) => `Attente excédentaire ${value} min`,
			covMagnitude: (shift) => `Régularité (CV), ${shift}`,
			bunchedMagnitude: (shift) => `Part de bus collés, ${shift}`,
			headwayAxis: 'Intervalle (min)',
			directionAsymmetryLabel: 'La direction compte',
			directionAsymmetry: (shift, slowerDir, slowerVal, fasterDir, fasterVal) =>
				`Vers ${shift}, l’attente est d’environ ${slowerVal} vers ${slowerDir}, contre ${fasterVal} vers ${fasterDir}.`,
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
				'The extra time riders actually wait, beyond an evenly-scheduled bus. It is passenger-weighted, so bunching counts: when buses clump, the long gaps catch more riders and push this up. 0 means service is as good as (or better than) the schedule promises.',
			excessWaitProxyExplain:
				'How much longer the TYPICAL gap between buses runs than scheduled. 0 means the line met (or beat) its planned frequency. This is the typical-gap excess, not a variance-aware wait. When buses bunch, some riders wait longer than this.',
			dumbbellAria: (scheduled, observed) =>
				`Scheduled gap ${scheduled} min, observed gap ${observed} min`,
			dumbbellExcess: (value) => `Excess wait ${value} min`,
			covMagnitude: (shift) => `Regularity (CoV), ${shift}`,
			bunchedMagnitude: (shift) => `Bunched share, ${shift}`,
			headwayAxis: 'Headway (min)',
			directionAsymmetryLabel: 'Direction matters',
			directionAsymmetry: (shift, slowerDir, slowerVal, fasterDir, fasterVal) =>
				`Around ${shift}, the wait runs about ${slowerVal} toward ${slowerDir} but ${fasterVal} toward ${fasterDir}.`,
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
	   The first/last-trip clock times resolve inside the service-span mark (it owns the
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
		/** PR-WEB-3 comparison-vs-prior: this window's gap-sample n + the prior window's observed
		 *  median + n (only on the windowed headway_by_grain rows; null on the scalar history). */
		readonly observationCount: number | null;
		readonly priorObserved: number | null;
		readonly priorObservationCount: number | null;
	}

	/* S7-B Pattern A: read the TYPED direction_id / day_type fields. Fall back to the
	   legacy packed `{shift}_dir{N}_weekend` string for snapshots published before the
	   cutover, so the section renders correctly across the deploy window. */
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
			observationCount: h.observation_count ?? null,
			priorObserved: h.prior_observed_min ?? null,
			priorObservationCount: h.prior_observation_count ?? null,
		})),
	);

	/* ── primary vs advanced shifts ────────────────────────────────────────────
	   The base periods (am/pm peak · midday · evening · night) show by default;
	   per-direction (`_dir*`) and weekend variants are a noisier advanced grain
	   tucked behind a "more detail" reveal, per the 9.6 control-spine doctrine
	   (advanced grains never crowd the headline). Raw shift keys decode to
	   readable, bilingual labels: the base am_peak/midday/… token resolves through
	   the SHARED shift vocabulary (so every surface speaks one language), and this
	   section keeps its own per-direction / weekend suffix decoration on top. */
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

	/* ── DETAIL — wait by shift · vs prior {window} (PR-WEB-3) ───────────────────
	   The busiest-direction observed wait per shift, each with a Δ-vs-prior badge gated by a
	   shared-CoV two-sample z-test (meanPriorDelta — observed headway is a MEAN, not a rate, so
	   a proportion test would be invalid). Shown ONLY when the headway breakdown is windowed
	   (headway_by_grain present) — the scalar whole-history rows carry no prior. Honest absence:
	   no prior window → the neutral "no prior {window}" marker (never a fake 0); an insignificant
	   jitter → "within noise" (neutral), never a coloured arrow (a RISING wait is the bad way). */
	interface WaitCompareRow {
		readonly key: string;
		readonly label: string;
		readonly observed: number | null;
		readonly delta: PriorDelta;
	}
	const waitCompareRows = $derived<WaitCompareRow[]>(
		mainRows
			.filter((r) => r.observed != null)
			// Index-suffix the key: when a route has only per-direction/weekend rows (no busiest-
			// direction primary), mainRows falls back to those and `r.shift` is the bare base token
			// (am_peak, …) shared across siblings — `${shift}-${i}` keeps the {#each} keys unique.
			.map((r, i) => ({
				key: `${r.shift}-${i}`,
				label: shiftLabel(r),
				observed: r.observed,
				delta: meanPriorDelta(
					r.observed,
					r.observationCount,
					r.priorObserved,
					r.priorObservationCount,
					{ cov: r.cov },
				),
			})),
	);
	const hasWaitCompare = $derived(wait.windowed && waitCompareRows.length > 0);
	// "+0.8 min" / "-1.2 min" — ASCII sign (the no-em-dash gate forbids U+2014, not hyphen-minus).
	const fmtMinDelta = (d: number): string => `${d > 0 ? '+' : ''}${d.toFixed(1)}${copy.units.min}`;

	// §02 headway DUMBBELL (A8): ALL primary shifts in ONE comparable chart on the fixed
	// HEADWAY_DOMAIN — scheduled ● —— ● observed, the connector span = the observed-vs-scheduled
	// median gap, so the gap reads at a glance AND across shifts. Severity (bunching) colours the
	// observed dot; CoV + bunched ride the hover tooltip. Replaces the N isolated per-row dumbbells
	// with one cross-shift comparison (the per-shift detail rows stay below for the drill).
	// NOTE (FIX-1): excess wait is now the passenger-weighted EWT, which is NOT the scheduled→observed
	// dot span, so it is NOT fed into the dumbbell (that would label a contradictory "gap"). EWT lives
	// in its own all-day bullet + the per-shift excess-wait magnitude bars below, correctly labelled.
	const headwayDumbbell = $derived(
		selectHeadwayDumbbell(
			mainRows.map((r, i) => ({
				key: `${r.shift}-${i}`,
				label: shiftLabel(r),
				scheduled: r.scheduled,
				observed: r.observed,
				excess: null,
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

	// Tier-1 (telling-metrics): the single LARGEST inbound-vs-outbound wait gap, surfaced as an
	// always-visible callout (promoted out of the buried per-direction reveal table). null on a
	// symmetric line (nothing to flag) → no callout. Threshold lives in the selector.
	const directionAsymmetry = $derived(
		selectDirectionAsymmetry(directionRows, { dir0Label, dir1Label }),
	);

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

	// S7 P5: the all-day excess-wait headline as a LayerChart bullet on the headway scale
	// (the SAME fixed HEADWAY_DOMAIN the dumbbell uses, so the excess reads the same length).
	// The always-visible "over the scheduled gap" baseline rides the caption (the "1.8 min
	// over WHAT" fix); the amber tone is the extra-wait voice.
	const excessBullet = $derived(
		selectBullet(allDayExcessWait, locale, {
			title: terms.excessWait,
			xLabel: terms.excessWait,
			unit: ' min',
			domain: HEADWAY_DOMAIN,
			tone: 'warn',
		}),
	);

	// S7 P5: the per-shift regularity breakdown becomes THREE clean cross-shift magnitude-bars
	// charts (excess wait / spread (CoV) / bunching by shift), each on its own fixed domain in
	// am→night order — replacing the cramped per-shift row stack (a RankedRow + two SeverityBars
	// per shift). "Which shift is worst?" now reads at a glance per metric; honest no-data per
	// shift (a null reading keeps its labelled row, never a fake-0 bar).
	const shiftBarRows = $derived(mainRows.map((r, i) => ({ row: r, key: `${r.shift}-${i}` })));
	const excessBars = $derived(
		selectShiftBars(
			shiftBarRows.map(({ row, key }) => ({
				key,
				label: shiftLabel(row),
				value: row.excessWait,
				severity: row.severity,
				note:
					[
						row.cov != null ? `${terms.spread} ${fmtCov(row.cov)}` : null,
						row.bunched != null ? `${terms.clumped} ${pct(row.bunched)}` : null,
					]
						.filter(Boolean)
						.join(' · ') || undefined,
			})),
			locale,
			{
				title: terms.excessWait,
				xLabel: terms.excessWait,
				unit: ' min',
				domain: HEADWAY_DOMAIN,
				noDataMarker: copy.strip.noData,
			},
		),
	);
	const covBars = $derived(
		selectShiftBars(
			shiftBarRows.map(({ row, key }) => ({
				key,
				label: shiftLabel(row),
				value: row.cov,
				severity: row.covSeverity,
			})),
			locale,
			{
				title: terms.spread,
				xLabel: terms.spread,
				unit: '',
				domain: COV_DOMAIN,
				noDataMarker: copy.strip.noData,
			},
		),
	);
	const bunchedBars = $derived(
		selectShiftBars(
			shiftBarRows.map(({ row, key }) => ({
				key,
				label: shiftLabel(row),
				value: row.bunched,
				severity: row.severity,
			})),
			locale,
			{
				title: terms.clumped,
				xLabel: terms.clumped,
				unit: '%',
				domain: BUNCHED_DOMAIN,
				noDataMarker: copy.strip.noData,
			},
		),
	);

	/* ── service span, the most-recent row carrying a signal ──────────────────
	   serviceSpans arrives in contract order (chronological); the foundation VM
	   has already dropped signal-less rows, so the tail is the latest day. */
	const latestSpan = $derived<ServiceSpanPeriod | null>(
		serviceSpans.length > 0 ? serviceSpans[serviceSpans.length - 1] : null,
	);
	const hasSpan = $derived(latestSpan != null);

	// S7 P5: the first→last service-span TIMELINE as a LayerChart mark (24h axis + a floating
	// bar) — the same face as every other chart. The selector resolves the ISO endpoints to
	// wall-clock minutes + builds the signed-delay readings; honest absence (an unresolvable
	// endpoint) returns an absence spec the <Chart> renders as the no-data chip.
	const serviceSpanSpec = $derived(
		latestSpan
			? selectServiceSpan(
					{
						firstTripUtc: latestSpan.first_trip_utc ?? null,
						lastTripUtc: latestSpan.last_trip_utc ?? null,
						firstDelayMin: latestSpan.first_trip_delay_min ?? null,
						lastDelayMin: latestSpan.last_trip_delay_min ?? null,
					},
					locale,
					{
						firstLabel: spanCopy.firstTrip,
						lastLabel: spanCopy.lastTrip,
						firstDelayLabel: spanCopy.firstDelay,
						lastDelayLabel: spanCopy.lastDelay,
						spanLabel:
							spanDuration(latestSpan.service_span_min) != null
								? spanCopy.span(spanDuration(latestSpan.service_span_min)!)
								: null,
						tripsLabel:
							count(latestSpan.trip_count) != null
								? spanCopy.trips(count(latestSpan.trip_count)!)
								: null,
						hourLabel: (h) => `${String(h).padStart(2, '0')}h`,
						ariaLabel: spanCopy.ariaLabel,
						absentTitle: t.spanSection,
						noDataLabel: copy.strip.noData,
					},
				)
			: null,
	);
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

<!-- The (i) trigger MetricBullet renders beside the excess-wait headline label. -->
{#snippet excessInfo()}{@render metricInfo('excessWait', terms.excessWait)}{/snippet}

{#snippet waitCompareRow(row: WaitCompareRow)}
	<li
		class="compare-row"
		data-slot="wait-compare-row"
		data-prior={row.delta.hasPrior ? (row.delta.significant ? 'change' : 'noise') : 'absent'}
	>
		<span class="compare-label">{row.label}</span>
		<span class="compare-value">{min(row.observed) ?? valueNoData}</span>
		<DeltaStat
			class="compare-delta"
			delta={row.delta.significant ? row.delta.delta : null}
			display={row.delta.significant && row.delta.delta != null
				? fmtMinDelta(row.delta.delta)
				: undefined}
			context={row.delta.significant
				? copy.priorDelta.vsPrior[win]
				: row.delta.hasPrior
					? copy.priorDelta.withinNoise
					: copy.priorDelta.noPrior[win]}
			ariaNoun={`${row.label} ${copy.priorDelta.waitNoun}`}
		/>
	</li>
{/snippet}

<CollapsibleSection
	dataSection="the-wait"
	eyebrow={copy.sections.theWait.label}
	question={copy.sections.theWait.question}
>
	{#if wait.isEmpty && !hasSpan}
		<!-- Honest empty: the styled honest-absence chip (says WHY), nothing to draw in either sub-block. -->
		<div data-slot="the-wait-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<!-- PRIMARY — the consolidated scheduled-vs-observed DUMBBELL (A8): ALL shifts in ONE chart
		     on the fixed HEADWAY_DOMAIN, so the gap reads at a glance AND across the day. The
		     <Chart> renders the honest-absence chip itself when no shift has both endpoints. -->
		<div class="section-primary" data-slot="headway-dumbbell" data-card="primary">
			<span class="label-with-info">
				<SectionLabel text={t.headwaySection} variant="metric" />
				{@render metricInfo('headway', t.headwaySection)}
				{@render metricInfo('regularityCov', copy.strip.headwayRegularityCov)}
			</span>
			<Chart spec={headwayDumbbell.spec} />
			<!-- Plain-language "what is bunching + how to read this" (operator ask): the least
			     intuitive concept on the page, taught in rider language right under the chart. -->
			<p class="bunching-help" data-slot="bunching-help">{terms.bunchingHelp}</p>
		</div>

		<!-- Tier-1 (telling-metrics): direction asymmetry — "the ride home can wait longer." Surfaced
		     as an always-visible callout when a shift's two directions differ enough; the full per-
		     direction table still lives in the Detail below for the breakdown. -->
		{#if directionAsymmetry}
			<div class="direction-callout" data-slot="direction-asymmetry">
				<SectionLabel text={t.directionAsymmetryLabel} variant="metric" />
				<p class="direction-callout__text">
					{t.directionAsymmetry(
						directionAsymmetry.shiftLabel,
						directionAsymmetry.slowerLabel,
						`${Math.round(directionAsymmetry.slowerMin)}${copy.units.min}`,
						directionAsymmetry.fasterLabel,
						`${Math.round(directionAsymmetry.fasterMin)}${copy.units.min}`,
					)}
				</p>
			</div>
		{/if}

		<!-- DETAIL — excess-wait headline + per-shift breakdown + direction table + service span. -->
		<Detail label={copy.sections.detailShow} labelOpen={copy.sections.detailHide}>
			<!-- Headway-by-shift sub-block. -->
			<div class="cluster-sub" data-sub="headway">
				<!-- S7: the headline excess-wait read, lifted to a prominent 2-col card whose
				     always-visible explanation states the baseline ("over the scheduled gap")
				     beside the number — the operator's "1.8 min over what" fix. -->
				{#if hasExcessHeadline}
					<!-- S7 P5: the all-day excess-wait headline as a MetricBullet — the number is the
					     value voice, the bullet its scale context on the headway domain; the always-
					     visible "over the scheduled gap" baseline rides the caption (the "over what" fix). -->
					<MetricBullet
						label={`${terms.excessWait} · ${t.allDay}`}
						valueText={min(allDayExcessWait)}
						spec={excessBullet}
						{locale}
						size="lg"
						info={excessInfo}
						caption={wait.windowed ? t.excessWaitExplain : t.excessWaitProxyExplain}
						class="excess-wait-headline"
						data-slot="excess-wait-headline"
					/>
				{/if}

				<!-- Wait by shift · vs the prior window (PR-WEB-3): the busiest-direction observed
				     wait per shift with a significance-gated Δ-vs-prior badge. Windowed-only (the
				     scalar whole-history headway carries no prior to compare). -->
				{#if hasWaitCompare}
					<div class="block" data-slot="wait-vs-prior" data-card>
						<span class="label-with-info">
							<SectionLabel text={copy.priorDelta.waitHeading} variant="metric" />
							{@render metricInfo('headway', copy.priorDelta.waitHeading)}
						</span>
						<ul class="compare-list" data-slot="wait-compare">
							{#each waitCompareRows as row (row.key)}{@render waitCompareRow(row)}{/each}
						</ul>
						<p class="compare-caption" data-slot="wait-vs-prior-caption">
							{copy.priorDelta.caption}
						</p>
					</div>
				{/if}

				{#if shiftRows.length > 0}
					<!-- S7 P5: the per-shift regularity breakdown as THREE cross-shift magnitude-bars
					     charts (excess wait / spread (CoV) / bunching by shift) in am→night order — one
					     clean comparison per metric, replacing the cramped per-shift row stack. Each
					     <Chart> renders its own honest-absence chip when no shift carries that reading. -->
					<div class="shift-charts" data-slot="shift-regularity-charts">
						<div class="shift-chart" data-metric="excess" data-card>
							<span class="label-with-info">
								<SectionLabel text={terms.excessWait} variant="metric" />
								{@render metricInfo('excessWait', terms.excessWait)}
							</span>
							<Chart spec={excessBars} />
						</div>
						<div class="shift-chart" data-metric="cov" data-card>
							<span class="label-with-info">
								<SectionLabel text={terms.spread} variant="metric" />
								{@render metricInfo('regularityCov', terms.spread)}
							</span>
							<Chart spec={covBars} />
						</div>
						<div class="shift-chart" data-metric="bunched" data-card>
							<span class="label-with-info">
								<SectionLabel text={terms.clumped} variant="metric" />
								{@render metricInfo('regularityCov', terms.clumped)}
							</span>
							<Chart spec={bunchedBars} />
						</div>
					</div>
					<!-- What the excess-wait magnitude encodes: 0 is the GOOD case, not missing. -->
					<p class="shift-caption" data-slot="excess-wait-caption">
						{copy.strip.excessWaitCaption}
						{@render metricInfo('excessWait', terms.excessWait)}
					</p>
					<!-- A3: per-direction rows carry ONLY observed_min (scheduled/excess/cov
					     null), so the SeverityBar + scheduled/excess tiles are empty for them.
					     Present them as a compact observed-gap-by-direction comparison instead
					     of an empty RankedRow, their only real signal. The whole block already
					     lives inside <Detail>, so it shows inline (no nested <details> reveal). -->
					{#if hasAdvancedReveal}
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
					{/if}
				{:else}
					<AbsentValue variant="block" reason="no-observations" {locale} />
				{/if}
			</div>

			<!-- Service-span sub-block, only when a signal-carrying day exists. -->
			{#if hasSpan && latestSpan}
				<div class="cluster-sub" data-sub="service-span" data-card>
					<div class="span-head">
						<span class="label-with-info">
							<SectionLabel text={t.spanSection} variant="metric" />
							{@render metricInfo('serviceSpan', t.spanSection)}
						</span>
						<span class="span-window" data-slot="service-span-window">
							{copy.windows.serviceSpan(latestSpan.date ?? null)}
						</span>
					</div>

					<!-- P3: the first→last service-span TIMELINE as a LayerChart mark (24h axis + a
					     floating bar), with signed first/last-trip punctuality readings beside it. The
					     numeric tiles below remain the exact reading; this is the at-a-glance shape.
					     Honest absence (no resolvable first/last departure) lives in the selector. -->
					{#if serviceSpanSpec}
						<Chart spec={serviceSpanSpec} />
					{/if}
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
		</Detail>
	{/if}
</CollapsibleSection>

<style>
	/* The always-visible PRIMARY dumbbell block + its label/info head. */
	.section-primary {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	/* Tier-1 direction-asymmetry callout — the "which way you go changes the wait" takeaway,
	   in the same insight register as §1's takeaway (yellow overline + accent left-rule + a
	   foreground sentence), distinct from the bordered data cards. */
	.direction-callout {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		max-width: 64ch;
		padding-inline-start: 0.7rem;
		border-inline-start: 3px solid var(--accent-text);
	}
	.direction-callout :global([data-slot='section-label']) {
		color: var(--accent-text);
	}
	.direction-callout__text {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.45;
		font-weight: 500;
		color: var(--foreground);
		text-wrap: pretty;
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
	/* S7 P5: the three per-shift regularity charts (excess / spread / bunching by shift),
	   each its own labelled LayerChart magnitude-bars block, generous BETWEEN-chart air. */
	.shift-charts {
		display: flex;
		flex-direction: column;
		gap: clamp(1rem, 2.5vw, 1.75rem);
	}
	.shift-chart {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.shift-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
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
	/* Wait-by-shift · vs-prior comparison (PR-WEB-3): a label | value | Δ-badge row list,
	   mirroring the §1 on-time comparison. The label keeps a measure so the wait values align;
	   the DeltaStat badge trails and wraps to its own line on a narrow phone. */
	.block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.compare-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.compare-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
		padding: 0.3rem 0;
	}
	.compare-row + .compare-row {
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.compare-label {
		flex: 0 0 7rem;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: 500;
		color: var(--foreground);
	}
	.compare-value {
		flex: 0 0 auto;
		min-width: 3.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	.compare-caption {
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
	/* A3: the per-direction observed-gap comparison. */
	.shift-direction {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.85rem;
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
	/* Bunching explainer: plain-language "how to read this", slightly stronger than a
	   quiet caption (it teaches the page's least-intuitive concept). */
	.bunching-help {
		margin: 0.25rem 0 0;
		max-width: 60ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--foreground);
	}
</style>

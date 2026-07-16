<!--
  RepeatOffenders — the /repeat-offenders ("récidivistes") accountability surface
  ORCHESTRATOR (S14 re-seat).

  Re-seats the former flat /worst-normalized RankedRow ledger onto the S14
  re-granulated by_grain recurrence ladders. This thin orchestrator owns EVERYTHING
  the sections must not: the getRepeatOffenders resource, the codec-seeded grain +
  worst-N state (seeded from ?grain/?n via $lib/filters, clamped to the populated
  grains, mirrored back to the URL), the ONE mapping pass through the pure
  offenderLadder selector, the ArticleHeader + combined controls/contents rail,
  the article-card registry, and the honest absence.
  RepeatOffendersSection is a pure presenter fed one built ladder + tray per kind.

  RANKING (DECISIONS D3): the bar encodes each entity's SEVERE-DELAY RATE on the
  ABSOLUTE SEVERE_DOMAIN [0,100] — the rank variable, always >= 0, DB-ranked
  worst-first by the not-severe Wilson lower bound. recurrence_days ("N of M observed
  days") is EVIDENCE on the per-row note, never the rank. NO /worst, NO in-view
  normalization — the old banned idiom is gone, so the file is OFF the chartDoctrine
  allowlist (which is now EMPTY: the S14 punch-list completion, 2026-07-02).

  GRAINS (DECISIONS D3): week|month ONLY — "repeat" is undefined on a single day, so
  there is deliberately no day grain (an honest reason, not an omission). A grain is
  always visible in the control and is disabled when the payload does not serve it.

  FALLBACK (DECISIONS D5): when by_grain is absent/empty (an OLD payload) the surface
  renders the legacy scalar offenders[] as a RankedRow ledger on the ABSOLUTE
  DELAY_DIST_DOMAIN [0,15] via RankedRow's `domain` prop — still doctrine-clean.

  HONESTY: a grain with no ranked entry shows the styled AbsentValue chip (says WHY),
  never a fake 0; a null severe_pct row draws the no-data swatch. The whole-file empty
  keeps the published-empty honest note. Severity is READ from the contract, never
  re-derived client-side (DECISIONS D4). All prose comes from ./repeatOffenders.copy.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { routeFor, type SurfaceKind, type SurfaceTarget } from '$lib/nav';
	import { fromSearchParams, toSearchParams, emptyFilterState, type WorstN } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { describeAbsence } from '$lib/site/absence';
	import { fmtCount, fmtDelayMin, fmtDelayMin as sharedFmtDelayMin, fmtPct } from '$lib/utils';
	import { formatDateKey, formatUtc } from '$lib/utils/time';
	import {
		availabilityFromPointCollectionIndex,
		createHistoryCorrectionPresentation,
		createHistoryDateResource,
		getRepeatOffenders,
		getRepeatOffendersHistoryDay,
		getRepeatOffendersHistoryIndex,
		historyDateRequestFromSearchParams,
		type RepeatOffenderEntry,
		type Offender,
	} from '$lib/v1';
	import type {
		HistoricCollectionIndex,
		RepeatOffenders as RepeatOffendersData,
	} from '$lib/v1/schemas';
	import type { ChartDatumPopoverModel } from '$lib/components/dataviz/chart';
	import {
		ArticleControlDisclosure,
		ArticleControlStack,
		createRailDisclosureController,
		HistoryNavigator,
		ResourceBoundary,
		GrainPicker,
		type GrainSegment,
	} from '$lib/components/surface';
	import {
		ArticleHeader,
		ArticleSectionStack,
		DashboardGrid,
		DetailShell,
		type ArticleMetaEntry,
	} from '$lib/components/layout';
	import { AbsentValue } from '$lib/components/edge';
	import {
		CollapsibleSection,
		TocNav,
		TypedInformationCard,
		reconcileActiveToc,
		revealTocTarget,
		type TocEntry,
	} from '$lib/components/shared';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { prefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
	import { RankedRow } from '$lib/components/dataviz';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { DELAY_DIST_DOMAIN } from '$lib/features/reliability/domains';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type {
		SurfaceRailContext,
		SurfaceRailPresentation,
	} from '$lib/components/surface/SurfaceRail.svelte';

	import {
		presentGrains,
		defaultOffenderGrain,
		ladderByGrain,
		OFFENDER_GRAINS,
		type OffenderGrainKey,
	} from './data/presentGrains';
	import {
		worstNCap,
		DEFAULT_WORST_N,
		worstNSegments as buildWorstNSegments,
		SMALLEST_WORST_N,
	} from './data/ladderCap';
	import { selectOffenderLadder, type OffenderPopoverEvidence } from './selectors/offenderLadder';
	import { buildOffenderEvidenceRows } from './selectors/offenderEvidence';
	import { buildOffenderLedger } from './selectors/offenderLedger';
	import RepeatOffendersSection from './sections/RepeatOffendersSection.svelte';
	import { copy as COPY } from './repeatOffenders.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);
	const railDisclosures = createRailDisclosureController({
		controls: 'repeat-offenders-controls',
		toc: 'repeat-offenders-toc',
	});

	// The metric-explainer (i) affordance: a one-line tip + a localized deep link to
	// /metrics#<anchor>. The ladder ranks by the SEVERE-delay rate, so the (i) explains
	// severe_pct (same wiring as the hotspots / lines surfaces).
	const explainerCopy = $derived(metricsCopy[locale]);
	function buildInfo(key: MetricKey, name: string) {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	}
	const severeInfo = $derived(buildInfo('severe', t.ladder.severeRateLabel));

	// The shared coordinator owns current/history discovery, cancellation, retry,
	// refresh, and freshness. The page only derives presentation from accepted data.
	const offenders = createHistoryDateResource<HistoricCollectionIndex, RepeatOffendersData>(
		{
			loadIndex: (signal) => getRepeatOffendersHistoryIndex({ signal }),
			availability: (index) => availabilityFromPointCollectionIndex(index),
			loadCurrent: (signal) => getRepeatOffenders({ signal }),
			loadDate: (date, index, signal) => getRepeatOffendersHistoryDay(date, index, { signal }),
		},
		{
			initialRequest: historyDateRequestFromSearchParams(page.url.searchParams),
			freshness: true,
		},
	);
	onDestroy(() => offenders.destroy());
	const generatedUtc = $derived(offenders.data?.generated_utc ?? null);
	const availableDates = $derived(offenders.availableDates);
	const dateOptions = $derived(availableDates.map((date) => ({ date })));
	const hasHistoryNavigator = $derived(availableDates.length > 0);
	const historyCoverageText = $derived(
		availableDates.length === 0
			? null
			: t.history.coverage(
					formatDateKey(availableDates[0], locale),
					formatDateKey(availableDates[availableDates.length - 1], locale),
				),
	);
	const historySelectionText = $derived(
		offenders.selectedDate == null
			? null
			: t.history.selection(formatDateKey(offenders.selectedDate, locale)),
	);
	const historyCorrection = createHistoryCorrectionPresentation(
		offenders,
		() => t.history.correction,
	);
	function selectHistoryDate(date: string | undefined): void {
		historyCorrection.clear();
		offenders.setRequest({
			hasDate: date !== undefined,
			rawDate: date ?? null,
		});
	}

	/* ── grain vocabulary + availability ──────────────────────────────────────────── */
	const ladders = $derived(ladderByGrain(offenders.data?.by_grain));
	const present = $derived(presentGrains(offenders.data?.by_grain));

	// CONTRACT: the codec ($lib/filters) owns the ?grain seam — fromSearchParams
	// enum-parses the seed; invalid values drop. The SELECTION + the populated-grain
	// clamp stay SURFACE-LOCAL. week is the finest offered grain (no day here), so an
	// absent/unknown ?grain seeds to 'week'.
	let grainKey = $state<OffenderGrainKey>(
		(() => {
			const seeded = fromSearchParams(page.url.searchParams).grain;
			return seeded === 'month' ? 'month' : 'week';
		})(),
	);

	const grainLabels = $derived<Partial<Record<OffenderGrainKey, string>>>({
		week: t.grain.week,
		month: t.grain.month,
	});
	const uid = $props.id();
	const disabledReason = $derived(describeAbsence('no-observations', locale).why);
	const grainSegments = $derived<GrainSegment<OffenderGrainKey>[]>(
		OFFENDER_GRAINS.map((key) => {
			const available = present.has(key);
			return {
				key,
				label: grainLabels[key] ?? key,
				available,
				...(available ? {} : { describedById: `${uid}-reason-${key}`, title: disabledReason }),
			};
		}),
	);
	function grainSegmentsFor(
		presentation: SurfaceRailPresentation,
	): GrainSegment<OffenderGrainKey>[] {
		return grainSegments.map((segment) =>
			segment.describedById
				? { ...segment, describedById: `${segment.describedById}-${presentation}` }
				: segment,
		);
	}

	// Keep the selection on a POPULATED grain (the clamp): a chosen grain whose ladder
	// is absent falls back to the richest present grain. Never a dead/empty grain.
	$effect(() => {
		if (present.size > 0 && !present.has(grainKey)) grainKey = defaultOffenderGrain(present);
	});

	/* ── worst-N cap (codec ?n) ───────────────────────────────────────────────────── */
	let worstN = $state<WorstN>(fromSearchParams(page.url.searchParams).worstN ?? DEFAULT_WORST_N);
	const cap = $derived(worstNCap(worstN));
	const worstSegments = $derived<GrainSegment<WorstN>[]>(buildWorstNSegments(t.worstN.all));

	// Mirror date + grain + worst-N in one replaceState. Preserve the raw date only
	// while discovery is unresolved; accepted current/latest state omits it.
	const wire = $derived.by<{ date: string | null; grain: string | null; n: string | null }>(() => {
		const state = emptyFilterState();
		if (worstN !== DEFAULT_WORST_N) state.worstN = worstN;
		const grainParam =
			grainKey === 'week'
				? null
				: ((): string | null => {
						state.grain = grainKey;
						return toSearchParams(state).get('grain');
					})();
		const dateParam =
			offenders.request.hasDate && offenders.resolved == null
				? offenders.request.rawDate
				: offenders.canonicalDate;
		return { date: dateParam, grain: grainParam, n: toSearchParams(state).get('n') };
	});
	$effect(() => mirrorSearchParams(wire));

	/* ── the ONE mapping pass ─────────────────────────────────────────────────────── */
	// A row's nav target: an entity (trip/vehicle) is accountable on its offending
	// ROUTE, so the drill link goes to that line. Unknown route → no link.
	function hrefFor(e: RepeatOffenderEntry): string | null {
		const route = e.route?.trim();
		if (!route) return null;
		const kind: SurfaceKind = 'line';
		return localizeHref(routeFor({ kind, id: route }), locale);
	}
	function unnamed(e: RepeatOffenderEntry): string {
		const route = e.route?.trim();
		return route ? `${t.type.other} ${route}` : t.unnamed(e.id);
	}
	// Per-row evidence note: the natural-frequency recurrence line + severe% + n, each
	// fragment null-guarded. recurrence_days / observed_days drive the recurrence line.
	function ladderNote(e: RepeatOffenderEntry): string {
		const parts: string[] = [];
		if (e.recurrence_days != null && e.observed_days != null)
			parts.push(t.recurrence.naturalFrequency(e.recurrence_days, e.observed_days));
		else parts.push(t.recurrence.unknown);
		if (e.severe_pct != null)
			parts.push(`${t.note.severe} ${Math.round(e.severe_pct)}${t.units.pct}`);
		if (e.observation_count != null) parts.push(`${t.note.samples}=${e.observation_count}`);
		return parts.join(' · ');
	}
	function tapPopoverFor(
		entry: RepeatOffenderEntry,
		href: string | null,
		evidence: OffenderPopoverEvidence,
	): ChartDatumPopoverModel {
		const heading = entry.route_name ?? unnamed(entry);
		const rows: Array<{ label: string; value: string }> = [];
		const severe = fmtPct(entry.severe_pct, { locale, suffix: t.units.pct });
		if (severe != null) rows.push({ label: t.ladder.severeRateLabel, value: severe });
		if (evidence.wilsonLo != null && evidence.wilsonHi != null) {
			const lower = fmtPct(evidence.wilsonLo, { locale, suffix: t.units.pct });
			const upper = fmtPct(evidence.wilsonHi, { locale, suffix: t.units.pct });
			if (lower != null && upper != null) {
				rows.push({ label: t.ladder.ci, value: `${lower}–${upper}` });
			}
		}
		rows.push({
			label: t.chart.popover.recurrence,
			value:
				entry.recurrence_days != null && entry.observed_days != null
					? t.recurrence.naturalFrequency(entry.recurrence_days, entry.observed_days)
					: t.recurrence.unknown,
		});
		const averageDelay = fmtDelayMin(entry.avg_delay_min, {
			rounding: 'auto',
			locale,
			suffix: t.units.min,
		});
		if (averageDelay != null) {
			rows.push({ label: t.chart.popover.averageDelay, value: averageDelay });
		}
		const readings = fmtCount(entry.observation_count, { locale });
		if (readings != null) rows.push({ label: t.chart.popover.readings, value: readings });

		return {
			key: `${entry.type}-${entry.id}-${entry.route ?? ''}`,
			heading,
			meta: t.tray.rowSubtitle(
				entry.type === 'trip'
					? t.type.trip
					: entry.type === 'vehicle'
						? t.type.vehicle
						: t.type.other,
				entry.id,
			),
			rows,
			...(href
				? {
						action: {
							href,
							label: t.chart.popover.viewLine,
							ariaLabel: t.viewDetail(heading),
						},
					}
				: {}),
		};
	}

	const activeLadder = $derived(ladders.get(grainKey));
	function kindEntriesFor(kind: 'trip' | 'vehicle'): RepeatOffenderEntry[] {
		return (activeLadder?.entries ?? []).filter((entry) => entry.type === kind);
	}

	// entries[] is a MIXED trip+vehicle array ranked PER KIND. Build a ladder for EACH
	// kind by filtering entries[] by type losslessly. shown/total per kind uses the DB's
	// per-kind ranked totals — a display-N truncation never rescales.
	function ladderFor(kind: 'trip' | 'vehicle', total: number | null | undefined) {
		const kindEntries = kindEntriesFor(kind);
		const res = selectOffenderLadder(kindEntries, cap, locale, {
			title: t.ladder.heading,
			rowLabel: kind === 'trip' ? t.type.trip : t.type.vehicle,
			xLabel: t.ladder.severeRateLabel,
			unit: t.units.pct,
			ciLabel: t.ladder.ci,
			note: ladderNote,
			unnamed,
			href: hrefFor,
			tapPopover: tapPopoverFor,
		});
		return { ...res, total: total ?? res.total };
	}
	const tripLadder = $derived(ladderFor('trip', activeLadder?.total_ranked_trips));
	const vehicleLadder = $derived(ladderFor('vehicle', activeLadder?.total_ranked_vehicles));
	function evidenceFor(kind: 'trip' | 'vehicle') {
		return buildOffenderEvidenceRows(kindEntriesFor(kind), cap, {
			unnamed,
			href: hrefFor,
			ariaLabel: t.viewDetail,
			typeId: (entry) =>
				t.tray.rowSubtitle(kind === 'trip' ? t.type.trip : t.type.vehicle, entry.id),
			severeRate: (value) => fmtPct(value, { locale, suffix: t.units.pct }),
			confidenceInterval: (lower, upper) => {
				const formattedLower = fmtPct(lower, { locale, suffix: t.units.pct });
				const formattedUpper = fmtPct(upper, { locale, suffix: t.units.pct });
				return `${formattedLower}–${formattedUpper}`;
			},
			recurrence: (entry) =>
				entry.recurrence_days != null && entry.observed_days != null
					? t.recurrence.naturalFrequency(entry.recurrence_days, entry.observed_days)
					: t.recurrence.unknown,
			averageDelay: (value) =>
				fmtDelayMin(value, { rounding: 'auto', locale, suffix: t.units.min }),
			readings: (value) => fmtCount(value, { locale }),
		});
	}
	const tripEvidence = $derived(evidenceFor('trip'));
	const vehicleEvidence = $derived(evidenceFor('vehicle'));

	// §C5.12 #1-OFFENDER HERO: entries[] is DB-ranked worst-first by the Wilson lower
	// bound, so entries[0] IS the #1 offender. The hero names it + shows its streak
	// (recurrence natural frequency) + its Wilson-bounded severe rate. Honest: a null rate
	// / absent bounds degrade the clause (never a fabricated confidence); no entries →
	// the stand-down line. The bar's Wilson bracket the COMPLEMENTARY not-severe rate, so
	// flip onto the severe scale ([100−hi, 100−lo]) exactly as the ladder selector does.
	const topOffender = $derived<RepeatOffenderEntry | null>(activeLadder?.entries?.[0] ?? null);
	const round1 = (x: number): number => Math.round(x * 10) / 10;
	const heroName = $derived(topOffender ? (topOffender.route_name ?? unnamed(topOffender)) : null);
	const heroStreak = $derived.by<string | null>(() => {
		if (!topOffender) return null;
		return topOffender.recurrence_days != null && topOffender.observed_days != null
			? t.recurrence.naturalFrequency(topOffender.recurrence_days, topOffender.observed_days)
			: t.recurrence.unknown;
	});
	const heroRate = $derived.by<string | null>(() => {
		if (!topOffender) return null;
		const sev = topOffender.severe_pct;
		if (sev == null) return null;
		const ratePct = `${Math.round(sev)}${t.units.pct}`;
		// Flip the Wilson bounds onto the severe scale (100 − complementary bound).
		if (topOffender.wilson_lo != null && topOffender.wilson_hi != null) {
			const lo = round1(100 - topOffender.wilson_hi);
			const hi = round1(100 - topOffender.wilson_lo);
			return t.hero.rateWithCi(ratePct, `${lo}`, `${hi}`);
		}
		return t.hero.rateNoCi(ratePct);
	});
	const heroHref = $derived(topOffender ? hrefFor(topOffender) : null);

	// The un-ranked tray rows (sub-MIN_N entities) mapped to the section's display shape,
	// split by kind so each article card shows only its own kind's tray.
	function trayFor(kind: 'trip' | 'vehicle') {
		return (activeLadder?.tray ?? [])
			.filter((e) => e.type === kind)
			.map((e) => {
				const href = hrefFor(e);
				const title = e.route_name ?? unnamed(e);
				const tag = kind === 'trip' ? t.type.trip : t.type.vehicle;
				return {
					key: `${e.type}-${e.id}-${e.route ?? ''}`,
					title,
					subtitle: t.tray.rowSubtitle(tag, e.id),
					href,
					ariaLabel: t.viewDetail(title),
				};
			});
	}
	const tripTray = $derived(trayFor('trip'));
	const vehicleTray = $derived(trayFor('vehicle'));

	// Retained days may be left-censored; do not promise a complete trailing window.
	const windowCaption = $derived(
		offenders.mode === 'history' && offenders.selectedDate != null
			? t.history.retainedWindow(formatDateKey(offenders.selectedDate, locale))
			: t.window[grainKey],
	);

	/* ── the legacy fallback ledger (by_grain absent) ─────────────────────────────── */
	// When the payload publishes NO populated grain, fall back to the scalar offenders[]
	// as a RankedRow ledger on the ABSOLUTE DELAY_DIST_DOMAIN [0,15] (doctrine-clean).
	function typeLabel(type: string): string {
		return type === 'route'
			? t.type.route
			: type === 'stop'
				? t.type.stop
				: type === 'trip'
					? t.type.trip
					: type === 'vehicle'
						? t.type.vehicle
						: t.type.other;
	}
	function fmtMin(v: number | null): string | null {
		return sharedFmtDelayMin(v, { rounding: 'fixed1', suffix: t.units.min });
	}
	// Resolve a legacy offender to its detail route (the orchestrator owns $lib/nav). A
	// 'stop' → /stop/{id}; a route id → /lines/{route}; a 'route' type → /lines/{id};
	// failing all, a non-navigating self target so the link is never broken.
	function legacyHref(o: Offender): string {
		const target: SurfaceTarget =
			o.type === 'stop'
				? { kind: 'stop', id: o.id }
				: o.route?.trim()
					? { kind: 'line', id: o.route.trim() }
					: o.type === 'route'
						? { kind: 'line', id: o.id }
						: { kind: 'stop', id: o.id };
		return localizeHref(routeFor(target), locale);
	}
	const legacyRows = $derived(
		buildOffenderLedger(offenders.data?.offenders ?? [], {
			typeLabel,
			recurrenceLabel: t.recurrenceLabel,
			recurrenceUnknown: t.recurrenceUnknown,
			fmtMin,
			viewDetail: t.viewDetail,
			href: legacyHref,
		}),
	);

	// Which path renders: the primary by_grain ladders when ANY grain is populated, else
	// the legacy scalar ledger. The whole surface stands down (boundary empty) only when
	// BOTH are empty.
	const hasGrains = $derived(present.size > 0);
	const hasLegacy = $derived((offenders.data?.offenders?.length ?? 0) > 0);
	const isEmpty = $derived(!hasGrains && !hasLegacy);
	const showCombinedRail = $derived(
		(offenders.data != null && (hasGrains || hasLegacy)) ||
			(offenders.mode === 'history' && hasHistoryNavigator),
	);
	const showWorstN = $derived(
		hasGrains && (tripLadder.total > SMALLEST_WORST_N || vehicleLadder.total > SMALLEST_WORST_N),
	);
	const controlsSummary = $derived(hasGrains ? (grainLabels[grainKey] ?? '') : '');

	const sectionDefs = $derived([
		{
			id: 'repeat-worst',
			sectionKey: 'repeat-card-worst',
			number: 1,
			title: t.cards.worst.title,
			subtitle:
				offenders.mode === 'history' ? t.history.retainedWorstSubtitle : t.cards.worst.subtitle,
			present: hasGrains || hasLegacy,
		},
		{
			id: 'repeat-trips',
			sectionKey: 'repeat-card-trips',
			number: 2,
			title: t.cards.trips.title,
			subtitle: t.cards.trips.subtitle,
			present: hasGrains && (tripLadder.shown > 0 || tripTray.length > 0),
		},
		{
			id: 'repeat-vehicles',
			sectionKey: 'repeat-card-vehicles',
			number: 3,
			title: t.cards.vehicles.title,
			subtitle: t.cards.vehicles.subtitle,
			present: hasGrains && (vehicleLadder.shown > 0 || vehicleTray.length > 0),
		},
	]);
	const tocEntries = $derived<TocEntry[]>(
		sectionDefs
			.filter((section) => section.present)
			.map((section) => ({
				id: section.id,
				title: section.title,
				level: 2,
				badge: { kind: 'number' as const, value: section.number },
				children: [],
			})),
	);
	const openableAnchors = $derived(new Set(tocEntries.map((entry) => entry.id)));
	const articleMeta = $derived.by((): readonly ArticleMetaEntry[] => {
		const entries: ArticleMetaEntry[] = [];
		if (generatedUtc) {
			entries.push({
				text: formatUtc(generatedUtc, locale),
				datetime: generatedUtc,
				label: t.asOf,
			});
		}
		if (tocEntries.length > 0) entries.push(t.article.sections(tocEntries.length));
		return entries;
	});

	let activeId = $state('');
	let cardOpenSignals = $state<Record<string, number>>({});
	let navigationGeneration = 0;
	let previousTocIds: string[] = [];
	function openCard(id: string): void {
		cardOpenSignals = {
			...cardOpenSignals,
			[id]: (cardOpenSignals[id] ?? 0) + 1,
		};
	}
	function cardOpenSignal(id: string): number {
		return quietModeStore.openSignal + (cardOpenSignals[id] ?? 0);
	}
	async function navigate(id: string): Promise<void> {
		const generation = ++navigationGeneration;
		await revealTocTarget(id, {
			beforeReveal: openableAnchors.has(id) ? openCard : undefined,
			isCurrent: () => generation === navigationGeneration,
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth',
		});
	}
	$effect(() => {
		const next = tocEntries.map((entry) => entry.id);
		activeId = reconcileActiveToc(activeId, previousTocIds, next);
		previousTocIds = next;
	});
</script>

<DetailShell
	class="repeat-offenders-detail"
	bind:activeId
	{tocEntries}
	combinedRailConfig={showCombinedRail
		? {
				label: t.rail.label,
				summary: controlsSummary,
				openAria: t.rail.open,
				closeAria: t.rail.close,
			}
		: undefined}
>
	{#snippet articleHeader()}
		<ArticleHeader
			watermark={t.article.watermark}
			category={t.kicker}
			title={t.heading}
			tags={t.article.tags}
			tagsAria={t.article.tagsAria}
			backHref={localizeHref('/', locale)}
			backLabel={t.article.back}
			meta={articleMeta}
			metaPending={offenders.loading || !offenders.settled}
			titleId="repeat-offenders-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet combinedRail({ closeSheet, presentation }: SurfaceRailContext)}
		{@const presentedGrainSegments = grainSegmentsFor(presentation)}
		{#snippet historyControls()}
			{#key historyCorrection.revision}
				<HistoryNavigator
					mode="date"
					date={offenders.selectedDate ?? undefined}
					{dateOptions}
					previousDate={offenders.previousDate}
					nextDate={offenders.nextDate}
					coverageText={historyCoverageText}
					selectionText={historySelectionText}
					announcement={historyCorrection.announcement}
					liveAnnouncement={false}
					{locale}
					labels={t.history.navigator}
					onDateChange={selectHistoryDate}
				/>
			{/key}
		{/snippet}
		{#snippet primaryControls()}
			<GrainPicker
				segments={presentedGrainSegments}
				bind:value={grainKey}
				label={t.grain.label}
				variant="time-grid"
			/>
			{#each presentedGrainSegments as segment (segment.key)}
				{#if segment.describedById}
					<span id={segment.describedById} class="repeat-grain-reason" data-slot="controls-reason">
						{disabledReason}
					</span>
				{/if}
			{/each}
		{/snippet}
		{#snippet secondaryControls()}
			<GrainPicker segments={worstSegments} bind:value={worstN} label={t.worstN.label} />
		{/snippet}
		{#snippet windowCaptionControl()}
			<p class="repeat-window" data-slot="active-window" aria-live="polite">
				{windowCaption}
			</p>
		{/snippet}

		{#if hasGrains || hasHistoryNavigator}
			<ArticleControlDisclosure
				title={t.rail.controls}
				bind:open={
					() => railDisclosures.isOpen('controls'), (next) => railDisclosures.set('controls', next)
				}
			>
				<ArticleControlStack
					history={hasHistoryNavigator ? historyControls : undefined}
					primary={hasGrains ? primaryControls : undefined}
					secondary={hasGrains && showWorstN ? secondaryControls : undefined}
					caption={hasGrains ? windowCaptionControl : undefined}
				/>
			</ArticleControlDisclosure>
		{/if}
		{#if tocEntries.length > 0}
			<div class="repeat-rail-toc" data-slot="section-toc">
				<TocNav
					entries={tocEntries}
					{activeId}
					heading={t.rail.toc}
					counterPrefix={t.rail.counterPrefix}
					bind:open={
						() => railDisclosures.isOpen('toc'), (next) => railDisclosures.set('toc', next)
					}
					onNavigate={(id) => {
						closeSheet();
						void navigate(id);
					}}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet center()}
		<p
			class="repeat-history-live"
			data-slot="history-page-announcement"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			{historyCorrection.announcement ?? ''}
		</p>
		<ResourceBoundary resource={offenders} lang={locale}>
			{#if isEmpty}
				<div class="repeat-offenders-note" data-slot="offenders-empty">
					<AbsentValue variant="block" reason="no-observations" {locale} />
				</div>
			{:else}
				<ArticleSectionStack data-slot="repeat-offenders-sections">
					{#each sectionDefs as section (section.id)}
						{#if section.present}
							<CollapsibleSection
								title={section.title}
								subtitle={section.subtitle}
								headerVariant="article-summary"
								anchor={section.id}
								sectionKey={section.sectionKey}
								index={section.number - 1}
								open={true}
								closeSignal={quietModeStore.closeSignal}
								openSignal={cardOpenSignal(section.id)}
								bulkCollapsed={quietModeStore.enabled}
							>
								{#if section.id === 'repeat-worst' && hasGrains}
									<div class="repeat-offenders-article-prose">
										<p class="repeat-offenders-lede">{t.lede}</p>
										<div
											class="offenders-hero"
											data-slot="offenders-hero"
											aria-label={t.hero.label}
										>
											{#if topOffender && heroName != null}
												<span class="offenders-hero-overline">{t.hero.overline}</span>
												{#if heroHref}
													<a class="offenders-hero-name" href={heroHref}>{heroName}</a>
												{:else}
													<span class="offenders-hero-name">{heroName}</span>
												{/if}
												{#if heroRate}
													<p class="offenders-hero-rate">{heroRate}</p>
												{/if}
												{#if heroStreak}
													<p class="offenders-hero-streak">
														<span class="offenders-hero-streak-label">{t.hero.streakLabel}</span>
														{heroStreak}
													</p>
												{/if}
											{:else}
												<p class="offenders-hero-none">
													{offenders.mode === 'history' ? t.history.retainedHeroNone : t.hero.none}
												</p>
											{/if}
										</div>
										<p class="offenders-def" data-slot="offenders-def">
											{t.headline.explanation}
											<MetricInfo
												tip={severeInfo.tip}
												href={severeInfo.href}
												label={severeInfo.label}
												linkLabel={severeInfo.linkLabel}
												side="bottom"
											/>
										</p>
										<TypedInformationCard kind="caveat" label={t.caveatLabel}>
											<p>{t.caveat}</p>
										</TypedInformationCard>
									</div>
								{:else if section.id === 'repeat-worst'}
									<div class="repeat-offenders-block">
										<SectionHeading level={3} overline={t.listSection}>
											{#snippet explainer()}
												<MetricInfo
													tip={severeInfo.tip}
													href={severeInfo.href}
													label={severeInfo.label}
													linkLabel={severeInfo.linkLabel}
													side="bottom"
												/>
											{/snippet}
										</SectionHeading>
										<p class="repeat-offenders-caption">{t.rowCaption}</p>
										<DashboardGrid
											as="ul"
											minTile="360px"
											gutter={false}
											class="repeat-offenders-ranked"
											aria-label={t.listSummary}
										>
											{#each legacyRows as row (row.key)}
												<li class="repeat-offenders-item">
													<a
														class="repeat-offenders-link"
														href={row.href}
														data-sveltekit-preload-data="hover"
														data-slot="offender-link"
														aria-label={row.ariaLabel}
													>
														<RankedRow
															bare
															rank={row.rank}
															title={row.title}
															subtitle={row.subtitle}
															severity={row.severity}
															value={row.value}
															domain={DELAY_DIST_DOMAIN}
															unit={t.units.min}
															display={row.display}
															absentReason="no-observations"
															{locale}
														/>
													</a>
												</li>
											{/each}
										</DashboardGrid>
										<TypedInformationCard kind="caveat" label={t.caveatLabel}>
											<p>{t.caveat}</p>
										</TypedInformationCard>
									</div>
								{:else if section.id === 'repeat-trips'}
									<RepeatOffendersSection
										heading={t.ladder.heading}
										ladder={tripLadder}
										tray={tripTray}
										evidence={tripEvidence}
										{windowCaption}
										info={severeInfo}
										{locale}
										copy={t}
									/>
								{:else}
									<RepeatOffendersSection
										heading={t.ladder.heading}
										ladder={vehicleLadder}
										tray={vehicleTray}
										evidence={vehicleEvidence}
										{windowCaption}
										info={severeInfo}
										{locale}
										copy={t}
									/>
								{/if}
							</CollapsibleSection>
						{/if}
					{/each}
				</ArticleSectionStack>
			{/if}
		</ResourceBoundary>
	{/snippet}
</DetailShell>

<style>
	.repeat-grain-reason {
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
	.repeat-history-live {
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
	.repeat-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.repeat-rail-toc {
		margin-top: 0.25rem;
	}
	.repeat-offenders-article-prose {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
		color: var(--foreground);
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
	}
	.repeat-offenders-lede {
		margin: 0;
		font-size: var(--text-detail-lede-mobile);
		line-height: 1.65;
	}
	/* §C5.12 #1-offender hero — a solid card (occlusion law) leading with the worst
	   entity's name, its Wilson-bounded severe rate + its streak. */
	.offenders-hero {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 1.1rem 1.25rem;
		border: 2px solid var(--border-rule);
		border-radius: var(--radius-lg);
		background: var(--surface-2);
	}
	.offenders-hero-overline {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.offenders-hero-name {
		font-family: var(--font-heading);
		font-size: var(--text-title);
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: var(--tracking-tight);
		color: var(--foreground);
		text-decoration: none;
	}
	a.offenders-hero-name {
		border-bottom: 1px solid transparent;
		transition: border-color var(--duration-fast) var(--ease-default);
		width: fit-content;
	}
	a.offenders-hero-name:hover,
	a.offenders-hero-name:focus-visible {
		border-bottom-color: var(--primary);
	}
	a.offenders-hero-name:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.offenders-hero-rate {
		margin: 0;
		font-size: var(--text-subheading);
		line-height: 1.4;
		color: var(--foreground);
	}
	.offenders-hero-streak,
	.offenders-hero-none {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.offenders-hero-streak-label {
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--accent-text);
		margin-inline-end: 0.375rem;
	}
	/* The demoted definition — a quiet lede beneath the hero, with its (i) inline. */
	.offenders-def {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		max-width: 72ch;
		font-size: var(--text-small);
		line-height: 1.55;
		color: var(--muted-foreground);
	}
	.repeat-offenders-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	:global(.dashboard-grid.repeat-offenders-ranked) {
		max-width: var(--container-wide);
		margin-inline: auto;
	}
	.repeat-offenders-item {
		display: block;
	}
	.repeat-offenders-link {
		display: block;
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius-lg);
	}
	.repeat-offenders-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.repeat-offenders-caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* The honest empty state wraps the styled AbsentValue block; the container centers it. */
	.repeat-offenders-note {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0;
	}
</style>

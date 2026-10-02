<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { routeFor, type SurfaceKind, type SurfaceTarget } from '$lib/nav';
	import { fromSearchParams, toSearchParams, emptyFilterState, type WorstN } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { absenceSentence } from '$lib/site/absence';
	import { fmtCount, fmtDelayMin, fmtDelayMin as sharedFmtDelayMin, fmtPct } from '$lib/utils';
	import { formatDateKey, formatUtc } from '$lib/utils/time';
	import { availabilityFromPointCollectionIndex } from '$lib/v1/history/selection';
	import { createHistoryCorrectionPresentation } from '$lib/v1/history/datePresentation.svelte';
	import {
		createHistoryDateResource,
		historyDateRequestFromSearchParams,
	} from '$lib/v1/history/dateResource.svelte';
	import {
		getRepeatOffenders,
		getRepeatOffendersHistoryDay,
		getRepeatOffendersHistoryIndex,
	} from '$lib/v1/repositories/historic';
	import type { RepeatOffenderEntry, Offender } from '$lib/v1/schemas';
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
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import { RankedRow } from '$lib/components/dataviz';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { DELAY_DIST_DOMAIN } from '$lib/features/reliability/domains';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type {
		SurfaceRailContext,
		SurfaceRailPresentation,
	} from '$lib/components/surface/SurfaceRail.svelte';

	import {
		ladderGrains,
		OFFENDER_GRAINS,
		type OffenderGrainKey,
	} from '$lib/reliability/ladderGrains';
	import {
		worstNCap,
		DEFAULT_WORST_N,
		worstNSegments as buildWorstNSegments,
		SMALLEST_WORST_N,
	} from '$lib/reliability/ladderCap';
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

	const offenders = createHistoryDateResource<HistoricCollectionIndex, RepeatOffendersData>(
		{
			loadIndex: (signal) => getRepeatOffendersHistoryIndex({ signal }),
			availability: (index) => availabilityFromPointCollectionIndex(index),
			loadCurrent: (signal) => getRepeatOffenders({ signal }),
			loadDate: (date, index, signal) => getRepeatOffendersHistoryDay(date, index, { signal }),
		},
		{
			initialRequest: historyDateRequestFromSearchParams(page.url.searchParams),
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

	const grains = $derived(ladderGrains(offenders.data?.by_grain, OFFENDER_GRAINS));
	const ladders = $derived(grains.ladders);
	const present = $derived(grains.present);

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
	const disabledReason = $derived(absenceSentence('no-observations', locale));
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

	$effect(() => {
		if (present.size > 0 && !present.has(grainKey)) grainKey = grains.defaultGrain;
	});

	let worstN = $state<WorstN>(fromSearchParams(page.url.searchParams).worstN ?? DEFAULT_WORST_N);
	const cap = $derived(worstNCap(worstN));
	const worstSegments = $derived<GrainSegment<WorstN>[]>(buildWorstNSegments(t.worstN.all));

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

	const topOffender = $derived<RepeatOffenderEntry | null>(activeLadder?.entries?.[0] ?? null);
	const round1 = (x: number): number => Math.round(x * 10) / 10;
	const heroName = $derived(topOffender ? (topOffender.route_name ?? unnamed(topOffender)) : null);
	const heroRecurrence = $derived.by<string | null>(() => {
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
		if (topOffender.wilson_lo != null && topOffender.wilson_hi != null) {
			const lo = round1(100 - topOffender.wilson_hi);
			const hi = round1(100 - topOffender.wilson_lo);
			return t.hero.rateWithCi(ratePct, `${lo}`, `${hi}`);
		}
		return t.hero.rateNoCi(ratePct);
	});
	const heroHref = $derived(topOffender ? hrefFor(topOffender) : null);

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

	const windowCaption = $derived(
		offenders.mode === 'history' && offenders.selectedDate != null
			? t.history.retainedWindow(formatDateKey(offenders.selectedDate, locale))
			: t.window[grainKey],
	);

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
			behavior: $prefersReducedMotion ? 'auto' : 'smooth',
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
												{#if heroRecurrence}
													<p class="offenders-hero-recurrence">
														<span class="offenders-hero-recurrence-label"
															>{t.hero.recurrenceLabel}</span
														>
														{heroRecurrence}
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
												metricKey="severe"
												{locale}
												name={t.ladder.severeRateLabel}
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
													metricKey="severe"
													{locale}
													name={t.ladder.severeRateLabel}
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
	.offenders-hero-recurrence,
	.offenders-hero-none {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.offenders-hero-recurrence-label {
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--accent-text);
		margin-inline-end: 0.375rem;
	}
	.offenders-def {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
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
	.repeat-offenders-note {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0;
	}
</style>

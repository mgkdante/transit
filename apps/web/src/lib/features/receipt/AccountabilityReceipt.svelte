<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { absenceShort, routeNameFallback, stopNameFallback } from '$lib/site/absence';
	import { layout, routeFor } from '$lib/nav';
	import { mirrorSearchParam } from '$lib/site/urlMirror';
	import { formatDateKey, formatUtc } from '$lib/utils/time';
	import {
		fmtCount as sharedFmtCount,
		fmtDelayMin as sharedFmtDelayMin,
		fmtPct as sharedFmtPct,
	} from '$lib/utils';
	import { shiftLabel } from '$lib/features/reliability/shiftGrains';
	import { getAdvertisedReceipt, getReceiptsIndex } from '$lib/v1/repositories/historic';
	import type { Receipt } from '$lib/v1';
	import { getV1Context } from '$lib/v1/boot';
	import { receiptObservation } from './selectors/observation';
	import ObservationCopy from './ObservationCopy.svelte';
	import {
		availabilityFromReceiptsIndex,
		datesForAvailability,
		nextAvailableDate,
		previousAvailableDate,
		resolveHistoryDate,
		type HistoryCorrection,
	} from '$lib/v1/history/selection';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		createRailDisclosureController,
		HistoryNavigator,
		ResourceBoundary,
	} from '$lib/components/surface';
	import { historyCopy } from '$lib/components/surface/historyCopy';
	import {
		ArticleHeader,
		ArticleSectionStack,
		DetailShell,
		type ArticleMetaEntry,
	} from '$lib/components/layout';
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
	import type { SurfaceRailContext } from '$lib/components/surface/SurfaceRail.svelte';
	import { EdgeState, StateNotice } from '$lib/components/edge';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import { copy as COPY } from './receipt.copy';
	import { selectHeadlineKpis } from './selectors/headlineKpis';
	import { selectAffectedCounts } from './selectors/affectedCounts';
	import { selectWorstOfDay } from './selectors/day-worst';
	import { selectReceiptTimeOfDay } from './selectors/timeOfDay';
	import { selectStateCuts } from './selectors/stateCuts';
	import { selectNotReportedLines } from './selectors/notReportedLines';
	import SectionHeadline from './sections/SectionHeadline.svelte';
	import SectionAffected from './sections/SectionAffected.svelte';
	import SectionWorst from './sections/SectionWorst.svelte';
	import SectionTimeOfDay from './sections/SectionTimeOfDay.svelte';
	import SectionStateCuts from './sections/SectionStateCuts.svelte';
	import SectionNotReported from './sections/SectionNotReported.svelte';

	const locale: Locale = getLocale();
	const manifest = getV1Context().manifest;
	const t = $derived(COPY[locale]);
	const railDisclosures = createRailDisclosureController({
		controls: 'receipt-controls',
		toc: 'receipt-toc',
	});

	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	const index = createResource((signal) => getReceiptsIndex({ signal }));
	const historyAvailability = $derived(availabilityFromReceiptsIndex(index.data));
	const availableDates = $derived(datesForAvailability(historyAvailability));
	const dateOptions = $derived(availableDates.map((date) => ({ date })));
	const hasDates = $derived(availableDates.length > 0);

	const seededDate = page.url.searchParams.get('date');
	let selectedDate = $state('');
	let canonicalDate = $state<string | null>(null);
	let historyAnnouncement = $state<string | null>(null);
	let dateSeeded = $state(false);
	let navigatorRevision = $state(0);
	function correctionCopy(reason: HistoryCorrection['reason']): string {
		return t.history.correction[reason];
	}
	function selectDate(rawDate: unknown): void {
		const resolved = resolveHistoryDate(rawDate, historyAvailability);
		const resetControlledInput =
			dateSeeded && resolved.correction != null && resolved.selection === selectedDate;
		selectedDate = resolved.selection ?? '';
		canonicalDate = resolved.canonicalDate;
		historyAnnouncement = resolved.correction ? correctionCopy(resolved.correction.reason) : null;
		if (resetControlledInput) navigatorRevision += 1;
	}
	$effect(() => {
		if (!dateSeeded && index.settled && index.error == null && index.data != null) {
			selectDate(seededDate);
			dateSeeded = true;
		}
	});

	$effect(() => {
		if (!dateSeeded) return;
		mirrorSearchParam('date', canonicalDate);
	});
	const previousDate = $derived(
		selectedDate ? previousAvailableDate(selectedDate, historyAvailability) : null,
	);
	const nextDate = $derived(
		selectedDate ? nextAvailableDate(selectedDate, historyAvailability) : null,
	);
	const historyCoverageText = $derived(
		availableDates.length === 0
			? null
			: t.history.coverage(
					formatDateKey(availableDates[0], locale),
					formatDateKey(availableDates[availableDates.length - 1], locale),
				),
	);
	const historySelectionText = $derived(
		selectedDate ? t.history.selection(formatDateKey(selectedDate, locale)) : null,
	);

	const receipt = createResource<Receipt | null>((signal) => {
		const indexData = index.data;
		const date = selectedDate;
		if (!indexData || !date || !availableDates.includes(date)) return Promise.resolve(null);
		return getAdvertisedReceipt(indexData, date, { signal });
	});
	const receiptReady = $derived(
		selectedDate !== '' &&
			receipt.settled &&
			!receipt.loading &&
			receipt.error == null &&
			receipt.data != null &&
			receipt.data.date === selectedDate,
	);
	const currentReceipt = $derived(receiptReady ? receipt.data : null);
	const generatedUtc = $derived(currentReceipt?.generated_utc ?? null);
	const observationText = $derived(
		currentReceipt && index.data
			? receiptObservation(currentReceipt, index.data, manifest, locale, page.url.origin)
			: null,
	);

	const fmtPct = (v: number | null | undefined) => sharedFmtPct(v, { suffix: t.units.pct });
	const fmtMinTile = (v: number | null | undefined) =>
		sharedFmtDelayMin(v, { rounding: 'auto', suffix: t.units.min });
	const fmtSeverePct = (v: number | null | undefined) =>
		sharedFmtPct(v, { rounding: 'fixed1', suffix: t.units.pct });
	const fmtCount = (v: number | null | undefined) => sharedFmtCount(v, { locale });
	const fmtSharePct = (v: number | null) =>
		sharedFmtPct(v, { rounding: 'fixed1', suffix: t.units.pct });
	const fmtMinInline = (v: number | null | undefined) =>
		sharedFmtDelayMin(v, {
			rounding: 'auto',
			suffix: t.units.min,
			noData: absenceShort('not-reported', locale),
		});
	const fmtDelta = (v: number | null | undefined) => {
		if (v == null) return absenceShort('not-reported', locale);
		return `${v > 0 ? '+' : ''}${v}${t.units.pts}`;
	};

	const headlineKpis = $derived(
		currentReceipt
			? selectHeadlineKpis(currentReceipt, {
					onTime: t.metrics.onTime,
					avgDelay: t.metrics.avgDelay,
					severe: t.metrics.severe,
					fmtPct,
					fmtMin: fmtMinTile,
					fmtSeverePct,
				})
			: [],
	);
	const affectedCounts = $derived(
		currentReceipt
			? selectAffectedCounts(currentReceipt, {
					routes: t.counts.routes,
					stops: t.counts.stops,
					alerts: t.counts.alerts,
					vehicles: t.counts.vehicles,
					fmtCount,
				})
			: [],
	);
	const worst = $derived(
		selectWorstOfDay(currentReceipt ?? { worst_route: null, worst_stop: null }, {
			routeName: (id, name) => name ?? routeNameFallback(id, locale),
			stopName: (id, name) => name ?? stopNameFallback(id, locale),
			routeLabel: t.worst.routeLabel,
			stopLabel: t.worst.stopLabel,
			routeDeltaLabel: t.worst.routeDeltaLabel,
			stopDelayLabel: t.worst.stopDelayLabel,
			fmtDelta,
			fmtMin: fmtMinInline,
		}),
	);
	const timeOfDay = $derived(
		selectReceiptTimeOfDay(currentReceipt?.by_shift, { shiftLabel: (s) => shiftLabel(s, locale) }),
	);
	const stateCuts = $derived(
		selectStateCuts(currentReceipt?.service_states, {
			delivered: t.stateCuts.delivered,
			cancelled: t.stateCuts.cancelled,
			silent: t.stateCuts.silent,
			fmtSharePct,
		}),
	);
	const dayVerdict = $derived.by<string | null>(() => {
		const r = currentReceipt;
		if (r == null) return null;
		if (r.otp_pct == null) return t.dayVerdict.none;
		const clauses: string[] = [t.dayVerdict.otp(`${r.otp_pct}${t.units.pct}`)];
		const wr = r.worst_route;
		if (wr?.name != null && wr.otp_delta_pts != null) {
			clauses.push(t.dayVerdict.worst(wr.name, fmtDelta(wr.otp_delta_pts)));
		}
		if (r.affected_routes != null) clauses.push(t.dayVerdict.affected(r.affected_routes));
		const comp = r.service_states?.service_completeness_pct ?? null;
		clauses.push(
			comp != null
				? t.dayVerdict.completeness(fmtSharePct(comp) ?? `${comp}${t.units.pct}`)
				: t.dayVerdict.completenessStandDown,
		);
		return `${clauses.join(' · ')}.`;
	});

	const notReported = $derived(
		selectNotReportedLines(currentReceipt?.service_states, {
			routeName: (id, name) => name ?? routeNameFallback(id, locale),
			rowLabel: t.notReported.rowLabel,
			href: (id) => localizeHref(routeFor({ kind: 'line', id }), locale),
			viewDetail: (id) => t.notReported.viewDetail(id),
			fmtScheduled: (v) => (v == null ? null : t.notReported.scheduled(v)),
		}),
	);

	const sectionDefs = $derived([
		{
			id: 'receipt-main',
			sectionKey: 'receipt-card-main',
			number: 1,
			title: t.cards.main.title,
			subtitle: t.cards.main.subtitle,
			present: currentReceipt != null,
		},
		{
			id: 'receipt-time',
			sectionKey: 'receipt-card-time',
			number: 2,
			title: t.cards.time.title,
			subtitle: t.cards.time.subtitle,
			present: currentReceipt != null && timeOfDay.hasTimeOfDay,
		},
		{
			id: 'receipt-delivered',
			sectionKey: 'receipt-card-delivered',
			number: 3,
			title: t.cards.delivered.title,
			subtitle: t.cards.delivered.subtitle,
			present: currentReceipt != null && stateCuts.hasData,
		},
		{
			id: 'receipt-silent',
			sectionKey: 'receipt-card-silent',
			number: 4,
			title: t.cards.silent.title,
			subtitle: t.cards.silent.subtitle,
			present: currentReceipt != null && notReported.hasData,
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
	const railSummary = $derived(selectedDate ? formatDateKey(selectedDate, locale) : '');
	const articleMeta = $derived.by((): readonly ArticleMetaEntry[] => {
		const entries: ArticleMetaEntry[] = [];
		if (generatedUtc) {
			entries.push({
				text: formatUtc(generatedUtc, locale),
				datetime: generatedUtc,
				label: t.article.generatedLabel,
			});
		}
		if (selectedDate) {
			entries.push({ text: formatDateKey(selectedDate, locale), label: t.article.selectedLabel });
		}
		if (tocEntries.length > 0) entries.push(t.article.sections(tocEntries.length));
		return entries;
	});
	const metaPending = $derived(
		index.loading ||
			!index.settled ||
			(selectedDate !== '' && (receipt.loading || !receipt.settled)),
	);

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
		const settledEmpty =
			selectedDate !== '' &&
			receipt.settled &&
			!receipt.loading &&
			receipt.error == null &&
			receipt.data == null;
		if (next.length === 0 && !settledEmpty) return;
		activeId = reconcileActiveToc(activeId, previousTocIds, next);
		previousTocIds = next;
	});
</script>

<p
	class="sr-only"
	data-slot="history-page-announcement"
	role="status"
	aria-live="polite"
	aria-atomic="true"
>
	{historyAnnouncement ?? ''}
</p>

<DetailShell
	class="receipt-detail"
	bind:activeId
	{tocEntries}
	combinedRailConfig={hasDates
		? {
				label: t.rail.label,
				summary: railSummary,
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
			{metaPending}
			titleId="receipt-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet combinedRail({ closeSheet }: SurfaceRailContext)}
		<CollapsibleSection
			title={t.rail.controls}
			bind:open={
				() => railDisclosures.isOpen('controls'), (next) => railDisclosures.set('controls', next)
			}
		>
			<div class="receipt-controls" data-slot="receipt-controls">
				{#key navigatorRevision}
					<HistoryNavigator
						mode="date"
						date={selectedDate}
						{dateOptions}
						{previousDate}
						{nextDate}
						coverageText={historyCoverageText}
						selectionText={historySelectionText}
						announcement={historyAnnouncement}
						liveAnnouncement={false}
						{locale}
						labels={historyCopy(locale, {
							mode: 'date',
							group: t.history.group,
							picker: {
								group: t.dateSelectLabel,
								start: '',
								end: '',
								clear: '',
								anyStart: '',
								anyEnd: '',
								single: t.datePicker.label,
							},
							previous: t.history.previous,
							next: t.history.next,
						})}
						onDateChange={selectDate}
					/>
				{/key}
			</div>
		</CollapsibleSection>
		{#if tocEntries.length > 0}
			<div class="receipt-rail-toc" data-slot="section-toc">
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
		<ResourceBoundary resource={index} lang={locale}>
			{#if !hasDates}
				<StateNotice
					title={t.emptyIndex}
					presentation="card"
					role="status"
					ariaLive="polite"
					data-slot="receipt-empty-index"
				/>
			{:else if receipt.error}
				<EdgeState
					variant="error-v1"
					lang={locale}
					layout={edgeLayout}
					onRetry={() => receipt.reload()}
				/>
			{:else if !selectedDate || receipt.loading || !receipt.settled || (receipt.data != null && !receiptReady)}
				<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
			{:else if receipt.data == null}
				<StateNotice
					title={t.emptyReceipt}
					presentation="card"
					role="status"
					ariaLive="polite"
					data-slot="receipt-empty"
				/>
			{:else}
				{@const r = receipt.data}
				<ArticleSectionStack data-slot="receipt-sections">
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
								{#if section.id === 'receipt-main'}
									<div class="receipt-main-body">
										<TerminalPanel
											title={t.terminalTitle}
											tag={t.terminalTag}
											status={formatDateKey(r.date, locale)}
											footerItems={[{ label: t.issuedLabel, value: formatDateKey(r.date, locale) }]}
										>
											<div class="receipt-frame" data-slot="receipt-frame">
												{#if dayVerdict}
													<p
														class="receipt-day-verdict"
														data-slot="receipt-day-verdict"
														aria-label={t.dayVerdict.label}
													>
														{dayVerdict}
													</p>
												{/if}
												<div
													class="receipt-layout"
													class:no-worst={!worst.hasWorst}
													data-slot="receipt-layout"
												>
													<SectionHeadline
														kpis={headlineKpis}
														heading={t.receiptSection}
														headingLevel={3}
														{locale}
													/>
													<SectionAffected
														counts={affectedCounts}
														heading={t.countsSection}
														headingLevel={3}
														{locale}
													/>
													{#if worst.hasWorst}
														<SectionWorst
															{worst}
															heading={t.worstSection}
															headingLevel={3}
															{locale}
														/>
													{/if}
												</div>
											</div>
										</TerminalPanel>
										{#if observationText != null}
											{#key observationText}
												<ObservationCopy text={observationText} {locale} />
											{/key}
										{/if}
										<TypedInformationCard kind="caveat" label={t.caveatLabel}>
											<p>{t.caveat}</p>
										</TypedInformationCard>
									</div>
								{:else if section.id === 'receipt-time'}
									<SectionTimeOfDay
										rows={timeOfDay.rows}
										heading={t.timeOfDay.heading}
										subtitle={t.timeOfDay.severeShare}
										caveat={t.timeOfDay.caveat}
										caveatLabel={t.caveatLabel}
										headingLevel={3}
										{locale}
									/>
								{:else if section.id === 'receipt-delivered'}
									<SectionStateCuts
										state={stateCuts}
										heading={t.stateCuts.heading}
										completenessLabel={t.stateCuts.completenessLabel}
										explainer={t.stateCuts.explainer}
										standDown={t.stateCuts.standDown}
										splitLabel={t.stateCuts.splitLabel}
										headingLevel={3}
										{locale}
									/>
								{:else}
									<SectionNotReported
										list={notReported}
										heading={t.notReported.heading}
										caveat={t.notReported.caveat}
										shownOfTotal={t.notReported.shownOfTotal}
										headingLevel={3}
										{locale}
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
	.receipt-controls,
	.receipt-main-body {
		min-width: 0;
	}
	.receipt-controls :global([data-slot='date-range']) {
		width: 100%;
	}
	.receipt-rail-toc {
		margin-top: 0.25rem;
	}
	.receipt-main-body {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.receipt-main-body :global([data-slot='typed-information-card'] p) {
		margin: 0;
	}
	:global(.receipt-detail [data-slot='terminal-chrome']) {
		width: 100%;
		margin-inline: auto;
	}

	.receipt-frame {
		container-type: inline-size;
		container-name: receipt;
	}
	.receipt-day-verdict {
		margin: 0 0 1rem;
		font-family: var(--font-body);
		font-size: var(--text-subheading);
		line-height: 1.45;
		color: var(--foreground);
	}
	.receipt-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas:
			'headline'
			'affected'
			'worst';
		gap: 1rem;
	}
	.receipt-layout :global([data-slot='receipt-headline']) {
		grid-area: headline;
	}
	.receipt-layout :global([data-slot='receipt-affected']) {
		grid-area: affected;
	}
	.receipt-layout :global([data-slot='receipt-worst']) {
		grid-area: worst;
	}

	@container receipt (min-width: 34rem) {
		.receipt-layout {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-areas:
				'headline headline'
				'affected worst';
			align-items: start;
		}
		.receipt-layout.no-worst {
			grid-template-areas:
				'headline headline'
				'affected affected';
		}
	}
</style>

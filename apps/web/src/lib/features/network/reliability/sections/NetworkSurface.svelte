<script lang="ts">
	import { livePresentation } from '#lib/v1/live/livePresentation.ts';
	import { LIVE_FAMILIES } from '#lib/v1/live/store.svelte.ts';
	import { onMount, untrack } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { getLocale, getLocalizeHref, type Locale } from '#lib/i18n/index.ts';
	import {
		absenceSentence,
		absenceShort,
		describeAbsence,
		routeNameFallback,
	} from '#lib/site/absence.ts';
	import { routeFor } from '#lib/nav/index.ts';
	import { desktop } from '@yesid/ui/state';
	import { mapSearchFor } from '#lib/filters/index.ts';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import { formatDateKey } from '#lib/utils/time.ts';
	import {
		fmtCount as sharedFmtCount,
		fmtNumber as sharedFmtNumber,
		fmtDelayMin as sharedFmtDelayMin,
		fmtPct as sharedFmtPct,
	} from '#lib/utils/index.ts';
	import { getV1Context } from '#lib/v1/boot.ts';
	import { createLiveStore } from '#lib/v1/live/store.svelte.ts';
	import { getNetworkTrend } from '#lib/v1/repositories/historic.ts';
	import { getProvenance } from '#lib/v1/repositories/provenance.ts';
	import type { NetworkFile } from '#lib/v1/schemas/network.ts';
	import type { NetworkTrend, TrendPoint } from '#lib/v1/schemas/network_trend.ts';
	import type { Provenance } from '#lib/v1/schemas/provenance.ts';
	import type { OccupancyCode, StatusCode } from '#lib/v1/schemas/types.ts';
	import { createResource, type ResourceSeed } from '#lib/v1/resource.svelte.ts';
	import { shiftLabel, dayTypeLabel } from '#lib/features/reliability/shiftGrains.ts';
	import {
		ArticleControlStack,
		FreshnessStamp,
		ConformanceBadge,
		ResourceBoundary,
		GrainPicker,
		HistoryNavigator,
		type GrainSegment,
	} from '#lib/components/surface/index.ts';
	import {
		SurfaceRail,
		type SurfaceRailContext,
		ArticleHeader,
		DetailFrame,
	} from '@yesid/ui/layout';
	import { historyRangeRequestFromSearchParams } from '#lib/v1/history/rangeResource.svelte.ts';
	import { CollapsibleSection, useSectionJump, TocNav, type TocEntry } from '@yesid/ui/brand';
	import SectionsToggle from '#lib/components/shared/SectionsToggle.svelte';
	import { ArticleKeywords, ArticleSectionStack } from '#lib/components/layout/index.ts';
	import { EdgeState } from '#lib/components/edge/index.ts';
	import { StateNotice } from '@yesid/ui/feedback';
	import { VerdictBanner } from '#lib/components/brand/index.ts';
	import { createReliabilityViewState } from '#lib/reliability/viewState.svelte.ts';
	import type { MetricKey } from '#lib/metrics.ts';
	import { STATUS_LABELS, OCCUPANCY_LABELS } from '#lib/v1/enumLabels.ts';

	import {
		RELIABILITY_GRAINS as NETWORK_GRAINS,
		type ReliabilityGrain as NetworkGrain,
	} from '#lib/reliability/grains.ts';
	import { WINDOWS, bestFitWindow, windowedSeries, type WindowDays } from '../data/trendWindow';
	import { createNetworkHistoryResource } from '../data/networkHistoryResource.svelte';
	import { selectHeadlineKpis } from '../selectors/headlineKpis';
	import { selectStatusMix } from '../selectors/statusMix';
	import { selectOccupancyMix } from '../selectors/occupancyMix';
	import { selectDelayHistogram } from '../selectors/delayHistogram';
	import { selectSilentByRoute } from '../selectors/silentByRoute';
	import { selectTrendChart, selectVehiclesSpark } from '../selectors/trendChart';
	import { selectCancelTrend } from '../selectors/cancelTrend';
	import { selectCompleteness } from '../selectors/completeness';
	import { selectOccupancyTrend } from '../selectors/occupancyTrend';
	import { selectShiftRank } from '../selectors/shiftRank';
	import { networkReliabilityCopy } from '../network-reliability.copy';

	import SectionLiveHeadline from './SectionLiveHeadline.svelte';
	import SectionReporting from './SectionReporting.svelte';
	import SectionStatusMix from './SectionStatusMix.svelte';
	import SectionDelayHistogram from './SectionDelayHistogram.svelte';
	import SectionTrend from './SectionTrend.svelte';
	import SectionCancellations from './SectionCancellations.svelte';
	import SectionCompleteness from './SectionCompleteness.svelte';
	import SectionCrowdingByDay from './SectionCrowdingByDay.svelte';
	import SectionByTimeOfDay from './SectionByTimeOfDay.svelte';
	import SectionWeekday from './SectionWeekday.svelte';

	const localizeHref = getLocalizeHref();

	interface Props {
		networkSeed?: NetworkFile;
		trendSeed?: ResourceSeed<NetworkTrend>;
		provenanceSeed?: ResourceSeed<Provenance>;
	}

	let { networkSeed, trendSeed, provenanceSeed }: Props = $props();

	const locale: Locale = getLocale();
	const t = $derived(networkReliabilityCopy[locale]);

	const initialNetworkSeed = untrack(() => networkSeed);
	const live = createLiveStore(getV1Context().manifest, {
		families: ['network'],
		...(initialNetworkSeed === undefined ? {} : { seed: { network: initialNetworkSeed } }),
	});
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	const trend = createResource(() => getNetworkTrend(), {
		key: () => 'network-trend',
		seed: () => trendSeed,
	});
	const history = createNetworkHistoryResource(
		historyRangeRequestFromSearchParams(new URLSearchParams(page.url.search)),
	);
	onMount(() => () => history.destroy());
	const provenance = createResource(() => getProvenance(), {
		key: () => 'provenance',
		seed: () => provenanceSeed,
	});

	const edgeLayout = $derived(desktop.current ? 'desktop' : 'mobile');
	const noObservationLabel = $derived(absenceShort('no-observations', locale));
	const retainedDataAbsence = $derived(describeAbsence('no-retained-data', locale));

	const fmtMin = (v: number | null): string =>
		sharedFmtDelayMin(v, { suffix: t.units.min, noData: noObservationLabel });
	const fmtCount = (v: number): string => sharedFmtCount(v, { locale, noData: '' });
	const pctOrNull = (v: number | null): string | null => sharedFmtPct(v, { suffix: t.units.pct });
	const minOrNull = (v: number | null): string | null =>
		sharedFmtDelayMin(v, { suffix: t.units.min });
	const fmtCancel = (v: number | null): string | null =>
		sharedFmtPct(v, { rounding: 'fixed1', suffix: t.units.pct });

	const kpis = $derived.by(() =>
		live.network
			? selectHeadlineKpis(live.network, {
					onTime: t.metrics.onTime,
					coverage: t.metrics.coverage,
					delayP50: t.metrics.delayP50,
					delayP90: t.metrics.delayP90,
					vehicles: t.metrics.vehicles,
					notReporting: t.metrics.notReporting,
					pctOrNull,
					minOrNull,
					fmtCount,
				})
			: null,
	);

	const statusSpec = $derived(
		selectStatusMix(
			live.network?.status_dist ?? null,
			(c: StatusCode) => STATUS_LABELS[locale][c],
			{
				title: t.statusBarLabel,
				locale,
				hrefFor: (code: StatusCode) =>
					localizeHref(routeFor({ kind: 'map', search: mapSearchFor({ status: [code] }) }), locale),
			},
		),
	);
	const occupancyMix = $derived(
		selectOccupancyMix(
			live.network?.occupancy_mix ?? null,
			(c: OccupancyCode) => OCCUPANCY_LABELS[locale][c],
			{
				title: t.occupancyBarLabel,
				locale,
				hrefFor: (code: OccupancyCode) =>
					localizeHref(
						routeFor({ kind: 'map', search: mapSearchFor({ occupancy: [code] }) }),
						locale,
					),
			},
		),
	);
	const delayHistogramSpec = $derived(
		selectDelayHistogram(
			live.network?.delay_histogram,
			live.network?.delay_p50_min ?? null,
			live.network?.delay_p90_min ?? null,
			locale,
			{
				title: t.delayHistogram.summary,
				caption: t.delayHistogram.caption,
				unit: t.units.min,
				xLabel: t.delayHistogram.xLabel,
				yLabel: t.delayHistogram.yLabel,
			},
		),
	);
	const silentRows = $derived(
		selectSilentByRoute(live.network?.non_responding_by_route, {
			routeName: (rid) => routeNameFallback(rid, locale),
			rowLabel: t.nonResponding.rowLabel,
			display: (rid, count) => `${fmtCount(count)} ${t.nonResponding.tripsUnit(count)}`,
			href: (rid) => localizeHref(routeFor({ kind: 'line', id: rid }), locale),
			viewDetail: (rid) => t.nonResponding.viewDetail(rid),
		}),
	);

	const grainLabels = $derived({ day: t.grain.day, week: t.grain.week, month: t.grain.month });
	const view = createReliabilityViewState({
		snapshot: () => trend.data,
		retained: {
			resource: () => history,
			copy: () => ({ ...t.history, noData: absenceSentence('no-retained-data', locale) }),
		},
		grains: { keys: NETWORK_GRAINS, labels: () => grainLabels },
		apply: (_current, retained) => retained,
		verdict: { file: (data) => data, headline: (retained) => retained.headline },
		locale: () => locale,
	});
	const explicitHistory = $derived(view.history.active);
	const retainedReady = $derived(view.history.ready);
	const selectedTrend = $derived(view.data);

	const dailyChange = $derived.by(() => {
		const series = selectedTrend?.series ?? [];
		const latest = series.at(-1);
		const prior = series.at(-2);
		if (latest?.otp_pct == null || prior?.otp_pct == null) return null;
		return { points: latest.otp_pct - prior.otp_pct, latest, prior };
	});
	const dailyChangeText = $derived(
		dailyChange == null
			? null
			: t.verdictDelta.chip(
					`${dailyChange.points > 0 ? '+' : ''}${sharedFmtNumber(dailyChange.points, { rounding: 'auto', locale })}`,
					Math.abs(dailyChange.points) === 1,
				),
	);
	const dailyChangeColor = $derived(
		dailyChange == null || dailyChange.points === 0
			? 'var(--muted-foreground)'
			: dailyChange.points > 0
				? 'var(--dataviz-status-on-time)'
				: 'var(--dataviz-status-late)',
	);
	const dailySeries = $derived<readonly TrendPoint[]>(selectedTrend?.series ?? []);
	const weeklySeries = $derived<readonly TrendPoint[]>(selectedTrend?.weekly ?? []);
	const monthlySeries = $derived<readonly TrendPoint[]>(selectedTrend?.monthly ?? []);
	const allSeries = $derived({ daily: dailySeries, weekly: weeklySeries, monthly: monthlySeries });
	const grain = $derived<NetworkGrain>(view.grain);
	const grainKey = $derived(view.grain);
	const historyAnnouncement = $derived(view.announcements.correction);
	const networkVerdict = $derived(view.verdict);
	const isDailyGrain = $derived(grain === 'day');
	const showGrainPicker = $derived(view.segments.filter((segment) => segment.available).length > 1);

	const currentDailySeries = $derived<readonly TrendPoint[]>(trend.data?.series ?? []);
	// This trailing-day chart window is independent of the retained-history selection.
	const bestFit = $derived<WindowDays>(bestFitWindow(currentDailySeries.length));

	let windowKey = $state('7');
	let windowSeeded = $state(false);
	const windowDays = $derived.by<WindowDays>(() => {
		const d = Number(windowKey);
		return (WINDOWS as readonly number[]).includes(d) ? (d as WindowDays) : bestFit;
	});
	const windowSegments = $derived.by<GrainSegment<string>[]>(() => {
		const n = currentDailySeries.length;
		const labels: Record<WindowDays, string> = {
			7: t.window.d7,
			30: t.window.d30,
			90: t.window.d90,
		};
		return WINDOWS.map((d, i) => ({
			key: String(d),
			label: labels[d],
			available: n > 0 && (i === 0 || d <= n),
		}));
	});
	$effect(() => {
		if (explicitHistory) return;
		const n = currentDailySeries.length;
		if (n === 0) return;
		if (!windowSeeded) {
			windowKey = String(bestFit);
			windowSeeded = true;
		} else if (windowDays > n && windowDays !== 7) {
			windowKey = String(bestFit);
		}
	});

	const windowed = $derived<readonly TrendPoint[]>(
		explicitHistory
			? grain === 'week'
				? allSeries.weekly
				: grain === 'month'
					? allSeries.monthly
					: allSeries.daily
			: windowedSeries(grain, allSeries, windowDays),
	);

	let retardKey = $state('p90');
	const delayAvailabilityKnown = $derived(
		explicitHistory &&
			(view.history.state === 'ready' ||
				view.history.state === 'partial' ||
				view.history.state === 'no-data'),
	);
	const p90Available = $derived(
		isDailyGrain && (!delayAvailabilityKnown || windowed.some((point) => point.p90_min != null)),
	);
	const avgAvailable = $derived(
		!delayAvailabilityKnown || windowed.some((point) => point.avg_delay_min != null),
	);
	const showRetardPicker = $derived(!delayAvailabilityKnown || p90Available || avgAvailable);
	const showSecondaryControls = $derived((isDailyGrain && !explicitHistory) || showRetardPicker);
	const hasViewControls = $derived(
		view.history.discovered || showGrainPicker || showSecondaryControls,
	);
	const retardSegments = $derived.by<GrainSegment<string>[]>(() => [
		{ key: 'p90', label: t.trend.retardP90, available: p90Available },
		{ key: 'avg', label: t.trend.retardAvg, available: avgAvailable },
	]);
	const effectiveRetard = $derived<'p90' | 'avg'>(
		retardKey === 'p90' && p90Available ? 'p90' : avgAvailable ? 'avg' : 'p90',
	);
	$effect(() => {
		if (!explicitHistory && !isDailyGrain && retardKey === 'p90') {
			retardKey = 'avg';
			return;
		}
		if (!delayAvailabilityKnown) return;
		if (retardKey === 'p90' && !p90Available && avgAvailable) retardKey = 'avg';
		if (retardKey === 'avg' && !avgAvailable && p90Available) retardKey = 'p90';
	});
	const retardLabel = $derived(
		effectiveRetard === 'avg' ? t.trend.retardAvgLabel : t.trend.retardLabel,
	);

	const trendSpec = $derived(
		selectTrendChart(windowed, effectiveRetard, {
			locale,
			title: t.trend.summary,
			onTimeLabel: t.trend.onTimeLabel,
			retardLabel,
			delayOnlyTitle: t.trend.delayOnlySummary,
			onTimeOnlyTitle: t.trend.onTimeOnlySummary,
			pctUnit: t.units.pct,
			minUnit: t.units.min,
			minimumPoints: explicitHistory ? 1 : 2,
		}),
	);
	const retainedDelayOnly = $derived(
		explicitHistory &&
			!windowed.some((point) => point.otp_pct != null) &&
			windowed.some((point) =>
				effectiveRetard === 'p90' ? point.p90_min != null : point.avg_delay_min != null,
			),
	);
	const trendMetricKey = $derived<MetricKey>(
		retainedDelayOnly ? (effectiveRetard === 'p90' ? 'p50p90' : 'avgDelay') : 'otp',
	);
	const vehiclesSpark = $derived(
		selectVehiclesSpark(windowed, {
			locale,
			title: t.trend.vehiclesSpark,
			label: t.trend.vehiclesSpark,
		}),
	);
	const cancelTrend = $derived(
		selectCancelTrend(windowed, {
			locale,
			title: t.cancel.summary,
			seriesLabel: t.cancel.seriesLabel,
			pctUnit: t.units.pct,
		}),
	);
	const completeness = $derived(selectCompleteness(windowed));
	const completenessDisplay = $derived(fmtCancel(completeness.latest));
	const occupancyDays = $derived(
		selectOccupancyTrend(
			windowed,
			(d) => formatDateKey(d, locale),
			(c: OccupancyCode) => OCCUPANCY_LABELS[locale][c],
			{ locale, titleFor: (dateLabel) => `${t.occupancySection} · ${dateLabel}` },
		),
	);
	const hasOccupancyTrend = $derived(isDailyGrain && occupancyDays.length > 0);

	const pctOrNullSubtitle = (avg: number | null, severe: number | null): string =>
		`${t.shift.avgLabel} ${fmtMin(avg)} · ${t.shift.severeLabel} ${sharedFmtPct(severe, { rounding: 'fixed1', suffix: t.units.pct, noData: noObservationLabel })}`;
	const shiftRows = $derived(
		selectShiftRank(trend.data?.by_shift ?? [], {
			grainLabel: (g) => shiftLabel(g, locale),
			pctOrNull,
			subtitle: pctOrNullSubtitle,
		}),
	);
	const dayTypeRows = $derived(
		selectShiftRank(trend.data?.by_daytype ?? [], {
			grainLabel: (g) => dayTypeLabel(g, locale),
			pctOrNull,
			subtitle: pctOrNullSubtitle,
		}),
	);
	const hasShift = $derived(shiftRows.length > 0);
	const hasDayType = $derived(dayTypeRows.length > 0);

	const regionNav = $derived([
		{ id: 'net-live', label: t.liveRegion },
		{ id: 'net-historic', label: t.historicRegion },
	]);
	const tocEntries: TocEntry[] = $derived(
		regionNav.map((s, i) => ({
			id: s.id,
			title: s.label,
			level: 2,
			badge: { kind: 'number' as const, value: i + 1 },
			children: [],
		})),
	);
	const navigation = useSectionJump(afterNavigate);
	const navigate = (id: string) =>
		navigation.jump(id, { behavior: $prefersReducedMotion ? 'auto' : 'smooth' });
	const railSummary = $derived(grainLabels[grainKey] ?? grainKey);
	const articleMeta = $derived([t.article.sections(tocEntries.length)]);
	const presentation = $derived(
		livePresentation({
			familyStates: live.familyStates,
			families: LIVE_FAMILIES,
			locale,
			page: 'network',
			networkFeedAgeAtPublication: live.network?.feed_freshness_s ?? null,
		}),
	);
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

{#snippet windowControls()}
	{#if isDailyGrain && !explicitHistory}
		<GrainPicker
			segments={windowSegments}
			bind:value={windowKey}
			label={t.window.label}
			class="network-window"
		/>
	{/if}
	{#if showRetardPicker}
		<GrainPicker
			segments={retardSegments}
			bind:value={retardKey}
			label={t.trend.retardToggleLabel}
			class="network-retard-toggle"
		/>
	{/if}
{/snippet}

{#snippet historicBoard()}
	<ArticleSectionStack class="network-history-board" data-slot="network-history-board">
		{#if dailyChange && dailyChangeText}
			<p
				class="network-daily-change"
				data-slot="verdict-delta"
				style={`--delta-tone: ${dailyChangeColor}`}
			>
				<span class="network-daily-change__mark" aria-hidden="true"
					>{dailyChange.points > 0 ? '▲' : dailyChange.points < 0 ? '▼' : '■'}</span
				>
				<span>
					{dailyChangeText} ·
					<time datetime={dailyChange.latest.date}
						>{formatDateKey(dailyChange.latest.date, locale, true)}</time
					>
					{t.verdictDelta.versus}
					<time datetime={dailyChange.prior.date}
						>{formatDateKey(dailyChange.prior.date, locale, true)}</time
					>
				</span>
			</p>
		{/if}
		<div class="network-history-row" data-slot="network-history-trend-row">
			<SectionTrend
				{trendSpec}
				{vehiclesSpark}
				{isDailyGrain}
				metricKey={trendMetricKey}
				copy={t}
				{locale}
			/>
		</div>

		{#if cancelTrend.hasCancel}
			<div class="network-history-row" data-slot="network-history-cancellations-row">
				<SectionCancellations
					vm={cancelTrend}
					latestDisplay={fmtCancel(cancelTrend.latest)}
					copy={t}
					{locale}
				/>
			</div>
		{/if}

		{#if hasOccupancyTrend}
			<div class="network-history-row" data-slot="network-history-crowding-row">
				<SectionCrowdingByDay days={occupancyDays} copy={t} {locale} />
			</div>
		{/if}

		<div class="network-history-companions" data-slot="network-history-companion-row">
			<SectionCompleteness latestDisplay={completenessDisplay} copy={t} {locale} />

			{#if hasShift}
				<SectionByTimeOfDay
					rows={shiftRows}
					dataSlot="network-shift"
					showCaveat={!hasDayType}
					copy={t}
					{locale}
				/>
			{/if}
			{#if hasDayType}
				<SectionWeekday
					rows={dayTypeRows}
					dataSlot={hasShift ? undefined : 'network-shift'}
					showCaveat={true}
					copy={t}
					{locale}
				/>
			{/if}
		</div>
	</ArticleSectionStack>
{/snippet}

{#snippet combinedRail({ closeSheet }: SurfaceRailContext)}
	{#snippet historyControls()}
		<HistoryNavigator {...view.navigator!} announcement={historyAnnouncement} />
	{/snippet}
	{#snippet primaryControls()}
		<GrainPicker
			segments={view.segments}
			value={view.grain}
			onSelect={view.selectGrain}
			label={t.grain.label}
			variant="time-grid"
		/>
	{/snippet}

	{#if hasViewControls}
		<CollapsibleSection independent title={t.viewControlsLabel}>
			<ArticleControlStack
				history={view.history.discovered ? historyControls : undefined}
				primary={showGrainPicker ? primaryControls : undefined}
				secondary={showSecondaryControls ? windowControls : undefined}
			/>
		</CollapsibleSection>
	{/if}

	<div class="rail-toc" data-slot="section-toc">
		<TocNav
			entries={tocEntries}
			{navigation}
			onNavigate={(id) => {
				navigate(id);
				closeSheet();
			}}
			heading={t.rail.toc}
		/>
	</div>
	<ArticleKeywords label={t.article.tagsAria} keywords={t.article.tags} />
{/snippet}

{#snippet railCell()}
	<SurfaceRail
		rail={combinedRail}
		label={t.viewControlsLabel}
		summary={railSummary}
		openAria={t.rail.pillOpen}
		closeAria={t.rail.pillClose}
	/>
{/snippet}

<DetailFrame
	class="network-detail"
	railScroll
	rail={railCell}
	toc={{
		navigation,
		landFragments: true,
		entries: tocEntries,
	}}
>
	{#snippet header()}
		<ArticleHeader
			watermark={t.article.watermark}
			category={t.kicker}
			title={t.heading}
			highlight={t.article.tags[0]}
			backHref={localizeHref('/', locale)}
			backLabel={t.article.back}
			meta={articleMeta}
			titleId="network-title"
		>
			{#snippet controls()}
				<SectionsToggle />
			{/snippet}
			{#snippet actions()}
				<div class="network-feed-health">
					<FreshnessStamp variant="live" presentation={presentation.stamp} {locale} />
					{#if presentation.networkFeedAgeText != null}
						<span
							class="network-feed-age"
							data-slot="feed-age"
							aria-label={`${t.feedAge.a11yPrefix} ${presentation.networkFeedAgeText}`}
						>
							<span class="network-feed-age-label">{t.feedAge.label}</span>
							<span class="network-feed-age-value">{presentation.networkFeedAgeText}</span>
						</span>
					{/if}
					<ConformanceBadge conformance={provenance.data?.conformance} {locale} />
				</div>
			{/snippet}
		</ArticleHeader>
	{/snippet}

	<div class="network-content">
		<section class="network-region" id="net-live" data-toc="net-live" aria-label={t.liveRegion}>
			{#if kpis}
				<ArticleSectionStack class="network-live-content">
					<SectionLiveHeadline
						cards={kpis.headline}
						{locale}
						copy={t}
						terminal={{
							title: t.liveTerminal.title,
							tag: t.liveTerminal.tag,
							footerItems: [
								{
									label: t.liveTerminal.footerLabel,
									value: t.liveTerminal.footerValue,
								},
							],
						}}
					/>
					<SectionReporting cards={kpis.reporting} {silentRows} copy={t} {locale} />
					<SectionStatusMix
						{statusSpec}
						occupancySpec={occupancyMix.spec}
						hasOccupancy={occupancyMix.hasOccupancy}
						copy={t}
						{locale}
					/>
					<SectionDelayHistogram spec={delayHistogramSpec} copy={t} {locale} />
				</ArticleSectionStack>
			{:else if live.error}
				<EdgeState
					variant="error-v1"
					lang={locale}
					layout={edgeLayout}
					onRetry={() => live.refresh()}
				/>
			{:else}
				<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
			{/if}
		</section>

		<section class="network-verdict" aria-label={t.verdictDelta.label}>
			<VerdictBanner result={networkVerdict} />
		</section>

		<section
			class="network-region"
			id="net-historic"
			data-toc="net-historic"
			aria-label={t.historicRegion}
		>
			{#if explicitHistory}
				{#if retainedReady && view.history.value != null}
					<div class="network-history-notes" data-slot="history-scope-notes">
						{#if view.history.state === 'partial'}
							<p data-slot="history-partial">{t.history.partial}</p>
						{/if}
						<p data-slot="history-daily-only">{t.history.dailyOnly}</p>
						{#if hasShift || hasDayType}
							<p data-slot="history-current-only">{t.history.currentOnly}</p>
						{/if}
					</div>
					{@render historicBoard()}
				{:else if view.history.state === 'no-data'}
					<StateNotice
						title={retainedDataAbsence.label}
						body={retainedDataAbsence.why}
						presentation="responsive"
						role="status"
						aria-live="polite"
						data-slot="history-no-data"
					/>
				{:else if view.history.state === 'error'}
					<EdgeState
						variant="error-v1"
						lang={locale}
						layout={edgeLayout}
						onRetry={() => view.history.retry()}
					/>
				{:else}
					<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
				{/if}
			{:else}
				<ResourceBoundary
					resource={trend}
					lang={locale}
					isEmpty={(d) =>
						(d.series?.length ?? 0) === 0 &&
						(d.weekly?.length ?? 0) === 0 &&
						(d.monthly?.length ?? 0) === 0}
				>
					{@render historicBoard()}
				</ResourceBoundary>
			{/if}
		</section>
	</div>
</DetailFrame>

<style>
	:global(.network-detail .network-shift-caveat),
	:global(.network-detail .network-reporting-caveat) {
		margin: 0;
		font-family: var(--font-body);
		font-size: var(--text-reading-caption);
		line-height: 1.6;
		color: var(--muted-foreground);
		max-width: 100%;
	}
	:global([data-slot='detail-shell'].network-detail) {
		--detail-center-max: var(--container-wide);
	}
	.network-feed-health {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1.25rem;
	}

	.network-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	.network-history-notes {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.network-history-notes {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.network-history-notes p {
		margin: 0;
	}

	.network-region {
		display: flex;
		flex-direction: column;
	}
	.network-history-row {
		display: flex;
		width: 100%;
		min-width: 0;
		flex-direction: column;
	}
	.network-history-companions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr));
		align-items: stretch;
		gap: var(--space-card-gap);
		width: 100%;
		min-width: 0;
	}
	.network-verdict {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem 1.25rem;
	}
	.network-daily-change {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--delta-tone, var(--muted-foreground));
	}
	.network-daily-change__mark {
		line-height: 1;
	}
	.network-feed-age {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.network-feed-age-label {
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.network-feed-age-value {
		color: var(--foreground);
	}
</style>

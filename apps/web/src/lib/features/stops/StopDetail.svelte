<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import type { DetailTab } from '$lib/site/detailTabs';
	import { createDetailTabController } from '$lib/site/detailTabController.svelte';
	import { getStop } from '$lib/v1/repositories/static';
	import { getStopReliability } from '$lib/v1/repositories/historic';
	import type { LiveStore, LiveFamily } from '$lib/v1/live/store.svelte';
	import { createLiveResource } from '$lib/v1/live/resource';
	import { getV1Context } from '$lib/v1/boot';
	import { alertsForStop } from '$lib/v1/affectedAlerts';
	import { historyRangeRequestFromSearchParams } from '$lib/v1/history/rangeResource.svelte';
	import type { StopFile, StopReliability, StopDeparture } from '$lib/v1';
	import { createResource, type ResourceSeed } from '$lib/v1/resource.svelte';
	import { delayTone, toneColorVar, TONE_GLYPH, type ChipTone } from '$lib/site/delayPresentation';
	import { ScheduleTable, type ScheduleRow } from '$lib/components/schedule';
	import { STATUS_LABELS } from '$lib/v1/enumLabels';
	import type { StatusCode } from '$lib/v1/schemas';
	import {
		EntityDetail,
		ResourceBoundary,
		FreshnessStamp,
		MapDrilldownLink,
		AffectedAlerts,
	} from '$lib/components/surface';
	import { EdgeState, StateNotice } from '$lib/components/edge';
	import {
		ArticleHeader,
		ArticleSectionStack,
		ControlsRail,
		type ArticleMetaEntry,
	} from '$lib/components/layout';
	import { articleNavigationCopy, CollapsibleSection, type TocEntry } from '$lib/components/shared';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import { Separator } from '@yesid/ui/separator';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import type { IdentitySeed } from '$lib/v1/serverContext';
	import { layout, mapHrefFor } from '$lib/nav';
	import { SectionLabel } from '@yesid/ui/brand';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { Badge } from '@yesid/ui/badge';
	import { formatUtc, formatDateKey } from '$lib/utils/time';
	import { StopReliabilitySurface } from './reliability';
	import {
		createStopHistoryResource,
		type StopHistoryResource,
	} from './reliability/data/stopHistoryResource.svelte';
	import { detailCopy } from './stops.copy';
	import { stopReliabilityCopy } from './reliability/stops-reliability.copy';

	interface StopDetailProps {
		/** The stop id from the route param. */
		id: string;
		/** Server-resolved identity used by the article cover on the first render. */
		seed: IdentitySeed;
		/** Server-loaded static stop; absent only when that read failed. */
		stopSeed?: ResourceSeed<StopFile | null>;
	}

	let { id, seed, stopSeed }: StopDetailProps = $props();

	const locale: Locale = getLocale();
	const t = $derived(detailCopy[locale]);
	const reliabilityT = $derived(stopReliabilityCopy[locale]);
	const articleNav = $derived(articleNavigationCopy[locale]);
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	// Bound compatibility snapshots; the overflow count includes only published samples.
	const SCHEDULE_CAP = 30;

	const tabs = $derived([
		{ key: 'detail', label: t.tabs.detail },
		{ key: 'schedule', label: t.tabs.schedule },
		{ key: 'reliability', label: t.tabs.reliability },
	] as const satisfies readonly { key: DetailTab; label: string }[]);
	const detailTocEntries = $derived<TocEntry[]>([
		{
			id: 'stop-detail-departures',
			title: t.next.heading,
			level: 2,
			badge: { kind: 'number', value: 1 },
			children: [],
		},
		{
			id: 'stop-detail-facts',
			title: t.detailCard.title,
			level: 2,
			badge: { kind: 'number', value: 2 },
			children: [],
		},
	]);
	const scheduleTocEntries = $derived<TocEntry[]>([
		{
			id: 'stop-schedule-service',
			title: t.schedule.heading,
			level: 2,
			badge: { kind: 'number', value: 1 },
			children: [],
		},
	]);
	const articleToc = $derived({
		entries: { detail: detailTocEntries, schedule: scheduleTocEntries },
		heading: articleNav.heading,
		sectionKey: `stop-${id}-toc`,
		counterPrefix: 'SEC',
		openAria: articleNav.openAria,
		closeAria: articleNav.closeAria,
	});

	// One controller owns both directions: external URL changes update the selected tab,
	// while local tab clicks use replaceState and omit the canonical Detail parameter.
	const detailTabController = createDetailTabController(page.url);
	$effect(() => detailTabController.syncFromUrl(page.url));

	const manifest = getV1Context().manifest;
	const { live, resource: departureReport } = createLiveResource(manifest, 'departures');
	const { live: alertLive, resource: alertReport } = createLiveResource(manifest, 'alerts');

	const shortName = manifest.short_name?.trim() || manifest.display_name;
	// Departures for THIS stop from the authoritative per-stop board. null before
	// the first tick (skeleton); [] means this report contains no predictions for the stop.
	const departures = $derived<readonly StopDeparture[] | null>(
		live.departures ? (live.index.byStopId.get(id) ?? []) : null,
	);

	// --- static tier: stop detail (info + schedule) --------------------------
	const stop = createResource((signal) => getStop(id, { signal }), {
		key: () => id,
		seed: () => stopSeed,
	});
	const articleTitle = $derived(
		seed.name.trim() === id && stop.data?.id === id
			? stop.data.name?.trim() || seed.name
			: seed.name,
	);

	// Static code/route associations are optional; direct stop-ID alerts remain usable.
	const stopAlerts = $derived(
		alertsForStop(alertLive.alerts?.alerts, id, stop.data?.code, stop.data?.routes_served),
	);

	// Stops carry no availability flag; a missing reliability report is an empty result.
	const reliability = createResource((signal) => getStopReliability(id, { signal }), {
		key: () => id,
	});
	const articleGeneratedUtc = $derived(
		detailTabController.active === 'reliability'
			? (reliability.data?.generated_utc ?? null)
			: (stop.data?.generated_utc ?? null),
	);
	const articleTags = $derived([`${t.article.stopId} ${id}`, shortName]);
	const articleEdgeLeft = $derived(`${t.kicker} ${id}`);
	const articleEdgeRight = $derived(
		articleGeneratedUtc ? formatUtc(articleGeneratedUtc, locale) : shortName,
	);
	const articleMeta = $derived.by<ArticleMetaEntry[]>(() => {
		const values: ArticleMetaEntry[] = [
			{ label: t.article.stopId, text: id },
			{ label: t.article.provider, text: shortName },
		];
		if (articleGeneratedUtc)
			values.push({
				label: detailTabController.active === 'reliability' ? t.report.historic : t.article.updated,
				text: formatUtc(articleGeneratedUtc, locale),
				datetime: articleGeneratedUtc,
			});
		return values;
	});
	const stopSummaryPeriod = $derived.by(() => {
		const rows = (reliability.data?.periods ?? []).filter((period) => period.grain === 'day');
		return rows.at(-1) ?? null;
	});
	const stopSummaryDaily = $derived.by(() =>
		(reliability.data?.daily ?? [])
			.slice()
			.sort((a, b) => a.date.localeCompare(b.date))
			.at(-1),
	);
	// Both overview metrics use one reported period; only a dated daily row supplies a date.
	const useDailySummary = $derived(
		stopSummaryPeriod?.severe_pct == null && stopSummaryPeriod?.avg_delay_min == null,
	);
	const stopSummarySeverePct = $derived(
		useDailySummary
			? stopSummaryDaily?.observation_count && stopSummaryDaily.severe_count != null
				? (100 * stopSummaryDaily.severe_count) / stopSummaryDaily.observation_count
				: null
			: (stopSummaryPeriod?.severe_pct ?? null),
	);
	const stopSummarySevere = $derived(
		stopSummarySeverePct == null
			? null
			: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(stopSummarySeverePct)}%`,
	);
	const stopSummaryDelayMin = $derived(
		useDailySummary
			? (stopSummaryDaily?.avg_delay_min ?? null)
			: (stopSummaryPeriod?.avg_delay_min ?? null),
	);
	const stopSummaryDelay = $derived(
		stopSummaryDelayMin == null
			? null
			: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(stopSummaryDelayMin)} ${reliabilityT.trend.minUnit}`,
	);
	const hasStopSummary = $derived(stopSummarySevere != null || stopSummaryDelay != null);

	function historyFor(stopId: string): StopHistoryResource {
		return createStopHistoryResource(
			stopId,
			historyRangeRequestFromSearchParams(page.url.searchParams),
		);
	}
	const initialHistoryEntityId = untrack(() => id);
	let historyEntityId = initialHistoryEntityId;
	let stopHistory = $state.raw<StopHistoryResource>(historyFor(initialHistoryEntityId));
	$effect(() => {
		const stopId = id;
		if (stopId === historyEntityId) return;
		const previous = stopHistory;
		historyEntityId = stopId;
		stopHistory = historyFor(stopId);
		previous.destroy();
	});
	onMount(() => () => stopHistory.destroy());
	const stopHistoryRequested = $derived(stopHistory.request.hasFrom || stopHistory.request.hasTo);
	const historyOnlyReliability = $derived.by<StopReliability | null>(() => {
		if (!stopHistoryRequested) return null;
		const generatedUtc =
			stopHistory.index?.generated_utc ??
			reliability.data?.generated_utc ??
			stop.data?.generated_utc;
		return generatedUtc == null ? null : { id, generated_utc: generatedUtc };
	});
	const reliabilityIsEmpty = (value: StopReliability | null): boolean =>
		value == null ||
		((value.periods?.length ?? 0) === 0 &&
			(value.habits?.matrix?.length ?? 0) === 0 &&
			value.occupancy_mix == null &&
			(value.day_of_week?.length ?? 0) === 0 &&
			(value.by_route?.length ?? 0) === 0 &&
			(value.daily?.length ?? 0) === 0);

	// Missing delay remains unclassified and visible under the unfiltered board.
	const DEPARTURE_TONES: readonly ChipTone[] = ['on-time', 'late', 'severe', 'early'];

	// Map a departure tone → the closed StatusCode so the chips + row status read the
	// ONE shared bilingual vocabulary (STATUS_LABELS) — no invented per-surface labels.
	// The tone → glyph/fill mapping (TONE_GLYPH / toneColorVar / delayTone) is the shared
	// delayPresentation kernel, reused verbatim by the ScheduleTable board rows.
	const TONE_STATUS: Record<ChipTone, StatusCode> = {
		early: 'early',
		'on-time': 'on_time',
		late: 'late',
		severe: 'severe',
	};
	const toneLabel = (tone: ChipTone): string => STATUS_LABELS[locale][TONE_STATUS[tone]];

	const statusFilter = new SvelteSet<ChipTone>();
	let routeFilter = $state<string | null>(null);

	// Detail instances survive stop navigation; reset only per-stop board filters.
	$effect(() => {
		void id;
		statusFilter.clear();
		routeFilter = null;
	});

	function toggleStatus(s: ChipTone): void {
		if (statusFilter.has(s)) statusFilter.delete(s);
		else statusFilter.add(s);
	}

	// Distinct routes on the current board (stable, board order), for the chips.
	const departureRoutes = $derived.by<string[]>(() => {
		const seen = new SvelteSet<string>();
		const out: string[] = [];
		for (const d of departures ?? []) {
			if (d.route != null && !seen.has(d.route)) {
				seen.add(d.route);
				out.push(d.route);
			}
		}
		return out;
	});

	// A route that leaves the board (filter narrowed away) is cleared so the view
	// never pins to a route with no departures.
	$effect(() => {
		if (routeFilter != null && !departureRoutes.includes(routeFilter)) routeFilter = null;
	});

	const filteredDepartures = $derived.by<readonly StopDeparture[] | null>(() => {
		if (departures == null) return null;
		return departures.filter((d) => {
			if (statusFilter.size > 0) {
				const tone = delayTone(d.delay_min);
				if (tone === 'none' || !statusFilter.has(tone)) return false;
			}
			if (routeFilter != null && d.route !== routeFilter) return false;
			return true;
		});
	});
</script>

{#snippet liveStatus(source: LiveStore, family: LiveFamily, label: string)}
	<div class="stop-report" data-source={family}>
		<FreshnessStamp
			variant="live"
			generatedUtc={source.generatedUtc}
			ageSeconds={source.ageSeconds}
			isStale={source.isStale}
			degraded={source.familyStates[family].consecutiveFailures > 0}
			{label}
			{locale}
			class="stop-report-stamp"
		/>
		{#if source.familyStates[family].consecutiveFailures > 0 || source.isStale}
			<StateNotice
				title={source.familyStates[family].consecutiveFailures > 0
					? t.report.refreshUnavailable
					: t.report.behind}
				body={t.report.retained}
				tone="warning"
				presentation="silo"
				role="status"
				ariaLive="polite"
				data-testid={`stop-${family}-notice`}
			/>
		{/if}
	</div>
{/snippet}

{#snippet staticStatus()}
	{#if stop.error && stop.data}
		<StateNotice
			title={t.report.staticRefreshUnavailable}
			body={t.report.retainedStatic}
			tone="warning"
			presentation="silo"
			role="status"
			ariaLive="polite"
		/>
	{/if}
{/snippet}

{#snippet historicStatus()}
	{#if reliability.data}
		<div class="stop-report" data-source="historic">
			<FreshnessStamp
				variant="updated"
				generatedUtc={reliability.data.generated_utc}
				label={t.report.historic}
				{locale}
				class="stop-report-stamp"
			/>
			{#if reliability.error}<StateNotice
					title={t.report.historicRefreshUnavailable}
					body={t.report.retainedHistoric}
					tone="warning"
					presentation="silo"
					role="status"
					ariaLive="polite"
				/>{/if}
		</div>
	{/if}
{/snippet}

{#snippet stopInformation()}
	<div class="stop-info">
		<ResourceBoundary resource={stop} lang={locale}>
			{#snippet children(s: StopFile | null)}
				{#if s == null}
					<EdgeState variant="empty" lang={locale} layout={edgeLayout} />
				{:else}
					<div>
						{@render staticStatus()}
						<div class="stop-info-facts">
							<div class="stop-info-metrics">
								<MetricDisplay
									value={`${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`}
									label={t.info.position}
									size="sm"
								/>
								{#if s.code}
									<MetricDisplay value={s.code} label={t.info.code} size="sm" />
								{/if}
								{#if s.wheelchair === true}
									<MetricDisplay value={t.info.wheelchairYes} label={t.info.wheelchair} size="sm" />
								{:else if s.wheelchair === false}
									<MetricDisplay value={t.info.wheelchairNo} label={t.info.wheelchair} size="sm" />
								{:else}
									<MetricDisplay
										value={null}
										absentReason="no-observations"
										{locale}
										label={t.info.wheelchair}
										size="sm"
									/>
								{/if}
							</div>
							{#if (s.routes_served?.length ?? 0) > 0}
								<div class="stop-info-routes">
									<SectionLabel text={t.info.routesServed} variant="metric" />
									<ul class="stop-info-route-chips">
										{#each s.routes_served ?? [] as route (route)}
											<li><Badge variant="tag" size="sm">{route}</Badge></li>
										{/each}
									</ul>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			{/snippet}
		</ResourceBoundary>
		<div class="stop-alert-report" aria-label={t.alerts.heading}>
			{#if alertLive.generatedUtc == null}<SectionLabel
					text={t.report.alerts}
					variant="metric"
				/>{/if}
			<ResourceBoundary resource={alertReport} lang={locale}>
				{#snippet children(_report)}
					{@render liveStatus(alertLive, 'alerts', t.report.alerts)}
					{#if stop.data == null}<StateNotice
							title={t.alertState.limited}
							presentation="silo"
						/>{/if}
					{#if stopAlerts.length === 0}
						<StateNotice
							title={t.alertState.none}
							presentation="silo"
							data-testid="stop-alerts-empty"
						/>
					{:else}
						<AffectedAlerts alerts={stopAlerts} {locale} copy={t.alerts} testId="stop-alerts" />
					{/if}
				{/snippet}
			</ResourceBoundary>
		</div>
	</div>
{/snippet}

{#snippet stopSummaryBanner()}
	<div
		class="stop-reliability-summary"
		data-slot="stop-reliability-summary"
		aria-label={reliabilityT.paneHeading}
	>
		<p class="stop-summary-basis">
			{useDailySummary && stopSummaryDaily?.date
				? t.summary.day(formatDateKey(stopSummaryDaily.date, locale, true))
				: t.summary.reported}
		</p>
		<MetricDisplay
			value={stopSummarySevere}
			absentReason="no-observations"
			{locale}
			label={reliabilityT.metrics.severe}
			size="sm"
		/>
		<MetricDisplay
			value={stopSummaryDelay}
			absentReason="no-observations"
			{locale}
			label={reliabilityT.metrics.avgDelay}
			size="sm"
		/>
		{@render historicStatus()}
	</div>
{/snippet}

<EntityDetail
	{tabs}
	{articleToc}
	bind:active={detailTabController.active}
	paneOwnedRailKeys={['reliability']}
	banner={hasStopSummary ? stopSummaryBanner : undefined}
>
	{#snippet articleHeader()}
		<ArticleHeader
			watermark={t.article.watermark}
			category={t.kicker}
			title={articleTitle}
			tags={articleTags}
			tagsAria={t.article.tagsAria}
			backHref={localizeHref('/stops', locale)}
			backLabel={t.back}
			meta={articleMeta}
			edgeLeft={articleEdgeLeft}
			edgeRight={articleEdgeRight}
			titleId="stop-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
			{#snippet actions()}
				<MapDrilldownLink
					href={mapHrefFor({ stop: id }, locale)}
					label={t.viewOnMap}
					ariaLabel={t.viewStopOnMap(id)}
				/>
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet pane(key)}
		{#if key === 'detail'}
			<ArticleSectionStack>
				{#key id}
					<CollapsibleSection
						title={t.next.heading}
						headerVariant="article-summary"
						index={0}
						anchor="stop-detail-departures"
						sectionKey={`stop-detail-${id}-departures`}
						closeSignal={quietModeStore.closeSignal}
						openSignal={quietModeStore.openSignal}
						bulkCollapsed={quietModeStore.enabled}
					>
						<ResourceBoundary resource={departureReport} lang={locale}>
							{#snippet children(_report)}
								<div class="stop-next">
									{@render liveStatus(live, 'departures', t.report.departures)}
									{#if departures?.length === 0}
										<StateNotice
											title={t.next.none}
											presentation="silo"
											role="status"
											ariaLive="polite"
											data-testid="stop-departures-empty"
										/>
									{:else}
										<ControlsRail label={t.next.controlsLabel}>
											<div
												class="stop-chip-group"
												role="group"
												aria-label={t.next.filter.statusLabel}
											>
												{#each DEPARTURE_TONES as tone (tone)}
													<button
														type="button"
														class="stop-chip"
														class:stop-chip--active={statusFilter.has(tone)}
														aria-pressed={statusFilter.has(tone)}
														onclick={() => toggleStatus(tone)}
													>
														<!-- colour + glyph redundancy: the tone's status fill tints the dot,
										     and the glyph carries the meaning without colour (a11y). -->
														<span
															class="stop-chip-glyph"
															style:color={toneColorVar(tone)}
															aria-hidden="true">{TONE_GLYPH[tone]}</span
														>
														{toneLabel(tone)}
													</button>
												{/each}
											</div>
											{#if departureRoutes.length > 1}
												<div
													class="stop-chip-group"
													role="group"
													aria-label={t.next.filter.routeLabel}
												>
													<button
														type="button"
														class="stop-chip"
														class:stop-chip--active={routeFilter == null}
														aria-pressed={routeFilter == null}
														onclick={() => (routeFilter = null)}
													>
														{t.next.filter.allRoutes}
													</button>
													{#each departureRoutes as route (route)}
														<button
															type="button"
															class="stop-chip"
															class:stop-chip--active={routeFilter === route}
															aria-pressed={routeFilter === route}
															onclick={() => (routeFilter = routeFilter === route ? null : route)}
														>
															{route}
														</button>
													{/each}
												</div>
											{/if}
											<p class="stop-departures-count" aria-live="polite">
												{t.next.filter.showing(
													filteredDepartures?.length ?? 0,
													departures?.length ?? 0,
												)}
											</p>
										</ControlsRail>

										<Separator variant="hazard" hazardSize="sm" />

										{#if (filteredDepartures?.length ?? 0) === 0}
											<StateNotice
												title={t.next.filter.noMatches}
												presentation="silo"
												role="status"
												ariaLive="polite"
												data-testid="departures-filter-empty"
											/>
										{:else}
											<ScheduleTable
												mode="board"
												rows={(filteredDepartures ?? []).map(
													(d): ScheduleRow => ({
														kind: 'board',
														route: d.route,
														eta_utc: d.eta_utc,
														delay_min: d.delay_min,
														trip: d.trip,
													}),
												)}
												{locale}
												labels={t.next.table}
												delayCopy={t.next}
												routeFallback={t.next.route}
											/>
										{/if}
									{/if}
									<p class="stop-report-note">{t.next.scope}</p>
								</div>
							{/snippet}
						</ResourceBoundary>
					</CollapsibleSection>

					<CollapsibleSection
						title={t.detailCard.title}
						subtitle={t.detailCard.summary}
						headerVariant="article-summary"
						index={1}
						anchor="stop-detail-facts"
						sectionKey={`stop-detail-${id}-facts`}
						closeSignal={quietModeStore.closeSignal}
						openSignal={quietModeStore.openSignal}
						bulkCollapsed={quietModeStore.enabled}
					>
						{@render stopInformation()}
					</CollapsibleSection>
				{/key}
			</ArticleSectionStack>
		{:else if key === 'schedule'}
			<ArticleSectionStack data-section-sequence="stop-schedule">
				{#key id}
					<CollapsibleSection
						title={t.schedule.heading}
						headerVariant="article-summary"
						index={0}
						anchor="stop-schedule-service"
						sectionKey={`stop-schedule-${id}-service`}
						closeSignal={quietModeStore.closeSignal}
						openSignal={quietModeStore.openSignal}
						bulkCollapsed={quietModeStore.enabled}
					>
						<ResourceBoundary resource={stop} lang={locale}>
							{#snippet children(s: StopFile | null)}
								<div class="stop-schedule">
									{@render staticStatus()}
									<p class="stop-report-note">{t.schedule.scope}</p>

									{#if (s?.scheduled?.length ?? 0) === 0}
										<StateNotice
											title={t.schedule.none}
											presentation="silo"
											data-testid="stop-schedule-empty"
										/>
									{:else}
										<ScheduleTable
											mode="grid"
											rows={(s?.scheduled ?? []).map(
												(entry): ScheduleRow => ({
													kind: 'grid',
													route: entry.route,
													headsign: entry.headsign,
													times: entry.times ?? [],
												}),
											)}
											{locale}
											labels={t.schedule.table}
											cap={SCHEDULE_CAP}
											moreLabel={t.schedule.moreTimes}
										/>
									{/if}
								</div>
							{/snippet}
						</ResourceBoundary>
					</CollapsibleSection>
				{/key}
			</ArticleSectionStack>
		{:else if key === 'reliability'}
			{#if !hasStopSummary}{@render historicStatus()}{/if}

			{#if reliability.settled && reliability.error == null && reliabilityIsEmpty(reliability.data) && historyOnlyReliability != null && stopHistory.state !== 'current'}
				{#key id}
					<StopReliabilitySurface
						data={historyOnlyReliability}
						{locale}
						history={stopHistory}
						articleSummary={detailTabController.active === 'reliability' && hasStopSummary
							? stopSummaryBanner
							: undefined}
						syncUrl={detailTabController.active === 'reliability'}
					/>
				{/key}
			{:else}
				<ResourceBoundary resource={reliability} lang={locale} isEmpty={reliabilityIsEmpty}>
					{#snippet children(r: StopReliability | null)}
						{#if r != null}
							{#key id}
								<StopReliabilitySurface
									data={r}
									{locale}
									history={stopHistory}
									articleSummary={detailTabController.active === 'reliability' && hasStopSummary
										? stopSummaryBanner
										: undefined}
									syncUrl={detailTabController.active === 'reliability'}
								/>
							{/key}
						{/if}
					{/snippet}
				</ResourceBoundary>
			{/if}
		{/if}
	{/snippet}
</EntityDetail>

<style>
	.stop-report,
	.stop-alert-report {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	:global(.stop-report-stamp) {
		max-width: 100%;
		flex-wrap: wrap;
	}
	:global(.stop-report-stamp > *) {
		white-space: nowrap;
	}
	.stop-summary-basis,
	.stop-reliability-summary > .stop-report {
		flex-basis: 100%;
	}
	.stop-report-note,
	.stop-summary-basis {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
	}

	.stop-reliability-summary {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 1rem 2.5rem;
	}
	.stop-next {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	/* The live-departures ROW LIST styles (.stop-departures / .stop-departure*) now
	   live with <ScheduleTable> (P5.3e board mode); StopDetail keeps only the board
	   CHROME — the filter chips, the count, and the empty state. */
	.stop-chip-glyph {
		margin-inline-end: 0.375rem;
		font-size: var(--text-micro);
		line-height: 1;
	}

	.stop-schedule {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* The Detail facts card is an explicit 2-column grid — stop facts on the left, the
	   live alerts on the right. Reflows to one column on mobile (below). */
	.stop-info > :only-child {
		/* the pair-mate (alerts) rendered nothing — the survivor takes the row */
		grid-column: 1 / -1;
	}
	.stop-info {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1.5rem 2rem;
		align-items: start;
	}
	.stop-info-facts {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}

	/* The reliability tile chrome + the per-tile / per-section reliability layout now
	   live with <StopReliabilitySurface> and its section components (S8A re-seat); the
	   per-route schedule grid (.stop-schedule-route* / .stop-schedule-times*) now lives
	   with <ScheduleTable> (P5.3e grid mode), so StopDetail carries only the schedule
	   pane WRAPPER (.stop-schedule) + the detail-card chrome. */
	.stop-info-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
	}
	.stop-info-routes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-info-route-chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	/* Live-departures filter chips + count (laid out inside the ControlsRail body). */
	.stop-chip-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.stop-chip {
		min-height: var(--size-tap-min);
		appearance: none;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--muted-foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.375rem 0.75rem;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}
	.stop-chip:hover {
		color: var(--foreground);
	}
	/* Active chip is an INTERACTION accent — --primary belongs here, never a data mark. */
	.stop-chip--active {
		color: var(--primary-foreground);
		background-color: var(--primary);
		border-color: var(--primary);
	}
	.stop-chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.stop-departures-count {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	@media (prefers-reduced-motion: reduce) {
		.stop-chip {
			transition: none;
		}
	}

	@media (max-width: 48rem) {
		/* The 2-column facts card collapses to one column on a phone. */
		.stop-info {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>

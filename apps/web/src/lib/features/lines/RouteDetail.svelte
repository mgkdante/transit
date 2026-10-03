<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import type { DetailTab } from '$lib/site/detailTabs';
	import { createDetailTabController } from '$lib/site/detailTabController.svelte';
	import { getLocale, getLocalizeHref, type Locale } from '$lib/i18n';
	import { fmtDelayMin as sharedFmtDelayMin } from '$lib/utils';
	import { mapHrefFor, routeFor } from '$lib/nav';
	import { createLiveStore } from '$lib/v1/live/store.svelte';
	import { deriveRouteStopPredictions } from '$lib/v1/live/routeStopPredictions';
	import { getRoute } from '$lib/v1/repositories/static';
	import { getRouteReliability } from '$lib/v1/repositories/historic';
	import { getProvenance } from '$lib/v1/repositories/provenance';
	import { getV1Context } from '$lib/v1/boot';
	import { alertsForRoute } from '$lib/v1/affectedAlerts';
	import { historyRangeRequestFromSearchParams } from '$lib/v1/history/rangeResource.svelte';
	import type { RouteFile, RouteReliability, Provenance, StopPrediction, Vehicle } from '$lib/v1';
	import { createResource, type ResourceSeed } from '$lib/v1/resource.svelte';
	import type { IdentitySeed } from '$lib/v1/serverContext';
	import { minutesSinceMidnight } from '$lib/utils/time';
	import { sharedClock } from '$lib/stores';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { inferAbsenceReason } from '$lib/site/serviceWindow';
	import { EdgeState, MaybeValue } from '$lib/components/edge';
	import {
		EntityDetail,
		ResourceBoundary,
		MapDrilldownLink,
		FreshnessStamp,
		AffectedAlerts,
	} from '$lib/components/surface';
	import { StatusBadge } from '$lib/components/dataviz';
	import {
		ArticleHeader,
		ArticleSectionStack,
		type ArticleMetaEntry,
	} from '$lib/components/layout';
	import { ScheduleTable, type ScheduleRow } from '$lib/components/schedule';
	import { articleNavigationCopy, CollapsibleSection, type TocEntry } from '$lib/components/shared';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { formatUtc } from '$lib/utils/time';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import { VerdictBanner } from '$lib/components/brand';
	import { selectVerdict } from '$lib/v1/verdict';
	import { selectDayVerdictHeadline } from './reliability/selectors/dayVerdictHeadline';
	import { routeVerdictCopy } from './reliability/routeVerdict.copy';
	import LazyRouteReliabilityPane, {
		type RouteReliabilityClustersModule,
	} from './LazyRouteReliabilityPane.svelte';
	import {
		createLineHistoryResource,
		type LineHistoryResource,
		type LineHistorySeed,
	} from './reliability/data/lineHistoryResource.svelte';
	import { directionHeadsigns } from './directions';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey } from '$lib/metrics';
	import { detailCopy } from './lines.copy';
	import LineDirections from './LineDirections.svelte';
	import { absenceSentence } from '$lib/site/absence';
	import { delayMeasurement } from '$lib/site/delayPresentation';
	import { STATUS_LABELS } from '$lib/v1/enumLabels';
	import { dayTypeLabel, shiftLabel } from '$lib/features/reliability/shiftGrains';

	const localizeHref = getLocalizeHref();

	interface RouteDetailProps {
		id: string;
		seed: IdentitySeed;
		routeSeed?: ResourceSeed<RouteFile | null>;
		reliabilitySeed?: ResourceSeed<RouteReliability | null>;
		lineHistorySeed?: LineHistorySeed;
		initialClusters?: RouteReliabilityClustersModule['default'];
		initialImportFailed?: boolean;
		preparedArticleTime?: { routeId: string; iso: string; locale: Locale; text: string };
	}

	let {
		id,
		seed,
		routeSeed,
		reliabilitySeed,
		lineHistorySeed,
		initialClusters,
		initialImportFailed,
		preparedArticleTime,
	}: RouteDetailProps = $props();

	const locale = getLocale();
	const t = $derived(detailCopy[locale]);

	const tabs = $derived<{ key: DetailTab; label: string }[]>([
		{ key: 'detail', label: t.tabs.detail },
		{ key: 'schedule', label: t.tabs.schedule },
		{ key: 'reliability', label: t.tabs.reliability },
	]);
	const detailTabController = createDetailTabController(page.url);
	$effect(() => detailTabController.syncFromUrl(page.url));

	const route = createResource<RouteFile | null>(() => getRoute(id), {
		key: () => id,
		seed: () => routeSeed,
	});
	const articleTitle = $derived.by(() => {
		const longName = route.data?.id === id ? route.data.long?.trim() : null;
		return seed.name.trim() === id && longName ? `${id} ${longName}` : seed.name;
	});
	const reliability = createResource<RouteReliability | null>(
		() => {
			const routeId = id;
			return getRouteReliability(routeId);
		},
		{ key: () => id, seed: () => reliabilitySeed },
	);

	function historyFor(routeId: string): LineHistoryResource {
		return createLineHistoryResource(
			routeId,
			historyRangeRequestFromSearchParams(page.url.searchParams),
			() => lineHistorySeed,
		);
	}
	const initialHistoryEntityId = untrack(() => id);
	let historyEntityId = initialHistoryEntityId;
	let lineHistory = $state.raw<LineHistoryResource>(historyFor(initialHistoryEntityId));
	$effect(() => {
		const routeId = id;
		if (routeId === historyEntityId) return;
		const previous = lineHistory;
		historyEntityId = routeId;
		lineHistory = historyFor(routeId);
		previous.destroy();
	});
	onMount(() => () => lineHistory.destroy());
	const lineHistoryRequested = $derived(lineHistory.request.hasFrom || lineHistory.request.hasTo);
	const historyOnlyReliability = $derived.by<RouteReliability | null>(() => {
		if (!lineHistoryRequested) return null;
		const generatedUtc = lineHistory.index?.generated_utc ?? route.data?.generated_utc;
		return generatedUtc == null ? null : { id, generated_utc: generatedUtc };
	});

	const relCopy = $derived(routeVerdictCopy[locale]);
	const verdictHeadline = $derived(
		reliability.data ? selectDayVerdictHeadline(reliability.data) : null,
	);
	const routeVerdict = $derived(
		verdictHeadline ? selectVerdict(verdictHeadline, 'day', locale, relCopy.verdict) : null,
	);
	const hasHeaderVerdict = $derived(routeVerdict?.ban != null);
	const headerVerdictCurrentOnly = $derived(
		(lineHistory.request.hasFrom || lineHistory.request.hasTo) && lineHistory.state !== 'current',
	);

	const manifest = getV1Context().manifest;
	const live = createLiveStore(manifest, {
		families: ['vehicles', 'trips', 'alerts', 'network'],
	});
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	const shortName = manifest.short_name?.trim() || manifest.display_name;
	const articleGeneratedUtc = $derived(
		detailTabController.active === 'reliability'
			? (reliability.data?.generated_utc ?? route.data?.generated_utc ?? live.generatedUtc)
			: (live.generatedUtc ?? route.data?.generated_utc ?? reliability.data?.generated_utc ?? null),
	);
	const articleEdgeLeft = $derived(`${t.kicker} ${id}`);
	const articleTimeText = $derived(
		articleGeneratedUtc
			? preparedArticleTime?.routeId === id &&
				preparedArticleTime.iso === articleGeneratedUtc &&
				preparedArticleTime.locale === locale
				? preparedArticleTime.text
				: formatUtc(articleGeneratedUtc, locale)
			: null,
	);
	const articleEdgeRight = $derived(articleTimeText ?? shortName);
	const articleTags = $derived<readonly string[]>(shortName ? [id, shortName] : [id]);
	const articleMeta = $derived.by((): readonly ArticleMetaEntry[] => {
		const entries: ArticleMetaEntry[] = [];
		if (shortName) entries.push({ label: t.article.provider, text: shortName });
		if (articleGeneratedUtc && articleTimeText !== null) {
			entries.push({
				label: t.article.generated,
				text: articleTimeText,
				datetime: articleGeneratedUtc,
			});
		}
		return entries;
	});

	const predictions = $derived<ReadonlyMap<string, StopPrediction>>(
		deriveRouteStopPredictions(id, live.index),
	);

	const routeAlerts = $derived(alertsForRoute(live.alerts?.alerts, id));

	const provenance = createResource<Provenance>(() => getProvenance());

	const routeNonResponding = $derived(
		(live.network?.non_responding_by_route ?? []).some((r) => r.route_id === id),
	);

	const dirHeadsigns = $derived(directionHeadsigns(route.data?.directions));

	const absenceReason = $derived(
		inferAbsenceReason({
			routeType: route.data?.type ?? null,
			gaps: provenance.data?.gaps ?? null,
			firstDeparture: route.data?.first_departure ?? null,
			lastDeparture: route.data?.last_departure ?? null,
			nowMinutes: minutesSinceMidnight(new Date(sharedClock.serverNow)),
			nonResponding: routeNonResponding,
		}),
	);

	const roster = $derived.by<Vehicle[]>(() => {
		const ids = live.index.vehiclesByRoute.get(id);
		if (!ids) return [];
		const out: Vehicle[] = [];
		for (const vid of ids) {
			const v = live.index.byVehicleId.get(vid);
			if (v) out.push(v);
		}
		return out.sort((a, b) => delaySortKey(b.delay_min) - delaySortKey(a.delay_min));
	});

	function delaySortKey(delay: number | null | undefined): number {
		return delay == null ? Number.NEGATIVE_INFINITY : delay;
	}

	const hasListColumn = $derived(roster.length > 0 || routeAlerts.length > 0);
	const articleNav = $derived(articleNavigationCopy[locale]);
	const detailTocEntries = $derived.by<TocEntry[]>(() => {
		if (route.data == null) return [];
		const entries: TocEntry[] = [
			{
				id: 'line-detail-profile',
				title: t.profile.title,
				level: 2,
				badge: { kind: 'number', value: 1 },
				children: [],
			},
			{
				id: 'line-detail-directions',
				title: t.directions,
				level: 2,
				badge: { kind: 'number', value: 2 },
				children: [],
			},
		];
		if (hasListColumn) {
			entries.push({
				id: 'line-detail-live',
				title: t.liveService.title,
				level: 2,
				badge: { kind: 'number', value: 3 },
				children: [],
			});
		}
		return entries;
	});
	const scheduleTocEntries = $derived.by<TocEntry[]>(() =>
		route.data == null
			? []
			: [
					{
						id: 'line-schedule-span',
						title: t.serviceSpan,
						level: 2,
						badge: { kind: 'number', value: 1 },
						children: [],
					},
					{
						id: 'line-schedule-periods',
						title: t.servicePeriods,
						level: 2,
						badge: { kind: 'number', value: 2 },
						children: [],
					},
				],
	);
	const articleToc = $derived({
		entries: { detail: detailTocEntries, schedule: scheduleTocEntries },
		heading: articleNav.heading,
		sectionKey: `line-${id}-toc`,
		counterPrefix: 'SEC',
		openAria: articleNav.openAria,
		closeAria: articleNav.closeAria,
	});

	const showAbsenceNote = $derived(live.generatedUtc != null && roster.length === 0);

	const tripHref = (tripId: string): string =>
		localizeHref(routeFor({ kind: 'trip', id: tripId }), locale);

	const fmtMin = (v: number | null | undefined): string | null =>
		sharedFmtDelayMin(v, { rounding: 'fixed1' });
</script>

{#snippet scheduleInfo(key: MetricKey, name: string)}
	<MetricInfo class="route-metric-info" metricKey={key} {locale} {name} side="bottom" />
{/snippet}

{#snippet routeBanner()}
	<div class="route-verdict-banner">
		{#if routeVerdict}
			<VerdictBanner result={routeVerdict} />
		{/if}
		{#if headerVerdictCurrentOnly}
			<p class="route-verdict-scope" data-slot="header-verdict-current-only">
				{relCopy.history.headerCurrentOnly}
			</p>
		{/if}
	</div>
{/snippet}

<EntityDetail
	{tabs}
	{articleToc}
	bind:active={detailTabController.active}
	paneOwnedRailKeys={['reliability']}
	banner={hasHeaderVerdict ? routeBanner : undefined}
>
	{#snippet articleHeader()}
		<ArticleHeader
			watermark={t.article.watermark}
			category={t.kicker}
			title={articleTitle}
			tags={articleTags}
			tagsAria={t.article.tagsAria}
			backHref={localizeHref('/lines', locale)}
			backLabel={t.article.back}
			meta={articleMeta}
			edgeLeft={articleEdgeLeft}
			edgeRight={articleEdgeRight}
			titleId="line-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
			{#snippet actions()}
				<MapDrilldownLink
					href={localizeHref(mapHrefFor({ route: id }, locale), locale)}
					label={t.viewOnMap}
					ariaLabel={t.viewRouteOnMap(id)}
				/>
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet pane(key)}
		{#if key === 'detail'}
			<ResourceBoundary resource={route} lang={locale}>
				{#snippet children(file)}
					<ArticleSectionStack>
						{#key id}
							<CollapsibleSection
								title={t.profile.title}
								subtitle={t.profile.summary}
								headerVariant="article-summary"
								index={0}
								anchor="line-detail-profile"
								sectionKey={`line-detail-${id}-profile`}
								closeSignal={quietModeStore.closeSignal}
								openSignal={quietModeStore.openSignal}
								bulkCollapsed={quietModeStore.enabled}
							>
								<div class="route-profile-grid">
									<MetricDisplay
										value={String(file.directions?.length ?? 0)}
										label={t.profile.directions}
										size="sm"
									/>
									<MetricDisplay
										value={String(
											(file.directions ?? []).reduce(
												(total, direction) => total + (direction.stops?.length ?? 0),
												0,
											),
										)}
										label={t.profile.stops}
										size="sm"
									/>
									<MetricDisplay
										value={file.first_departure ?? null}
										absentReason="no-observations"
										{locale}
										label={t.firstDeparture}
										size="sm"
									/>
									<MetricDisplay
										value={file.last_departure ?? null}
										absentReason="no-observations"
										{locale}
										label={t.lastDeparture}
										size="sm"
									/>
								</div>
							</CollapsibleSection>

							<CollapsibleSection
								title={t.directions}
								headerVariant="article-summary"
								index={1}
								anchor="line-detail-directions"
								sectionKey={`line-detail-${id}-directions`}
								closeSignal={quietModeStore.closeSignal}
								openSignal={quietModeStore.openSignal}
								bulkCollapsed={quietModeStore.enabled}
							>
								<div class="route-section">
									{#if live.generatedUtc != null || live.ageSeconds != null}
										<div class="route-section-head route-section-head--meta">
											<FreshnessStamp
												variant="live"
												generatedUtc={live.generatedUtc}
												ageSeconds={live.ageSeconds}
												isStale={live.isStale}
												{locale}
											/>
										</div>
									{/if}
									{#if showAbsenceNote}
										<EdgeState
											variant="empty"
											lang={locale}
											layout="mobile"
											emptyReason={absenceReason}
											class="route-absence-note"
										/>
									{/if}
									<LineDirections directions={file.directions} {predictions} {locale} copy={t} />
								</div>
							</CollapsibleSection>

							{#if hasListColumn}
								<CollapsibleSection
									title={t.liveService.title}
									subtitle={t.liveService.summary}
									headerVariant="article-summary"
									index={2}
									anchor="line-detail-live"
									sectionKey={`line-detail-${id}-live`}
									closeSignal={quietModeStore.closeSignal}
									openSignal={quietModeStore.openSignal}
									bulkCollapsed={quietModeStore.enabled}
								>
									<div class="route-aside">
										<AffectedAlerts
											alerts={routeAlerts}
											{locale}
											copy={t.alerts}
											testId="route-alerts"
										/>

										{#if roster.length > 0}
											<div class="route-roster" data-testid="route-roster">
												<div class="route-section-head">
													<SectionHeading level={2} overline={t.roster.heading} />
													<span class="route-roster-count">{t.roster.count(roster.length)}</span>
												</div>
												<ul class="route-roster-list" aria-label={t.roster.listLabel}>
													{#each roster as bus (bus.id)}
														{@const unknownStatusAndDelay =
															bus.status === 'unknown' && bus.delay_min == null}
														<li class="route-roster-item">
															{#snippet rosterRow()}
																<div class="route-roster-reading">
																	<strong>{t.roster.busLabel(bus.id)}</strong>
																	<StatusBadge
																		status={bus.status}
																		label={STATUS_LABELS[locale][bus.status]}
																		mode={unknownStatusAndDelay ? 'dot' : 'legend'}
																		aria-hidden={unknownStatusAndDelay || undefined}
																		size="sm"
																	/>
																	<span class="route-roster-delay"
																		><MaybeValue
																			value={delayMeasurement(bus.delay_min)}
																			reason="not-reported"
																			variant="row"
																			{locale}
																		/></span
																	>
																	{#if bus.next_stop != null}<span class="route-roster-next"
																			>{t.roster.nextStop(bus.next_stop)}</span
																		>{/if}
																</div>
															{/snippet}
															{#if bus.trip}
																<a
																	class="route-roster-link"
																	href={tripHref(bus.trip)}
																	aria-label={`${t.roster.viewTrip(bus.id)}, ${unknownStatusAndDelay ? '' : `${STATUS_LABELS[locale][bus.status]}, `}${locale === 'fr' ? 'Retard' : 'Delay'}: ${delayMeasurement(bus.delay_min) ?? absenceSentence('not-reported', locale)}`}
																>
																	{@render rosterRow()}
																	<ChevronRightIcon
																		size={14}
																		strokeWidth={2.4}
																		aria-hidden="true"
																	/>
																</a>
															{:else}
																<div class="route-roster-link route-roster-link--static">
																	{@render rosterRow()}
																</div>
															{/if}
															<a
																class="route-roster-map"
																href={localizeHref(mapHrefFor({ vehicle: bus.id }, locale), locale)}
																aria-label={t.roster.viewBusOnMap(bus.id)}
															>
																<MapPinIcon size={13} strokeWidth={2.4} aria-hidden="true" />
																<span>{t.roster.mapAction}</span>
															</a>
														</li>
													{/each}
												</ul>
											</div>
										{/if}
									</div>
								</CollapsibleSection>
							{/if}
						{/key}
					</ArticleSectionStack>
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'schedule'}
			<ResourceBoundary resource={route} lang={locale}>
				{#snippet children(file)}
					<div class="route-schedule-cq">
						<ArticleSectionStack data-section-sequence="line-schedule">
							<CollapsibleSection
								title={t.serviceSpan}
								headerVariant="article-summary"
								index={0}
								anchor="line-schedule-span"
								sectionKey={`line-schedule-${id}-span`}
								closeSignal={quietModeStore.closeSignal}
								openSignal={quietModeStore.openSignal}
								bulkCollapsed={quietModeStore.enabled}
							>
								<p class="route-schedule-intro" data-slot="schedule-intro">{t.scheduleIntro}</p>
								<div class="route-schedule-span">
									<div class="route-departures">
										<div class="route-metric-cell">
											<MetricDisplay
												value={file.first_departure ?? null}
												absentReason="not-in-schedule"
												{locale}
												label={t.firstDeparture}
												size="sm"
											/>
											{@render scheduleInfo('serviceSpan', t.firstDeparture)}
										</div>
										<div class="route-metric-cell">
											<MetricDisplay
												value={file.last_departure ?? null}
												absentReason="not-in-schedule"
												{locale}
												label={t.lastDeparture}
												size="sm"
											/>
											{@render scheduleInfo('serviceSpan', t.lastDeparture)}
										</div>
									</div>
								</div>
							</CollapsibleSection>
							<CollapsibleSection
								title={t.servicePeriods}
								headerVariant="article-summary"
								index={1}
								anchor="line-schedule-periods"
								sectionKey={`line-schedule-${id}-periods`}
								closeSignal={quietModeStore.closeSignal}
								openSignal={quietModeStore.openSignal}
								bulkCollapsed={quietModeStore.enabled}
							>
								{#snippet headerActions()}
									{@render scheduleInfo('headway', t.servicePeriods)}
								{/snippet}
								<div class="route-schedule-periods">
									{#if (file.service_periods ?? []).length > 0}
										<ScheduleTable
											mode="service"
											rows={(file.service_periods ?? []).map(
												(period): ScheduleRow => ({
													kind: 'service',
													period: dayTypeLabel(shiftLabel(period.shift, locale), locale),
													window: period.window,
													headway: fmtMin(period.headway_min),
												}),
											)}
											{locale}
											labels={t.scheduleTable}
										/>
									{:else}
										<EdgeState variant="empty" lang={locale} />
									{/if}
								</div>
							</CollapsibleSection>
						</ArticleSectionStack>
					</div>
				{/snippet}
			</ResourceBoundary>
		{:else}
			<LazyRouteReliabilityPane
				entityId={id}
				resource={reliability}
				{initialClusters}
				{initialImportFailed}
				{locale}
				directionHeadsigns={dirHeadsigns}
				history={lineHistory}
				{historyOnlyReliability}
				articleSummary={detailTabController.active === 'reliability' && hasHeaderVerdict
					? routeBanner
					: undefined}
			/>
		{/if}
	{/snippet}
</EntityDetail>

<style>
	.route-verdict-banner {
		display: grid;
		gap: 0.5rem;
	}
	.route-verdict-scope {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.route-section {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.route-profile-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: 1rem;
	}
	.route-aside {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.route-section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.route-section-head--meta {
		justify-content: flex-end;
	}
	.route-roster {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.route-roster-count {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.route-roster-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.route-roster-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.route-roster-reading {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.route-roster-delay,
	.route-roster-next {
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-small);
	}
	.route-roster-next {
		flex-basis: 100%;
	}
	.route-roster-link {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		margin-inline: -0.5rem;
		border-radius: var(--radius-sm);
		color: var(--foreground);
		text-decoration: none;
		transition: background-color var(--duration-fast) var(--ease-out);
	}
	.route-roster-link--static {
		cursor: default;
	}
	.route-roster-link :global(svg) {
		flex: none;
		opacity: 0.45;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	a.route-roster-link:hover {
		background: color-mix(in srgb, var(--primary) 7%, transparent);
	}
	a.route-roster-link:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	.route-roster-map {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		border-radius: var(--radius-pill);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
		text-decoration: none;
		border: 1px solid var(--border);
		transition:
			color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out);
	}
	.route-roster-map:hover {
		color: var(--primary);
		border-color: color-mix(in srgb, var(--primary) 40%, var(--border));
	}
	.route-departures {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
	}
	.route-metric-cell {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.375rem;
	}
	.route-schedule-cq {
		display: flex;
		flex-direction: column;
	}
	.route-schedule-intro {
		margin: 0 0 var(--space-card-gap);
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--foreground);
	}
	.route-schedule-span {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.route-schedule-periods {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	@media (prefers-reduced-motion: reduce) {
		.route-roster-link,
		.route-roster-link :global(svg),
		.route-roster-map {
			transition: none;
		}
		a.route-roster-link:hover :global(svg) {
			transform: none;
		}
	}
</style>

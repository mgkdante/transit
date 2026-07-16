<!--
  RouteDetail — the per-line detail screen (slice-9.3).

  Composes the surface spine: an ArticleHeader cover over an EntityDetail tabbed
  scaffold (Détail / Horaire / Fiabilité). The server identity seed owns the
  first-render title; each pane keeps its established ResourceBoundary so
  skeleton / error / empty render per-pane without bespoke plumbing:

    - detail + schedule  → static getRoute(id)            (RouteFile | null)
    - reliability        → historic getRouteReliability(id) (RouteReliability | null)

  A null load (HTTP 404) is the empty signal, not an error — ResourceBoundary
  routes it to the empty edge state. The article focus controls subscribe only
  the article disclosure sequence consistently across Detail, Schedule, and
  Reliability. Locale via getLocale(); non-intrinsic copy is co-located. Tokens,
  no hex; --primary stays interactive-only.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import type { DetailTab } from '$lib/site/detailTabs';
	import { createDetailTabController } from '$lib/site/detailTabController.svelte';
	import { getLocale, localizeHref } from '$lib/i18n';
	import { fmtDelayMin as sharedFmtDelayMin } from '$lib/utils';
	import { mapHrefFor, routeFor } from '$lib/nav';
	import {
		createLiveStore,
		deriveRouteStopPredictions,
		getRoute,
		getRouteReliability,
		getProvenance,
		getV1Context,
		alertsForRoute,
		historyRangeRequestFromSearchParams,
	} from '$lib/v1';
	import type { RouteFile, RouteReliability, Provenance, StopPrediction, Vehicle } from '$lib/v1';
	import { createResource, type ResourceSeed } from '$lib/v1/resource.svelte';
	import type { IdentitySeed } from '$lib/v1/serverContext';
	import { minutesSinceMidnight } from '$lib/utils/time';
	import { sharedClock } from '$lib/stores';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { inferAbsenceReason } from '$lib/site/serviceWindow';
	import { EdgeState } from '$lib/components/edge';
	import {
		EntityDetail,
		ResourceBoundary,
		MapDrilldownLink,
		FreshnessStamp,
		AffectedAlerts,
	} from '$lib/components/surface';
	import { RankedRow } from '$lib/components/dataviz';
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
	import { toReliabilityClusters } from './reliability/clusters';
	import { reliabilityCopy } from './reliability/reliability.copy';
	import RouteReliabilityClusters from './reliability/RouteReliabilityClusters.svelte';
	import {
		createLineHistoryResource,
		type LineHistoryResource,
	} from './reliability/data/lineHistoryResource.svelte';
	import { directionHeadsigns } from './directions';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { detailCopy } from './lines.copy';
	import LineDirections from './LineDirections.svelte';
	import { delayColorVar, delaySeverity, delayLabel } from '$lib/site/delayPresentation';
	import { DELAY_POS_DOMAIN } from '$lib/features/reliability/shiftGrains';

	interface RouteDetailProps {
		/** The route id this surface details. */
		id: string;
		/** Server-resolved identity used by the article cover on the first render. */
		seed: IdentitySeed;
		/** Server-loaded static route; absent only when that read failed. */
		routeSeed?: ResourceSeed<RouteFile | null>;
	}

	let { id, seed, routeSeed }: RouteDetailProps = $props();

	const locale = getLocale();
	const t = $derived(detailCopy[locale]);

	// The in-app metric-explainer (i) affordance, same wiring as the reliability
	// clusters: a one-line tip + a localized deep link to /metrics#<anchor>.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	const tabs = $derived<{ key: DetailTab; label: string }[]>([
		{ key: 'detail', label: t.tabs.detail },
		{ key: 'schedule', label: t.tabs.schedule },
		{ key: 'reliability', label: t.tabs.reliability },
	]);
	// One controller owns both directions: external URL changes update the selected tab,
	// while local tab clicks use replaceState and omit the canonical Detail parameter.
	const detailTabController = createDetailTabController(page.url);
	$effect(() => detailTabController.syncFromUrl(page.url));

	// detail + schedule share the static route file (reactive to `id`).
	const route = createResource<RouteFile | null>(() => getRoute(id), {
		key: () => id,
		seed: () => routeSeed,
	});
	const articleTitle = $derived.by(() => {
		const longName = route.data?.id === id ? route.data.long?.trim() : null;
		return seed.name.trim() === id && longName ? `${id} ${longName}` : seed.name;
	});
	// reliability is the historic per-route archive (reactive to `id`). The route PAGE
	// always probes route_reliability/{id}.json and TRUSTS the file as the source of
	// truth — it does NOT gate on the routes-index `reliability` flag. That flag is a
	// daily-changing truth (which routes have accrued history) baked into the long-cached
	// STATIC index, so it lags: a route that just entered the spine, or a stale
	// pre-deploy / edge-cached index, can read `false` while the file EXISTS — and a
	// stale `false` must NEVER hide a published reliability surface (the bug this fixes).
	// One probe per route page is cheap (a route a rider opened, usually a bus WITH
	// history); a route with genuinely no file fail-softs to null → the surface shows its
	// honest empty. (The LIST loader keeps the flag-skip — there it avoids N guaranteed
	// 404s across every row; here it is a single request.)
	const reliability = createResource<RouteReliability | null>(
		() => {
			// Capture `id` SYNCHRONOUSLY: createResource tracks the fetcher's reactive reads
			// only during its synchronous portion (Svelte 5 stops $effect dependency tracking
			// at the first await/microtask). Reading `id` after an await would drop it as a
			// dependency, so client nav /lines/A → /lines/B would keep showing A's reliability
			// under B's header. Mirrors MapHero's capture-key-first convention.
			const routeId = id;
			return getRouteReliability(routeId);
		},
		{ key: () => id },
	);

	function historyFor(routeId: string): LineHistoryResource {
		return createLineHistoryResource(
			routeId,
			historyRangeRequestFromSearchParams(page.url.searchParams),
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

	// ALWAYS-VISIBLE VERDICT BAND (§C5.4): the §0 verdict, hoisted ABOVE the tabs so the
	// payoff is never buried behind the Detail tab. Reuses the SHARED VerdictBanner +
	// selectVerdict off the SAME §0 headline (the default 'day' grain of the reliability
	// archive), so the band and the §0 verdict inside the Reliability tab always agree.
	// The band renders ONLY once the historic archive has loaded (a null → no band, never
	// a fabricated verdict); the Wilson hedge + natural frequency ride the archive's own
	// observation_count / on_time (never fabricated).
	const relCopy = $derived(reliabilityCopy[locale]);
	const verdictHeadline = $derived(
		reliability.data
			? toReliabilityClusters(reliability.data, { grain: 'day' }).punctuality.headline
			: null,
	);
	const routeVerdict = $derived(
		verdictHeadline ? selectVerdict(verdictHeadline, 'day', locale, relCopy.verdict) : null,
	);
	const hasHeaderVerdict = $derived(routeVerdict?.ban != null);
	const headerVerdictCurrentOnly = $derived(
		(lineHistory.request.hasFrom || lineHistory.request.hasTo) && lineHistory.state !== 'current',
	);

	// Live tier: one store for this surface (the v1 context is booted before
	// mount in the root layout). It polls vehicles/trips on the live ttl; the
	// Detail tab reads its index to derive per-stop predictions (client-side,
	// fail-soft: the static directions/stops render regardless). start()/stop()
	// are browser-only and idempotent.
	const manifest = getV1Context().manifest;
	const live = createLiveStore(manifest, {
		families: ['vehicles', 'trips', 'alerts', 'network'],
	});
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// Article-cover metadata uses only values published by the manifest or a loaded
	// data tier. Missing values stand down instead of becoming decorative filler.
	const shortName = manifest.short_name?.trim() || manifest.display_name;
	const articleGeneratedUtc = $derived(
		live.generatedUtc ?? route.data?.generated_utc ?? reliability.data?.generated_utc ?? null,
	);
	const articleEdgeLeft = $derived(`${t.kicker} ${id}`);
	const articleEdgeRight = $derived(
		articleGeneratedUtc ? formatUtc(articleGeneratedUtc, locale) : shortName,
	);
	const articleTags = $derived<readonly string[]>(shortName ? [id, shortName] : [id]);
	const articleMeta = $derived.by((): readonly ArticleMetaEntry[] => {
		const entries: ArticleMetaEntry[] = [];
		if (shortName) entries.push({ label: t.article.provider, text: shortName });
		if (articleGeneratedUtc) {
			entries.push({
				label: t.article.generated,
				text: formatUtc(articleGeneratedUtc, locale),
				datetime: articleGeneratedUtc,
			});
		}
		return entries;
	});

	// Per-stop SOONEST predicted arrival on this route, derived from the live
	// trips of every bus currently on the route (NO per-stop fetch, a route has
	// 30+ stops). A stop with no live bus predicting it has NO entry → the row
	// shows an honest "no live bus", never a fabricated time.
	const predictions = $derived<ReadonlyMap<string, StopPrediction>>(
		deriveRouteStopPredictions(id, live.index),
	);

	// Service alerts affecting THIS route: live alerts whose routes[] lists this
	// route id. Reuses the live store's already-loaded alerts — no second fetch.
	// Empty -> the AffectedAlerts section stands down. Honest: never fabricated.
	const routeAlerts = $derived(alertsForRoute(live.alerts?.alerts, id));

	// HONEST ABSENCE — provenance carries the declared data gaps (e.g.
	// ["metro_realtime"]); we infer the SPECIFIC reason this route has no live bus
	// from {route_type, gaps, service-window, non-responding} rather than standing
	// silently down. One-shot fetch (gaps change rarely); fail-soft (null gaps).
	const provenance = createResource<Provenance>(() => getProvenance());

	// Is THIS route reported scheduled-but-silent by the live network? The
	// per-route silent-trip tally lists routes with scheduled trips but no live
	// vehicle; a hit means "within the window yet nothing is reporting".
	const routeNonResponding = $derived(
		(live.network?.non_responding_by_route ?? []).some((r) => r.route_id === id),
	);

	// The inferred reason the live roster is empty, recomputed each shared tick (so
	// a closed/overnight verdict re-evaluates as the clock crosses first/last). Only
	// consulted when there is genuinely no live bus on the route; honest by
	// construction (metro needs route_type 1 + the gap; closed needs a real window;
	// dir → real headsign (the bus's destination sign), so the reliability section labels
	// directions the way a rider reads them, not "direction 0/1". Empty until the route file
	// settles; the consumers fall back to a neutral "Direction N" per missing dir.
	const dirHeadsigns = $derived(directionHeadsigns(route.data?.directions));

	// silent needs the non-responding signal; else null → plain no-data).
	const absenceReason = $derived(
		inferAbsenceReason({
			routeType: route.data?.type ?? null,
			gaps: provenance.data?.gaps ?? null,
			firstDeparture: route.data?.first_departure ?? null,
			lastDeparture: route.data?.last_departure ?? null,
			// serverNow: the closed/overnight verdict must use the true (server-
			// anchored) wall clock, not a skewed client clock (same skew class).
			nowMinutes: minutesSinceMidnight(new Date(sharedClock.serverNow)),
			nonResponding: routeNonResponding,
		}),
	);

	// CURRENT-BUSES ROSTER: the live vehicles running THIS route right now, read
	// from the SAME live index (vehiclesByRoute → byVehicleId) the predictions use
	// — NO second poll. Sorted MOST-LATE first (the honest "worst"); an early or
	// on-time bus reads calm, and a vehicle with no delay value sorts last (never a
	// fabricated 0). The whole section stands down when no live vehicle is on this
	// route (metro, or a feed gap) — never an empty roster.
	const roster = $derived.by<Vehicle[]>(() => {
		const ids = live.index.vehiclesByRoute.get(id);
		if (!ids) return [];
		const out: Vehicle[] = [];
		for (const vid of ids) {
			const v = live.index.byVehicleId.get(vid);
			if (v) out.push(v);
		}
		// Most-late first; a null delay sinks to the bottom (NEGATIVE_INFINITY-keyed).
		return out.sort((a, b) => delaySortKey(b.delay_min) - delaySortKey(a.delay_min));
	});

	// Sort key: a known delay sorts by SIGNED lateness (most late = worst, first;
	// early buses trail on-time ones); an absent delay sorts last (no fabricated 0
	// jumping it ahead of a real reading). Agrees with the colour channel on
	// "worst = most late".
	function delaySortKey(delay: number | null | undefined): number {
		return delay == null ? Number.NEGATIVE_INFINITY : delay;
	}

	// The live-service article section renders only when it has content (a live bus
	// on the route or an active alert), so the disclosure sequence never contains an
	// empty card.
	const hasListColumn = $derived(roster.length > 0 || routeAlerts.length > 0);
	const articleNav = $derived(articleNavigationCopy[locale]);
	const detailTocEntries = $derived.by<TocEntry[]>(() => {
		if (route.data == null) return [];
		const entries: TocEntry[] = [];
		if (hasListColumn) {
			entries.push({
				id: 'line-detail-live',
				title: t.liveService.title,
				level: 2,
				badge: { kind: 'number', value: 1 },
				children: [],
			});
		}
		const offset = entries.length;
		entries.push(
			{
				id: 'line-detail-profile',
				title: t.profile.title,
				level: 2,
				badge: { kind: 'number', value: offset + 1 },
				children: [],
			},
			{
				id: 'line-detail-directions',
				title: t.directions,
				level: 2,
				badge: { kind: 'number', value: offset + 2 },
				children: [],
			},
		);
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

	// HONEST ABSENCE — show the inferred-reason note in the Detail pane only once the
	// live tier has settled (a tick has landed) AND no bus is on the route. Never
	// while the feed is still loading (that is the skeleton's job, not a "closed"
	// claim). `absenceReason` may still be null (no derivable signal) → we render a
	// plain honest no-data note instead of inventing a reason.
	const showAbsenceNote = $derived(live.generatedUtc != null && roster.length === 0);

	// The roster's delay reading: a known delay reads early / on time / N min late;
	// a NULL delay reads an honest "no data" (not "no delay", which would imply
	// on-time), and is NEVER rendered as a fabricated 0.
	function rosterDelayLabel(delay: number | null | undefined): string {
		if (delay == null) return t.roster.noData;
		return delayLabel(delay, t);
	}

	const tripHref = (tripId: string): string =>
		localizeHref(routeFor({ kind: 'trip', id: tripId }), locale);

	// schedule pane formats headway minutes; the reliability tab is now the
	// dedicated 9.6 clustered surface (RouteReliabilityClusters) — it owns its own
	// formatting + the snapshot strip + 5 cluster bands off the same archive.
	const fmtMin = (v: number | null | undefined): string | null =>
		sharedFmtDelayMin(v, { rounding: 'fixed1' });
</script>

<!-- The (i) metric-explainer affordance, reused inside the Schedule pane. Declared
     at the top level so the pane snippet (passed to EntityDetail) can render it. -->
{#snippet scheduleInfo(key: MetricKey, name: string)}
	{@const i = info(key, name)}
	<MetricInfo
		class="route-metric-info"
		tip={i.tip}
		href={i.href}
		label={i.label}
		linkLabel={i.linkLabel}
		side="bottom"
	/>
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
					href={mapHrefFor({ route: id }, locale)}
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
					<!-- The Detail pane uses the full desktop width: the live roster + the
					     affected alerts sit in a fixed-width LIST column; the static
					     directions-with-stops fill the flexing DETAIL pane (single column on
					     mobile). The list column stands down entirely when no live bus is on
					     the route AND no alert is active (hasListColumn) so the directions take
					     the whole width, never an empty bordered column. -->
					<ArticleSectionStack>
						{#key id}
							{#if hasListColumn}
								<CollapsibleSection
									title={t.liveService.title}
									subtitle={t.liveService.summary}
									headerVariant="article-summary"
									index={0}
									anchor="line-detail-live"
									sectionKey={`line-detail-${id}-live`}
									closeSignal={quietModeStore.closeSignal}
									openSignal={quietModeStore.openSignal}
									bulkCollapsed={quietModeStore.enabled}
								>
									<div class="route-aside">
										<!-- LIVE: service alerts affecting this route (stands down when none). -->
										<AffectedAlerts
											alerts={routeAlerts}
											{locale}
											copy={t.alerts}
											testId="route-alerts"
										/>

										<!-- LIVE: current-buses roster — the vehicles running this route right
									     now, worst-delay first, each linking to its trip. Stands down
									     entirely when no live bus is on the route (metro / feed gap). -->
										{#if roster.length > 0}
											<div class="route-roster" data-testid="route-roster">
												<div class="route-section-head">
													<SectionHeading level={2} overline={t.roster.heading} />
													<span class="route-roster-count">{t.roster.count(roster.length)}</span>
												</div>
												<ul class="route-roster-list" aria-label={t.roster.listLabel}>
													{#each roster as bus, bi (bus.id)}
														<li class="route-roster-item">
															{#if bus.trip}
																<a
																	class="route-roster-link"
																	href={tripHref(bus.trip)}
																	aria-label={t.roster.viewTrip(bus.id)}
																>
																	<RankedRow
																		bare
																		rank={bi + 1}
																		title={t.roster.busLabel(bus.id)}
																		subtitle={bus.next_stop != null
																			? t.roster.nextStop(bus.next_stop)
																			: undefined}
																		severity={delaySeverity(bus.delay_min)}
																		colorVar={delayColorVar(bus.delay_min)}
																		value={bus.delay_min ?? null}
																		domain={DELAY_POS_DOMAIN}
																		unit=" min"
																		display={rosterDelayLabel(bus.delay_min)}
																	/>
																	<ChevronRightIcon
																		size={14}
																		strokeWidth={2.4}
																		aria-hidden="true"
																	/>
																</a>
															{:else}
																<!-- No trip id to link to: still surface the bus + its map link. -->
																<div class="route-roster-link route-roster-link--static">
																	<RankedRow
																		bare
																		rank={bi + 1}
																		title={t.roster.busLabel(bus.id)}
																		subtitle={bus.next_stop != null
																			? t.roster.nextStop(bus.next_stop)
																			: undefined}
																		severity={delaySeverity(bus.delay_min)}
																		colorVar={delayColorVar(bus.delay_min)}
																		value={bus.delay_min ?? null}
																		domain={DELAY_POS_DOMAIN}
																		unit=" min"
																		display={rosterDelayLabel(bus.delay_min)}
																	/>
																</div>
															{/if}
															<a
																class="route-roster-map"
																href={mapHrefFor({ vehicle: bus.id }, locale)}
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

							<CollapsibleSection
								title={t.profile.title}
								subtitle={t.profile.summary}
								headerVariant="article-summary"
								index={hasListColumn ? 1 : 0}
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
								index={hasListColumn ? 2 : 1}
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
									<!-- HONEST ABSENCE: when no live bus is on this route, STATE the
									     inferred reason (metro has no realtime / service closed — opens at
								     FIRST / scheduled-but-silent) instead of leaving the live readout
								     to silently say "no live bus" per stop. emptyReason is null when no
								     reason is derivable → the EdgeState shows the plain honest no-data
								     copy, never a fabricated reason. -->
									{#if showAbsenceNote}
										<EdgeState
											variant="empty"
											lang={locale}
											layout="mobile"
											emptyReason={absenceReason}
											class="route-absence-note"
										/>
									{/if}
									<!-- The loved bidirectional layout, now its own reusable component
									     (LineDirections) — both directions side-by-side when the pane is
									     wide, each a column of its ordered stops + the live readout. -->
									<LineDirections directions={file.directions} {predictions} {locale} copy={t} />
								</div>
							</CollapsibleSection>
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
								<!-- Keep the explanatory copy inside the first disclosure so every tab's
								     first card shares the same top edge with the rail. -->
								<p class="route-schedule-intro" data-slot="schedule-intro">{t.scheduleIntro}</p>
								<div class="route-schedule-span">
									<div class="route-departures">
										<div class="route-metric-cell">
											<MetricDisplay
												value={file.first_departure ?? null}
												emptyLabel={t.noData}
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
												emptyLabel={t.noData}
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
													period: period.shift,
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
			{#if reliability.settled && reliability.error == null && reliability.data == null && historyOnlyReliability != null && lineHistory.state !== 'current'}
				{#key id}
					<RouteReliabilityClusters
						data={historyOnlyReliability}
						{locale}
						directionHeadsigns={dirHeadsigns}
						history={lineHistory}
						articleSummary={detailTabController.active === 'reliability' && hasHeaderVerdict
							? routeBanner
							: undefined}
					/>
				{/key}
			{:else}
				<ResourceBoundary resource={reliability} lang={locale}>
					{#snippet children(rel)}
						{#key id}
							<RouteReliabilityClusters
								data={rel}
								{locale}
								directionHeadsigns={dirHeadsigns}
								history={lineHistory}
								articleSummary={detailTabController.active === 'reliability' && hasHeaderVerdict
									? routeBanner
									: undefined}
							/>
						{/key}
					{/snippet}
				</ResourceBoundary>
			{/if}
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
	/* Live roster + affected alerts share one article section. */
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
	/* Current-buses roster: one row per live vehicle, worst-delay first. */
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
	/* The bus row links to its trip; the RankedRow renders bare inside this <a>. */
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
	/* Compact "view on map" pill for each bus. */
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
	/* A schedule metric tile + its explainer (i), kept on the tile's top edge. */
	.route-metric-cell {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.375rem;
	}
	.route-schedule-cq {
		display: flex;
		flex-direction: column;
	}
	/* Plain-language schedule intro (operator): explains what the schedule shows + sends the
	   reader to the Reliability tab for real-world punctuality. Reads at foreground weight so
	   it is actually noticed, with a measure so it stays comfortable to read. */
	.route-schedule-intro {
		margin: 0 0 var(--space-card-gap);
		max-width: 64ch;
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

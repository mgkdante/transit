<!--
  StopDetail — tabbed detail for one stop (slice-9.3).

  Composes the shared ArticleHeader + EntityDetail scaffold over three tabs:

    detail      LIVE + STATIC — cohesive departures and stop-facts disclosures.
    schedule    STATIC        — scheduled[] grouped by route and headsign.
    reliability HISTORIC      — period, habit and retained-history analysis.

  Static + historic reads use createResource (browser-side, reactive to `id`);
  the live tier uses createLiveStore (start on mount, stop on destroy). Each pane
  fail-soft via ResourceBoundary / EdgeState — never invent data, never crash.

  Reads locale via getLocale(); copy is co-located in stops.copy.ts. Domain
  vocabulary inside the spine (OTP / delay / LIVE) lives in the primitives.
  Tokens only; --primary interactive-only.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import type { DetailTab } from '$lib/site/detailTabs';
	import { createDetailTabController } from '$lib/site/detailTabController.svelte';
	import { getStop } from '$lib/v1/repositories/static';
	import { getStopReliability } from '$lib/v1/repositories/historic';
	import { createLiveStore } from '$lib/v1/live/store.svelte';
	import { getV1Context } from '$lib/v1/boot';
	import { alertsForStop } from '$lib/v1/affectedAlerts';
	import { historyRangeRequestFromSearchParams } from '$lib/v1/history/rangeResource.svelte';
	import type { StopFile, StopReliability, StopDeparture } from '$lib/v1';
	import { createResource, type ResourceSeed } from '$lib/v1/resource.svelte';
	import { sharedClock } from '$lib/stores';
	import { minutesSinceMidnight } from '$lib/utils/time';
	import { inferAbsenceReason, stopServiceWindow } from '$lib/site/serviceWindow';
	import { depTone, toneColorVar, TONE_GLYPH, type ChipTone } from '$lib/site/delayPresentation';
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
	import { formatUtc } from '$lib/utils/time';
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

	// Per-route scheduled-times cap (the 5-col grid is dense, so a slightly higher cap
	// than the old flat-list 24 keeps the pane bounded without dumping hundreds of times;
	// the honest "+N more" note carries the remainder).
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

	// --- live tier: per-stop departures board --------------------------------
	const manifest = getV1Context().manifest;
	const live = createLiveStore(manifest, {
		families: ['departures', 'alerts', 'network'],
	});
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	const shortName = manifest.short_name?.trim() || manifest.display_name;
	const articleTags = $derived([`${t.article.stopId} ${id}`, shortName]);
	const articleEdgeLeft = $derived(`${t.kicker} ${id}`);
	const articleEdgeRight = $derived(
		live.generatedUtc ? formatUtc(live.generatedUtc, locale) : shortName,
	);
	const articleMeta = $derived.by<ArticleMetaEntry[]>(() => {
		const values: ArticleMetaEntry[] = [
			{ label: t.article.stopId, text: id },
			{ label: t.article.provider, text: shortName },
		];
		if (live.generatedUtc != null) {
			values.push({
				label: t.article.updated,
				text: formatUtc(live.generatedUtc, locale),
				datetime: live.generatedUtc,
			});
		}
		return values;
	});
	// Departures for THIS stop from the authoritative per-stop board. null before
	// the first tick (skeleton); [] is a real "no upcoming departures" verdict.
	const departures = $derived<readonly StopDeparture[] | null>(
		live.departures ? (live.index.byStopId.get(id) ?? []) : null,
	);

	// --- static tier: stop detail (info + schedule) --------------------------
	const stop = createResource(() => getStop(id), {
		key: () => id,
		seed: () => stopSeed,
	});
	const articleTitle = $derived(
		seed.name.trim() === id && stop.data?.id === id
			? stop.data.name?.trim() || seed.name
			: seed.name,
	);

	// --- live tier: service alerts affecting THIS stop ------------------------
	// An alert affects this stop if it lists the stop id OR its public code in
	// stops[] (the live feed targets stops by CODE, which differs from the static
	// index id for metro stations), OR lists a route (in routes[]) that SERVES
	// this stop (routes_served from the static file). Reuses the live store's
	// already-loaded alerts — no second fetch. Empty -> the AffectedAlerts section
	// stands down. Honest: never fabricated.
	const stopAlerts = $derived(
		alertsForStop(live.alerts?.alerts, id, stop.data?.code, stop.data?.routes_served),
	);

	// --- historic tier: stop reliability -------------------------------------
	// NOTE: unlike RouteDetail, this fetch is NOT gated on an availability flag.
	// stops_index (StopIndexEntry) carries no per-stop `reliability` boolean — the
	// route side has RouteIndexEntry.reliability, the stop side has no equivalent.
	// Adding one would need a pipeline/contract change (out of scope here), so the
	// stop reliability probe stays unconditional + fail-soft (404 → null → empty
	// state). A missing-snapshot 404 here is suppressed at the edge (one-time cache
	// purge / future stops_index flag), not in this client code.
	const reliability = createResource(() => getStopReliability(id), { key: () => id });
	const stopSummaryPeriod = $derived.by(() => {
		const rows = (reliability.data?.periods ?? []).filter((period) => period.grain === 'day');
		return rows.at(-1) ?? null;
	});
	const stopSummarySevere = $derived(
		stopSummaryPeriod?.severe_pct == null
			? null
			: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(stopSummaryPeriod.severe_pct)}%`,
	);
	const stopSummaryDelay = $derived(
		stopSummaryPeriod?.avg_delay_min == null
			? null
			: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(stopSummaryPeriod.avg_delay_min)} ${reliabilityT.trend.minUnit}`,
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

	// --- HONEST ABSENCE: infer WHY the live board is empty --------------------
	// The stop's own service window is derived from its static schedule times
	// (earliest → latest, GTFS >=24:00 folded so an overnight window wraps). When
	// the board is empty we STATE the inferred reason (service closed — opens at
	// FIRST / overnight / scheduled-but-silent) rather than a generic no-data.
	// Honest by construction: a closed verdict needs a real window; silent needs
	// the non-responding signal; else null → the plain honest no-data copy. NOTE:
	// no metro gap inference at the stop level — a stop can serve mixed modes, so
	// we never over-claim "metro has no realtime" for a stop (that is route-scoped).

	// The stop's service window from its static schedule (all routes' times). null
	// when the static file has no scheduled times to claim a window against.
	const stopWindow = $derived(
		stopServiceWindow((stop.data?.scheduled ?? []).flatMap((s) => s.times ?? [])),
	);

	// Is ANY route serving this stop reported scheduled-but-silent by the live
	// network? (Per-route silent-trip tally ∩ this stop's routes_served.) A hit
	// means "within the window yet nothing is reporting here".
	const stopNonResponding = $derived.by(() => {
		const silent = new Set((live.network?.non_responding_by_route ?? []).map((r) => r.route_id));
		if (silent.size === 0) return false;
		return (stop.data?.routes_served ?? []).some((r) => silent.has(r));
	});

	// The inferred reason the board is empty, recomputed each shared tick. No
	// route_type/gaps metro inference at the stop level (a stop can serve mixed
	// modes — we never over-claim "metro has no realtime" for a stop), so this
	// rests on the service window + the silent signal. Null → plain no-data.
	const departuresAbsenceReason = $derived(
		inferAbsenceReason({
			firstDeparture: stopWindow?.first ?? null,
			lastDeparture: stopWindow?.last ?? null,
			// serverNow: the open/closed verdict must use the true (server-anchored)
			// wall clock, not a skewed client clock (same skew class as freshness).
			nowMinutes: minutesSinceMidnight(new Date(sharedClock.serverNow)),
			nonResponding: stopNonResponding,
		}),
	);

	/* ── Live departures: status + route filters ──────────────────────────────
	   The live board carries a delay_min per departure; the reader narrows it with
	   combinable status chips + an optional by-route chip. The status is now the
	   SITE-WIDE shared delayTone (five-tone: early / on-time / late / severe), so a
	   badly-late passage reads 'severe' (its own --dataviz-status-severe fill) instead
	   of being absorbed into 'late'. An ABSENT delay is an absent realtime delta, NOT
	   an on-time claim: it rides delayTone's 'none' no-data track (muted, no fill, no
	   glyph) and matches no status chip — visible only under "all". The four
	   FILTERABLE tones stay chips on the shared vocabulary. Both filters default
	   "off" (everything shown); an empty result shows a localized empty state. */
	const DEPARTURE_TONES: readonly ChipTone[] = ['on-time', 'late', 'severe', 'early'];

	// Map a departure tone → the closed StatusCode so the chips + row status read the
	// ONE shared bilingual vocabulary (STATUS_LABELS) — no invented per-surface labels.
	// The tone → glyph/fill mapping (TONE_GLYPH / toneColorVar / depTone) is the shared
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

	// ONE StopDetail instance is reused across /stop/A → /stop/B param changes, so
	// per-stop live-board filter state would otherwise carry over stale. Reading `id`
	// registers the dependency: on each stop change we reset the departure filters for
	// the new stop. Grain now lives in <StopReliabilitySurface> (codec-seeded, re-mounts
	// with the keyed pane); the tab controller owns the URL-backed active state, so it
	// is not reset here (a deep-linked tab must survive).
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
				const tone = depTone(d.delay_min);
				if (tone === 'none' || !statusFilter.has(tone)) return false;
			}
			if (routeFilter != null && d.route !== routeFilter) return false;
			return true;
		});
	});

	// A departure's delay caption comes from the site-wide shared delayLabel. `t.next`
	// supplies localized no-data copy so an absent realtime delta is never presented
	// as an on-time observation.
</script>

{#snippet stopInformation()}
	<ResourceBoundary resource={stop} lang={locale}>
		{#snippet children(s: StopFile | null)}
			{#if s == null}
				<EdgeState variant="empty" lang={locale} layout={edgeLayout} />
			{:else}
				<div class="stop-info">
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
					<AffectedAlerts alerts={stopAlerts} {locale} copy={t.alerts} testId="stop-alerts" />
				</div>
			{/if}
		{/snippet}
	</ResourceBoundary>
{/snippet}

{#snippet stopSummaryBanner()}
	<div
		class="stop-reliability-summary"
		data-slot="stop-reliability-summary"
		aria-label={reliabilityT.paneHeading}
	>
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
						{#snippet headerActions()}
							<FreshnessStamp
								variant="live"
								generatedUtc={live.generatedUtc}
								ageSeconds={live.ageSeconds}
								isStale={live.isStale}
								{locale}
							/>
						{/snippet}
						<!-- LIVE: per-stop departures board. Skeleton until the first tick. -->
						{#if departures == null}
							<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
						{:else}
							<div class="stop-next">
								{#if departures.length === 0}
									<!-- HONEST ABSENCE: an empty live board STATES the inferred reason
						     (service closed — opens at FIRST / no service at this hour /
						     scheduled-but-silent) from the stop's own window + the live silent
						     signal. emptyReason is null when no reason is derivable → the plain
						     honest no-data copy, never a fabricated reason. -->
									<EdgeState
										variant="empty"
										lang={locale}
										layout={edgeLayout}
										emptyReason={departuresAbsenceReason}
									/>
								{:else}
									<!-- Combinable status chips + an optional by-route chip narrow the
						     board, collected into ONE ControlsRail (quiet infra chrome,
						     discerned from the data canvas). Both default off (everything
						     shown); the data marks are unchanged — these are INTERACTION
						     controls, so --primary lives only on the active chip. -->
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
											{t.next.filter.showing(filteredDepartures?.length ?? 0, departures.length)}
										</p>
									</ControlsRail>

									<!-- Hazard tape discerns the controls zone from the data canvas. -->
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
										<!-- The departure ROW LIST is the reusable ScheduleTable (board mode) —
								     route · eta · colour+glyph delay caption, verbatim from the shared
								     kernel. The filter/count/skeleton/empty state stay in StopDetail. -->
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
							</div>
						{/if}
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
			<!-- STATIC: scheduled service grouped by route. -->
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
						<ResourceBoundary
							resource={stop}
							lang={locale}
							isEmpty={(s: StopFile | null) => (s?.scheduled?.length ?? 0) === 0}
						>
							{#snippet children(s: StopFile | null)}
								<div class="stop-schedule">
									<!-- The per-route schedule grid is the reusable ScheduleTable (grid mode) —
								     route code + headsign + the column-major times grid + honest per-route
								     absence, verbatim. The pane-level empty/skeleton stays on ResourceBoundary. -->
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
								</div>
							{/snippet}
						</ResourceBoundary>
					</CollapsibleSection>
				{/key}
			</ArticleSectionStack>
		{:else if key === 'reliability'}
			<!-- HISTORIC: the decomposed reliability surface. It owns the codec-seeded grain
			     rail, shared retained-history navigator, operator board, and daily trend.
			     Mirrors how RouteDetail mounts <RouteReliabilityClusters>. -->
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

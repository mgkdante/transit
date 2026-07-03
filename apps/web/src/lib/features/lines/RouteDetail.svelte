<!--
  RouteDetail — the per-line detail screen (slice-9.3).

  Composes the surface spine: an EntityDetail tabbed scaffold (Détail / Horaire /
  Fiabilité) headed by a SectionHeading. Each pane owns its own data load wrapped
  in a ResourceBoundary, so skeleton / error / empty render per-pane without
  bespoke plumbing:

    - detail + schedule  → static getRoute(id)            (RouteFile | null)
    - reliability        → historic getRouteReliability(id) (RouteReliability | null)

  A null load (HTTP 404) is the empty signal, not an error — ResourceBoundary
  routes it to the empty edge state. Raw reliability periods are mapped to the
  spine's normalized ReliabilityPeriodVM; domain vocabulary (OTP / delay / p90 /
  severe) is intrinsic to ReliabilityPane. Locale via getLocale(); non-intrinsic
  copy is co-located. Tokens, no hex; --primary stays interactive-only.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { mirrorSearchParam } from '$lib/site/urlMirror';
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
	} from '$lib/v1';
	import type { RouteFile, RouteReliability, Provenance, StopPrediction, Vehicle } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { minutesSinceMidnight } from '$lib/utils/time';
	import { sharedClock } from '$lib/stores';
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
	import { ListDetailGrid, verticalSectionTitleWord } from '$lib/components/layout';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import CornerMeta from '$lib/components/brand/CornerMeta.svelte';
	import { cornerMetaLabels } from '$lib/components/brand';
	import { formatUtc } from '$lib/utils/time';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import RouteReliabilityClusters from './reliability/RouteReliabilityClusters.svelte';
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
	}

	let { id }: RouteDetailProps = $props();

	const locale = getLocale();
	const t = $derived(detailCopy[locale]);

	// The in-app metric-explainer (i) affordance, same wiring as the reliability
	// clusters: a one-line tip + a localized deep link to /metrics#<anchor>.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	type TabKey = 'detail' | 'schedule' | 'reliability';
	const tabs = $derived<{ key: TabKey; label: string }[]>([
		{ key: 'detail', label: t.tabs.detail },
		{ key: 'schedule', label: t.tabs.schedule },
		{ key: 'reliability', label: t.tabs.reliability },
	]);
	// Deep-linkable tab: seed from ?tab on load (an unknown value falls to the default — the URL is a
	// hint, never a data source), then mirror the active tab to ?tab so a view is shareable. We use
	// replaceState (not pushState) so switching tabs never spams the history stack; the default tab is
	// OMITTED from the URL for a clean canonical /lines/<id>.
	const TAB_KEYS: readonly TabKey[] = ['detail', 'schedule', 'reliability'];
	const readTab = (): TabKey => {
		const p = page.url.searchParams.get('tab');
		return TAB_KEYS.includes(p as TabKey) ? (p as TabKey) : 'detail';
	};
	let active = $state<TabKey>(readTab());
	// Mirror the active tab to ?tab (omit the 'detail' default for a clean canonical URL).
	$effect(() => mirrorSearchParam('tab', active === 'detail' ? null : active));

	// detail + schedule share the static route file (reactive to `id`).
	const route = createResource<RouteFile | null>(() => getRoute(id));
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
	const reliability = createResource<RouteReliability | null>(() => {
		// Capture `id` SYNCHRONOUSLY: createResource tracks the fetcher's reactive reads
		// only during its synchronous portion (Svelte 5 stops $effect dependency tracking
		// at the first await/microtask). Reading `id` after an await would drop it as a
		// dependency, so client nav /lines/A → /lines/B would keep showing A's reliability
		// under B's header. Mirrors MapHero's capture-key-first convention.
		const routeId = id;
		return getRouteReliability(routeId);
	});

	// Live tier: one store for this surface (the v1 context is booted before
	// mount in the root layout). It polls vehicles/trips on the live ttl; the
	// Detail tab reads its index to derive per-stop predictions (client-side,
	// fail-soft: the static directions/stops render regardless). start()/stop()
	// are browser-only and idempotent.
	const manifest = getV1Context().manifest;
	const live = createLiveStore(manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// CornerMeta readouts (A4) — REAL data only. Provider is always present from the
	// manifest; the generated stamp prefers the live tier (the head's freshest data),
	// falling back to the reliability build; a datum that isn't present drops its
	// corner (never fabricated).
	const cm = cornerMetaLabels[locale];
	const shortName = manifest.short_name?.trim() || manifest.display_name;
	const cornerGeneratedUtc = $derived(live.generatedUtc ?? reliability.data?.generated_utc ?? null);
	const cornerGeneratedStamp = $derived(
		cornerGeneratedUtc != null ? formatUtc(cornerGeneratedUtc, locale) : null,
	);

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

	// The Detail pane lays the live roster + affected alerts into a ListDetailGrid
	// LIST column beside the directions-with-stops DETAIL pane. The list column is
	// rendered ONLY when it has content (a live bus on the route OR an active alert)
	// so it stands down entirely otherwise and the directions take the full width
	// (never an empty bordered list column).
	const hasListColumn = $derived(roster.length > 0 || routeAlerts.length > 0);

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

<EntityDetail
	kicker={t.kicker}
	back={{ href: localizeHref('/lines', locale), label: t.back }}
	lede={t.detailLede}
	edgeWord={verticalSectionTitleWord('reliability', locale)}
	{tabs}
	bind:active
>
	{#snippet cornerMeta()}
		<!-- A4: blueprint-margin corners — provider · generated (real data from the
		     manifest + the live/reliability tiers). aria-hidden, hidden < 768px. -->
		<CornerMeta>
			{#snippet topLeft()}<span class="line-corner">{cm.line} · {id}</span>{/snippet}
			{#snippet topRight()}{#if cornerGeneratedStamp}<span class="line-corner"
						>{cm.generated} · {cornerGeneratedStamp}</span
					>{/if}{/snippet}
			{#snippet bottomLeft()}<span class="line-corner">{cm.provider} · {shortName}</span>{/snippet}
		</CornerMeta>
	{/snippet}

	{#snippet header()}
		<SectionHeading heading={id} level={1} dot />
	{/snippet}

	{#snippet meta()}
		<MapDrilldownLink
			href={mapHrefFor({ route: id }, locale)}
			label={t.viewOnMap}
			ariaLabel={t.viewRouteOnMap(id)}
		/>
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
					<ListDetailGrid listWidth="360px" label={t.tabs.detail}>
						{#snippet list()}
							{#if hasListColumn}
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
																<ChevronRightIcon size={14} strokeWidth={2.4} aria-hidden="true" />
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
							{/if}
						{/snippet}

						{#snippet detail()}
							<div class="route-section route-directions-pane">
								<div class="route-section-head">
									<SectionHeading level={2} overline={t.directions} />
									{#if live.generatedUtc != null || live.ageSeconds != null}
										<FreshnessStamp
											variant="live"
											generatedUtc={live.generatedUtc}
											ageSeconds={live.ageSeconds}
											isStale={live.isStale}
											{locale}
										/>
									{/if}
								</div>
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
						{/snippet}
					</ListDetailGrid>
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'schedule'}
			<ResourceBoundary resource={route} lang={locale}>
				{#snippet children(file)}
					<!-- @container: container-type rides this PARENT wrapper; the two-column
					     layout below targets its DESCENDANT .route-schedule-grid (never the
					     wrapper itself — the self-target trap). When the schedule pane is
					     wide (≥40rem) the service-span block + the periods grid sit side by
					     side; below that they stack. -->
					<div class="route-schedule-cq">
						<!-- Operator: "some text to explain to people what everything is." A plain-language
						     intro frames the planned schedule + points to the Reliability tab for real OTP. -->
						<p class="route-schedule-intro" data-slot="schedule-intro">{t.scheduleIntro}</p>
						<div class="route-section route-schedule-grid" data-slot="route-schedule">
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
							<div class="route-schedule-periods">
								<div class="route-label-row">
									<SectionLabel text={t.servicePeriods} variant="metric" />
									{@render scheduleInfo('headway', t.servicePeriods)}
								</div>
								{#if (file.service_periods ?? []).length > 0}
									<ul class="route-periods">
										{#each file.service_periods ?? [] as sp, spi (sp.shift + '-' + spi)}
											<li class="route-period">
												<SectionLabel text={sp.shift} variant="metric" />
												<div class="route-period-metrics">
													{#if sp.window}
														<div class="route-metric-cell">
															<MetricDisplay value={sp.window} label={t.window} size="sm" />
															{@render scheduleInfo('serviceSpan', t.window)}
														</div>
													{/if}
													{#if sp.headway_min != null}
														<div class="route-metric-cell">
															<MetricDisplay
																value={fmtMin(sp.headway_min)}
																label={t.headway}
																size="sm"
															/>
															{@render scheduleInfo('headway', t.headway)}
														</div>
													{/if}
												</div>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						</div>
					</div>
				{/snippet}
			</ResourceBoundary>
		{:else}
			<ResourceBoundary resource={reliability} lang={locale}>
				{#snippet children(rel)}
					<RouteReliabilityClusters data={rel} {locale} directionHeadsigns={dirHeadsigns} />
				{/snippet}
			</ResourceBoundary>
		{/if}
	{/snippet}
</EntityDetail>

<style>
	.line-corner {
		white-space: nowrap;
	}
	.route-section {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	/* Detail-tab LIST column: the live roster + affected alerts stacked. On desktop
	   ListDetailGrid gives it a fixed 360px column with its own scroll + a divider
	   rule; here we just space its stacked children. */
	.route-aside {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	/* Detail-tab DETAIL pane: the directions-with-stops fill the flexing column.
	   On desktop ListDetailGrid scrolls it independently of the list; the inner pad
	   keeps the stop rows off the divider rule so the two panes breathe. */
	@media (min-width: 1024px) {
		.route-aside {
			padding-inline-end: 1.5rem;
		}
		.route-directions-pane {
			padding-inline-start: 1.5rem;
		}
	}
	.route-section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	/* A section label sitting next to its (i) metric-explainer affordance. */
	.route-label-row {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
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
		padding: 0.4rem 0.5rem;
		margin-inline: -0.5rem;
		border-radius: var(--radius-sm, 0.375rem);
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
	.route-roster-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	/* Compact "view on map" pill for each bus. */
	.route-roster-map {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.6rem;
		border-radius: var(--radius-pill, 999px);
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
	.route-roster-map:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
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
		gap: 0.35rem;
	}
	.route-periods {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	@media (min-width: 640px) {
		.route-periods {
			grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		}
	}

	/* ── SCHEDULE pane: 2-column-when-it-fits (@container) ──────────────────────
	   container-type rides this PARENT wrapper; the grid below targets its
	   DESCENDANT .route-schedule-grid — NEVER this same element (the self-target
	   trap). Below the threshold the grid stays a single stacked column; at ≥40rem
	   of CONTAINER width it splits into LEFT (service-span / first-last) + RIGHT
	   (the .route-periods grid), using the inset pane's own width, not the
	   viewport. */
	.route-schedule-cq {
		container-type: inline-size;
		container-name: route-schedule;
	}
	/* Plain-language schedule intro (operator): explains what the schedule shows + sends the
	   reader to the Reliability tab for real-world punctuality. Reads at foreground weight so
	   it is actually noticed, with a measure so it stays comfortable to read. */
	.route-schedule-intro {
		margin: 0 0 1.25rem;
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
	@container route-schedule (min-width: 40rem) {
		.route-schedule-grid {
			display: grid;
			grid-template-columns: minmax(0, 18rem) minmax(0, 1fr);
			gap: 1.5rem 2rem;
			align-items: start;
		}
	}

	.route-period {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1rem 1.25rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
		box-shadow: var(--shadow-card);
	}
	.route-period-metrics {
		display: flex;
		flex-wrap: wrap;
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

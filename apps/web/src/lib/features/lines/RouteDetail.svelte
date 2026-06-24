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
	import { getLocale, localizeHref } from '$lib/i18n';
	import { fmtDelayMin as sharedFmtDelayMin } from '$lib/utils';
	import { mapHrefFor, routeFor } from '$lib/nav';
	import {
		createLiveStore,
		deriveRouteStopPredictions,
		getRoute,
		getRouteReliability,
		getRoutesIndex,
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
	import { ListDetailGrid } from '$lib/components/layout';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import RouteReliabilityClusters from './reliability/RouteReliabilityClusters.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { detailCopy } from './lines.copy';
	import LineDirections from './LineDirections.svelte';
	import { delayColorVar, delaySeverity, delayLabel } from './delayPresentation';

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
	let active = $state<TabKey>('detail');

	// detail + schedule share the static route file (reactive to `id`).
	const route = createResource<RouteFile | null>(() => getRoute(id));
	// reliability is the historic per-route archive (reactive to `id`). We gate the
	// fetch on the routes-index availability flag (RouteIndexEntry.reliability) so a
	// route the pipeline KNOWS has no published reliability never probes
	// route_reliability/{id}.json — that probe is a guaranteed 404 and was flooding
	// the console (the loader fail-softs it to null, but the browser still logs it).
	// getRoutesIndex is cached (the list surface already loaded it), so this adds no
	// meaningful cost and stays reactive to `id`.
	//   - flag === false           → known-empty: return null, NO network probe.
	//   - flag === true | undefined → probe + fail-soft (true = published; undefined
	//                                 = a stale/legacy index predating the flag, so we
	//                                 must still probe or reliability data would be LOST).
	const reliability = createResource<RouteReliability | null>(async () => {
		// Capture `id` SYNCHRONOUSLY before the first await: createResource tracks the
		// fetcher's reactive reads only during its synchronous portion (Svelte 5 stops
		// $effect dependency tracking at the first await/microtask). Reading `id` after
		// the await would drop it as a dependency, so client nav /lines/A → /lines/B
		// would keep showing A's reliability under B's header. Mirrors MapHero's
		// capture-key-first convention.
		const routeId = id;
		const idx = await getRoutesIndex();
		const entry = idx.routes.find((r) => r.id === routeId);
		if (entry?.reliability === false) return null;
		return getRouteReliability(routeId);
	});

	// Live tier: one store for this surface (the v1 context is booted before
	// mount in the root layout). It polls vehicles/trips on the live ttl; the
	// Detail tab reads its index to derive per-stop predictions (client-side,
	// fail-soft: the static directions/stops render regardless). start()/stop()
	// are browser-only and idempotent.
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
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

	// The worst LATENESS on the roster, used to normalize the bar LENGTH. Only
	// positive (late) delays count — early/on-time buses contribute 0 so they never
	// inflate the denominator or earn a long bar.
	const rosterWorstDelay = $derived(
		roster.reduce(
			(m, v) => Math.max(m, v.delay_min != null && v.delay_min > 0 ? v.delay_min : 0),
			0,
		),
	);

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

	/**
	 * Normalized [0,1] bar LENGTH = how LATE (only positive delay). Early / on-time
	 * read near-zero length (calm); a null delay → null (no-data track, never 0).
	 */
	function delayMagnitude(delay: number | null | undefined): number | null {
		if (delay == null) return null;
		if (delay <= 0) return 0;
		if (rosterWorstDelay <= 0) return 0;
		return Math.min(1, delay / rosterWorstDelay);
	}

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
	{tabs}
	bind:active
>
	{#snippet header()}
		<div class="route-detail-head">
			<SectionHeading heading={id} level={1} dot />
			<MapDrilldownLink
				href={mapHrefFor({ route: id }, locale)}
				label={t.viewOnMap}
				ariaLabel={t.viewRouteOnMap(id)}
			/>
		</div>
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
												<SectionLabel text={t.roster.heading} variant="station" />
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
																	value={delayMagnitude(bus.delay_min)}
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
																	value={delayMagnitude(bus.delay_min)}
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
									<SectionLabel text={t.directions} variant="station" />
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
					<RouteReliabilityClusters data={rel} {locale} />
				{/snippet}
			</ResourceBoundary>
		{/if}
	{/snippet}
</EntityDetail>

<style>
	.route-detail-head {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
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

	@media (max-width: 520px) {
		.route-detail-head {
			align-items: start;
			flex-direction: column;
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

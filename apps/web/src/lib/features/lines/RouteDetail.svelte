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
	import { mapHrefFor, routeFor } from '$lib/nav';
	import {
		createLiveStore,
		deriveRouteStopPredictions,
		getRoute,
		getRouteReliability,
		getV1Context,
		alertsForRoute,
	} from '$lib/v1';
	import type { RouteFile, RouteReliability, StopPrediction, Vehicle, SeverityCode } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { formatUtc } from '$lib/utils/time';
	import {
		EntityDetail,
		ResourceBoundary,
		MapDrilldownLink,
		LiveFreshness,
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
	// reliability is the historic per-route archive (reactive to `id`).
	const reliability = createResource<RouteReliability | null>(() => getRouteReliability(id));

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

	/**
	 * A vehicle's delay banded to a dataviz STATUS tone (calm-by-default), matching
	 * TripDetail.delayTone and the map's selection detail: early / on-time read
	 * calm, late / severe escalate. Drives the bar's COLOUR (status scale), NOT the
	 * problem-severity scale — an early bus is honest blue, never RED.
	 */
	function delayTone(delay: number | null | undefined): string {
		if (delay == null) return 'none';
		if (delay < 0) return 'early';
		if (delay >= 5) return 'severe';
		if (delay > 0) return 'late';
		return 'on-time';
	}

	// Map a delay-tone to the `var(--dataviz-status-*)` fill colour for the bar.
	const TONE_VAR: Record<string, string | undefined> = {
		early: 'var(--dataviz-status-early)',
		'on-time': 'var(--dataviz-status-on-time)',
		late: 'var(--dataviz-status-late)',
		severe: 'var(--dataviz-status-severe)',
		none: undefined,
	};

	/** Status-band fill colour for a vehicle's delay (undefined → no-data track). */
	function delayColorVar(delay: number | null | undefined): string | undefined {
		return TONE_VAR[delayTone(delay)];
	}

	/**
	 * The a11y band SeverityBar announces. Keyed off LATENESS only so an early /
	 * on-time bus is announced calm ('watch', the lowest band), never 'critical' /
	 * 'high'. A null delay is also calm — the visible "no data" text carries the
	 * honesty. Visible colour comes from delayColorVar (status scale), not this.
	 */
	function delaySeverity(delay: number | null | undefined): SeverityCode {
		if (delay == null || delay <= 0) return 'watch';
		return delay >= 10 ? 'critical' : delay >= 5 ? 'high' : 'watch';
	}

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
		return delayLabel(delay);
	}

	const tripHref = (tripId: string): string =>
		localizeHref(routeFor({ kind: 'trip', id: tripId }), locale);

	// schedule pane formats headway minutes; the reliability tab is now the
	// dedicated 9.6 clustered surface (RouteReliabilityClusters) — it owns its own
	// formatting + the snapshot strip + 5 cluster bands off the same archive.
	const fmtMin = (v: number | null | undefined): string =>
		v == null ? '·' : `${v.toFixed(1)} min`;

	const stopHref = (stopId: string): string =>
		localizeHref(routeFor({ kind: 'stop', id: stopId }), locale);

	const timeLabel = (iso: string): string =>
		formatUtc(iso, locale, { hour: '2-digit', minute: '2-digit', hour12: false });

	// Plain-language delay reading for the approaching bus, reused from the live
	// vocabulary: early / on time / N min late, or "no delay" when the feed omits it.
	function delayLabel(delay: number | null | undefined): string {
		if (delay == null) return t.noDelay;
		if (delay < 0) return t.early(delay);
		if (delay > 0) return t.late(delay);
		return t.onTime;
	}
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
										<LiveFreshness
											generatedUtc={live.generatedUtc}
											ageSeconds={live.ageSeconds}
											isStale={live.isStale}
											{locale}
										/>
									{/if}
								</div>
								{#if (file.directions ?? []).length > 0}
									<ul class="route-directions">
										{#each file.directions ?? [] as dir, di (di)}
											<li class="route-direction">
												<span class="route-direction-head">
													<span class="route-direction-name">
														{dir.headsign ?? t.direction(dir.dir)}
													</span>
													<span class="route-direction-meta">
														{t.stopsCount((dir.stops ?? []).length)}
													</span>
												</span>
												{#if (dir.stops ?? []).length > 0}
													<ol class="route-stops">
														{#each dir.stops ?? [] as stop, si (stop.id + '-' + si)}
															{@const prediction = predictions.get(stop.id) ?? null}
															<li class="route-stop">
																<a
																	class="route-stop-link"
																	href={stopHref(stop.id)}
																	aria-label={t.viewStop(stop.name ?? stop.id)}
																>
																	<span class="route-stop-seq">{stop.seq}</span>
																	<span class="route-stop-name">{stop.name ?? stop.id}</span>
																	<span class="route-stop-live">
																		{#if prediction}
																			{#if prediction.etaUtc}
																				<time class="route-stop-eta" datetime={prediction.etaUtc}>
																					{timeLabel(prediction.etaUtc)}
																				</time>
																			{:else}
																				<span class="route-stop-eta">{t.approaching}</span>
																			{/if}
																			<span
																				class="route-stop-delay"
																				data-tone={delayTone(prediction.delayMin)}
																			>
																				{delayLabel(prediction.delayMin)}
																			</span>
																		{:else}
																			<span class="route-stop-nolive">{t.noLiveBus}</span>
																		{/if}
																	</span>
																	<ChevronRightIcon
																		size={14}
																		strokeWidth={2.4}
																		aria-hidden="true"
																	/>
																</a>
															</li>
														{/each}
													</ol>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/snippet}
					</ListDetailGrid>
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'schedule'}
			<ResourceBoundary resource={route} lang={locale}>
				{#snippet children(file)}
					<div class="route-section">
						<div class="route-departures">
							<div class="route-metric-cell">
								<MetricDisplay
									value={file.first_departure ?? '·'}
									label={t.firstDeparture}
									size="sm"
								/>
								{@render scheduleInfo('serviceSpan', t.firstDeparture)}
							</div>
							<div class="route-metric-cell">
								<MetricDisplay
									value={file.last_departure ?? '·'}
									label={t.lastDeparture}
									size="sm"
								/>
								{@render scheduleInfo('serviceSpan', t.lastDeparture)}
							</div>
						</div>
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
	.route-directions {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.route-direction {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.route-direction-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.route-direction-name {
		font-family: var(--font-heading);
		font-weight: 600;
		font-size: var(--text-subheading);
		color: var(--foreground);
	}
	.route-direction-meta {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.route-stops {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.route-stop {
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.route-stop:last-child {
		border-bottom: none;
	}
	/* Each stop is a link into its detail page: seq · name + live readout · chevron. */
	.route-stop-link {
		display: grid;
		grid-template-columns: 2ch minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.875rem;
		width: calc(100% + 1rem);
		margin-inline: -0.5rem;
		padding: 0.5rem;
		border-radius: var(--radius-sm, 0.375rem);
		color: var(--foreground);
		text-decoration: none;
		transition: background-color var(--duration-fast) var(--ease-out);
	}
	.route-stop-seq {
		min-width: 2ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		text-align: right;
	}
	.route-stop-name {
		font-size: var(--text-body);
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color var(--duration-fast) var(--ease-out);
	}
	/* Live readout: soonest predicted arrival + the approaching bus's status, or
	   an honest "no live bus" placeholder when nothing is currently predicting. */
	.route-stop-live {
		grid-column: 2;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.route-stop-eta {
		font-weight: 600;
		color: var(--foreground);
	}
	.route-stop-delay {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		white-space: nowrap;
		color: var(--muted-foreground);
	}
	.route-stop-delay::before {
		content: '';
		width: 0.4rem;
		height: 0.4rem;
		border-radius: var(--radius-pill);
		background: currentcolor;
		flex: none;
	}
	.route-stop-delay[data-tone='none'] {
		color: var(--muted-foreground);
	}
	.route-stop-delay[data-tone='none']::before {
		display: none;
	}
	.route-stop-delay[data-tone='early'] {
		color: var(--dataviz-status-early);
	}
	.route-stop-delay[data-tone='on-time'] {
		color: var(--dataviz-status-on-time);
	}
	.route-stop-delay[data-tone='late'] {
		color: var(--dataviz-status-late);
	}
	.route-stop-delay[data-tone='severe'] {
		color: var(--dataviz-status-severe);
	}
	.route-stop-nolive {
		color: var(--muted-foreground);
	}
	.route-stop-link :global(svg) {
		opacity: 0.45;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.route-stop-link:hover {
		background: color-mix(in srgb, var(--primary) 7%, transparent);
	}
	.route-stop-link:hover .route-stop-name {
		color: var(--primary);
	}
	.route-stop-link:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	.route-stop-link:focus-visible {
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
		.route-stop-link,
		.route-stop-name,
		.route-stop-link :global(svg),
		.route-roster-link,
		.route-roster-link :global(svg),
		.route-roster-map {
			transition: none;
		}
		.route-stop-link:hover :global(svg),
		a.route-roster-link:hover :global(svg) {
			transform: none;
		}
	}
</style>

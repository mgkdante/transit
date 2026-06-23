<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { Locale } from '$lib/i18n';
	import type { Chip } from '$lib/filters';
	import type { Alert, OccupancyCode, StatusCode } from '$lib/v1/schemas';
	import { AbsentValue } from '$lib/components/edge';
	import { routeNameFallback, stopNameFallback } from '$lib/site/absence';
	import { ROUTE_TYPE_METRO } from '$lib/site/serviceWindow';
	import { OCCUPANCY_LABELS, STATUS_LABELS } from './map.copy';
	import { alertDisplayText } from './mapAlerts';
	import { causeLabel, effectLabel } from './gtfsAlertLabels';
	import type { MapSelection, MapSelectionDetail, MapStopRef } from './mapSelection';
	import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
	import {
		delayKnownLabel,
		delayMaybe,
		delayTone,
		directionLabel,
		formatAge,
		isDetailMetro,
		stopDisplayName,
		timeLabel,
		vehicleForDeparture,
	} from './mapSelectionDetail.logic';

	interface Props {
		detail: MapSelectionDetail | null;
		locale: Locale;
		compact?: boolean;
		onselect?: (selection: MapSelection) => void;
		onfilter?: (chip: Chip) => void;
		onalertselect?: (alert: Alert) => void;
		/** Set when this detail is a VEHICLE whose fix has gone stale (silent GPS) →
		 * renders an honest, calm "Not reporting GPS · last updated position N ago"
		 * caution note. `ageS` = seconds since the bus's OWN last fix. Null hides it. */
		notReporting?: { ageS: number } | null;
	}

	let {
		detail,
		locale,
		compact = false,
		onselect,
		onfilter,
		onalertselect,
		notReporting = null,
	}: Props = $props();

	const t = $derived(MAP_SELECTION_DETAIL_COPY[locale]);

	// True when the FOCUSED detail is a metro route — drives the honest "no live data"
	// reason on a missing metro delay (pure: mapSelectionDetail.logic.isDetailMetro).
	const detailIsMetro = $derived(isDetailMetro(detail));

	// Per-locale "sequence unknown" aria for a stop with no order index (seq null),
	// so the position is honestly announced instead of an empty cell.
	const seqUnknownAria = $derived(locale === 'fr' ? 'Séquence inconnue' : 'Sequence unknown');

	function selectRoute(
		route: string | null | undefined,
		direction?: number | null,
		variantKey?: string | null,
	): void {
		if (!route) return;
		onselect?.({
			kind: 'route',
			id: route,
			...(direction == null ? {} : { direction }),
			...(variantKey == null ? {} : { variantKey }),
		});
	}

	function selectStop(id: string): void {
		onselect?.({ kind: 'stop', id });
	}

	function selectVehicle(id: string): void {
		onselect?.({ kind: 'vehicle', id });
	}

	function filterStatus(code: StatusCode): void {
		onfilter?.({ kind: 'status', value: code });
	}

	function filterOccupancy(code: OccupancyCode | null | undefined): void {
		if (!code) return;
		onfilter?.({ kind: 'occupancy', value: code });
	}

	function filterTrip(trip: string | null | undefined): void {
		if (!trip) return;
		onfilter?.({ kind: 'trip', value: trip });
	}

	function displayAlert(alert: Alert): string {
		return alertDisplayText(alert, locale);
	}
</script>

<!-- One delay cell, reused at every site (vehicle, next stops, live buses, buses to
     a stop, departures, route-times). KNOWN → the coloured delay tag (on-time only
     for 0); ABSENT → the honest absence routed through the layer (AbsentValue),
     never "No delay" and never reading as on-time. -->
{#snippet delayCell(
	delay: number | null | undefined,
	ctx: { stale?: boolean; metro?: boolean } = {},
)}
	{@const m = delayMaybe(delay, ctx)}
	{#if m.known}
		<span class="map-delay-tag" data-tone={delayTone(m.value)}>
			{delayKnownLabel(m.value, t)}
		</span>
	{:else}
		<AbsentValue reason={m.reason} {locale} params={m.params} />
	{/if}
{/snippet}

<!-- A stop name that NEVER leaks a bare id: when the static index did not name the
     stop, render the honest labelled fallback ("Stop {id} (name unavailable)") via
     the absence layer instead of the id alone. -->
{#snippet stopRefName(ref: MapStopRef)}
	{#if ref.nameAbsent}
		<span class="map-inline-label">{stopNameFallback(ref.id, locale)}</span>
	{:else}
		<span class="map-inline-label">{ref.name}</span>
	{/if}
{/snippet}

{#if detail}
	<article class:compact class="map-selection-detail" data-kind={detail.kind}>
		<header class="map-selection-head">
			<p class="map-selection-kind">
				{detail.kind === 'vehicle' ? t.bus : detail.kind === 'route' ? t.route : t.stop}
			</p>
			<h2 class="map-selection-title">{detail.title}</h2>
		</header>

		{#if detail.kind === 'vehicle'}
			<div class="map-selection-id">
				<span>{t.bus}</span>
				<button
					type="button"
					class="map-id-action"
					aria-label={t.selectBus(detail.vehicle.id)}
					onclick={() => selectVehicle(detail.vehicle.id)}
				>
					<strong>{detail.vehicle.id}</strong>
					<ChevronRightIcon size={14} strokeWidth={2.4} aria-hidden="true" />
				</button>
			</div>
			{#if notReporting}
				<p class="map-not-reporting" role="status">
					<TriangleAlertIcon size={14} strokeWidth={2.4} aria-hidden="true" />
					<span>{t.notReporting} · {t.lastPosition(formatAge(notReporting.ageS))}</span>
				</p>
			{/if}
			<dl class="map-detail-grid">
				<div>
					<dt>{t.route}</dt>
					<dd>
						{#if detail.vehicle.route}
							<button
								type="button"
								class="map-inline-action"
								aria-label={t.selectRoute(detail.vehicle.route)}
								onclick={() =>
									selectRoute(
										detail.vehicle.route,
										detail.routeDirection?.dir ?? null,
										detail.routeDirectionVariant?.key ?? null,
									)}
							>
								{detail.vehicle.route}
								<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
							</button>
						{:else}
							{t.noData}
						{/if}
					</dd>
				</div>
				<div>
					<dt>{t.status}</dt>
					<dd>
						<button
							type="button"
							class="map-inline-action"
							aria-label={t.filterStatus(STATUS_LABELS[locale][detail.vehicle.status])}
							onclick={() => filterStatus(detail.vehicle.status)}
						>
							{STATUS_LABELS[locale][detail.vehicle.status]}
							<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
						</button>
					</dd>
				</div>
				<div>
					<dt>{t.crowding}</dt>
					<dd>
						{#if detail.vehicle.occupancy}
							<button
								type="button"
								class="map-inline-action"
								aria-label={t.filterCrowding(OCCUPANCY_LABELS[locale][detail.vehicle.occupancy])}
								onclick={() => filterOccupancy(detail.vehicle.occupancy)}
							>
								{OCCUPANCY_LABELS[locale][detail.vehicle.occupancy]}
								<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
							</button>
						{:else}
							{t.noData}
						{/if}
					</dd>
				</div>
				<div>
					<dt>{t.delay}</dt>
					<dd>
						{@render delayCell(detail.vehicle.delay_min, {
							stale: notReporting != null,
							metro: detail.routeType === ROUTE_TYPE_METRO,
						})}
					</dd>
				</div>
				<div>
					<dt>{t.nextStop}</dt>
					<dd>
						{#if detail.nextStop}
							{@const nextStop = detail.nextStop}
							<button
								type="button"
								class="map-inline-action"
								aria-label={t.selectStop(nextStop.name)}
								onclick={() => selectStop(nextStop.id)}
							>
								<span class="map-inline-label">{nextStop.name}</span>
								<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
							</button>
						{:else}
							<!-- No RESOLVED next stop: render the honest reason (unknown vs end of
							     route) via the layer, never the raw next_stop id. -->
							<AbsentValue reason={detail.nextStopAbsence} {locale} />
						{/if}
					</dd>
				</div>
				<div>
					<dt>{t.trip}</dt>
					<dd>
						{#if detail.vehicle.trip}
							<button
								type="button"
								class="map-inline-action"
								aria-label={t.filterTrip(detail.vehicle.trip)}
								onclick={() => filterTrip(detail.vehicle.trip)}
							>
								{detail.vehicle.trip}
								<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
							</button>
						{:else}
							{t.noTrip}
						{/if}
					</dd>
				</div>
			</dl>
			{#if !compact}
				{#if detail.pastStops.length > 0}
					<section class="map-stop-sequence" aria-label={t.pastStops}>
						<h3>{t.pastStops}</h3>
						<ol>
							{#each detail.pastStops as stop (stop.id)}
								<li>
									<button
										type="button"
										class="map-stop-action"
										aria-label={t.selectStop(stopDisplayName(stop, locale))}
										onclick={() => selectStop(stop.id)}
									>
										<span aria-label={stop.seq == null ? seqUnknownAria : undefined}>
											{stop.seq ?? ''}
										</span>
										<strong>
											{#if stop.nameAbsent}
												{@render stopRefName(stop)}
											{:else}
												{stop.name}
											{/if}
										</strong>
										<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
									</button>
								</li>
							{/each}
						</ol>
					</section>
				{/if}
				{#if detail.nextStops.length > 0}
					<section class="map-stop-sequence" aria-label={t.nextStops}>
						<h3>{t.nextStops}</h3>
						<ol>
							{#each detail.nextStops as stop (stop.id)}
								<li>
									<button
										type="button"
										class="map-stop-action"
										aria-label={t.selectStop(stopDisplayName(stop, locale))}
										onclick={() => selectStop(stop.id)}
									>
										<span aria-label={stop.seq == null ? seqUnknownAria : undefined}>
											{stop.seq ?? ''}
										</span>
										<strong>
											{#if stop.nameAbsent}
												{@render stopRefName(stop)}
											{:else}
												{stop.name}
											{/if}
										</strong>
										<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
										{#if stop.etaUtc}
											<small>
												<time>{timeLabel(stop.etaUtc, locale)}</time>
												{@render delayCell(stop.delayMin, { metro: detailIsMetro })}
											</small>
										{:else}
											<!-- ETA absent for a known next stop: render an explicit "ETA
											     unavailable" marker (no prediction) instead of dropping the row. -->
											<small>
												<AbsentValue reason="no-prediction" {locale} />
											</small>
										{/if}
									</button>
								</li>
							{/each}
						</ol>
					</section>
				{/if}
			{/if}
		{:else if detail.kind === 'route'}
			<div class="map-selection-id">
				<span>{t.route}</span>
				<strong>{detail.id}</strong>
			</div>
			<dl class="map-detail-grid">
				<div>
					<dt>{t.route}</dt>
					<!-- No published long name: say "Route {id}" explicitly (the id IS the
						     rider-facing route number), never a bare unlabelled id. -->
					<dd>{detail.route.long ?? routeNameFallback(detail.id, locale)}</dd>
				</div>
				<div>
					<dt>{t.direction}</dt>
					<dd>{directionLabel(detail, t)}</dd>
				</div>
			</dl>
			<div class="map-stop-stats">
				<span>{t.visibleBuses(detail.vehicles.length)}</span>
			</div>
			{#if !compact && detail.vehicles.length > 0}
				<section class="map-live-buses" aria-label={t.liveBuses}>
					<h3>{t.liveBuses}</h3>
					<ol>
						{#each detail.vehicles.slice(0, 8) as vehicle (vehicle.id)}
							<li>
								<button
									type="button"
									class="map-vehicle-action"
									aria-label={t.selectBus(vehicle.id)}
									onclick={() => selectVehicle(vehicle.id)}
								>
									<strong>{vehicle.id}</strong>
									<span>{vehicle.route ? `${t.route} ${vehicle.route}` : t.bus}</span>
									<small>
										<span class="map-status-label">{STATUS_LABELS[locale][vehicle.status]}</span>
										{@render delayCell(vehicle.delay_min, { metro: detailIsMetro })}
									</small>
									<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
								</button>
							</li>
						{/each}
					</ol>
				</section>
			{/if}
			{#if !compact && detail.directions.length > 0}
				<section class="map-stop-sequence" aria-label={t.stops}>
					<h3>{t.stops}</h3>
					{#each detail.directions as direction (direction.variantKey)}
						<div class="map-direction-block">
							<h4>
								<span class="map-direction-name">
									{direction.label}
									{#if direction.labelInferred}
										<!-- Synthesized "Direction {dir}" placeholder (no terminal/headsign):
										     mark it inferred through the layer so it never reads as published. -->
										<AbsentValue reason="inferred" {locale} />
									{/if}
								</span>
								{#if direction.headsign && direction.headsign !== direction.label}
									<small>{direction.headsign}</small>
								{/if}
							</h4>
							<ol>
								{#each direction.stops as stop (stop.id)}
									<li>
										<button
											type="button"
											class="map-stop-action"
											aria-label={t.selectStop(stopDisplayName(stop, locale))}
											onclick={() => selectStop(stop.id)}
										>
											<span aria-label={stop.seq == null ? seqUnknownAria : undefined}>
												{stop.seq ?? ''}
											</span>
											<strong>
												{#if stop.nameAbsent}
													{@render stopRefName(stop)}
												{:else}
													{stop.name}
												{/if}
											</strong>
											<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
										</button>
									</li>
								{/each}
							</ol>
						</div>
					{/each}
				</section>
			{/if}
		{:else}
			<div class="map-selection-id">
				<span>{t.stopCode}</span>
				<strong>{detail.stop.code ?? detail.stop.id}</strong>
			</div>
			<div class="map-stop-stats">
				<span>{t.departures(detail.departures.length)}</span>
				<span>{t.vehiclesHeading(detail.vehicles.length)}</span>
			</div>
			{#if !compact && detail.vehicles.length > 0}
				<section class="map-live-buses" aria-label={t.liveBuses}>
					<h3>{t.liveBuses}</h3>
					<ol>
						{#each detail.vehicles.slice(0, 8) as vehicle (vehicle.id)}
							<li>
								<button
									type="button"
									class="map-vehicle-action"
									aria-label={t.selectBus(vehicle.id)}
									onclick={() => selectVehicle(vehicle.id)}
								>
									<strong>{vehicle.id}</strong>
									<span>{vehicle.route ? `${t.route} ${vehicle.route}` : t.bus}</span>
									<small>
										<span class="map-status-label">{STATUS_LABELS[locale][vehicle.status]}</span>
										{@render delayCell(vehicle.delay_min)}
									</small>
									<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
								</button>
							</li>
						{/each}
					</ol>
				</section>
			{/if}
			{#if detail.departures.length > 0 && !compact}
				<ol class="map-departures" aria-label={t.departures(detail.departures.length)}>
					{#each detail.departures.slice(0, 4) as departure (departure.trip ?? `${departure.route}:${departure.eta_utc}`)}
						{@const vehicle = vehicleForDeparture(detail.vehicles, departure)}
						<li>
							{#if departure.route}
								<button
									type="button"
									class="map-inline-action"
									aria-label={t.selectDepartureRoute(departure.route)}
									onclick={() => selectRoute(departure.route)}
								>
									{t.route}
									{departure.route}
									<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
								</button>
							{:else}
								<strong>{t.route}</strong>
							{/if}
							{#if departure.trip}
								<button
									type="button"
									class="map-inline-action"
									aria-label={t.filterTrip(departure.trip)}
									onclick={() => filterTrip(departure.trip)}
								>
									{t.trip}
									{departure.trip}
									<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
								</button>
							{/if}
							{#if vehicle}
								<button
									type="button"
									class="map-inline-action"
									aria-label={t.selectBus(vehicle.id)}
									onclick={() => selectVehicle(vehicle.id)}
								>
									{t.bus}
									{vehicle.id}
									<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
								</button>
							{/if}
							{@render delayCell(departure.delay_min)}
						</li>
					{/each}
				</ol>
			{/if}
			{#if !compact && detail.routeTimes.length > 0}
				<section class="map-route-times" aria-label={t.routes}>
					<h3>{t.routes}</h3>
					{#each detail.routeTimes as route (route.route)}
						<article class="map-route-time">
							<header>
								<button
									type="button"
									class="map-inline-action"
									aria-label={t.selectRoute(route.route)}
									onclick={() => selectRoute(route.route)}
								>
									{t.route}
									{route.route}
									<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
								</button>
								{#if route.headsign}
									<span>{route.headsign}</span>
								{/if}
							</header>
							<!-- Past / Next / Live arrival columns. data-slot lets the CSS (and the
							     E4 narrow-panel test) target the column block; at a narrow PANEL
							     width the @container rule collapses this to a tidy single compact
							     list — the Past column drops (least-essential) and Live/Next stack
							     as a clean list, each keeping its delay tag. -->
							<div class="map-time-columns" data-slot="route-time-columns">
								<div class="map-time-col map-time-col--past">
									<h4>{t.pastTimes}</h4>
									<ul>
										{#each route.pastTimes.slice(-4) as time (`past-${route.route}-${time}`)}
											<li>{time}</li>
										{:else}
											<li>{t.noData}</li>
										{/each}
									</ul>
								</div>
								<div class="map-time-col map-time-col--next">
									<h4>{t.nextTimes}</h4>
									<ul>
										{#each route.futureTimes.slice(0, 4) as time (`future-${route.route}-${time}`)}
											<li>{time}</li>
										{:else}
											<li>{t.noData}</li>
										{/each}
									</ul>
								</div>
								<div class="map-time-col map-time-col--live">
									<h4>{t.live}</h4>
									<ul class="map-live-list" data-slot="live-departures">
										{#each route.liveDepartures.slice(0, 3) as departure (`live-${route.route}-${departure.trip ?? departure.eta_utc}`)}
											<li>
												<time>{timeLabel(departure.eta_utc, locale)}</time>
												{@render delayCell(departure.delay_min)}
											</li>
										{:else}
											<!-- No live departure right now: render an honest "no live data" row
											     (no prediction) rather than dropping the whole Live column. -->
											<li class="map-live-empty">
												<AbsentValue reason="no-prediction" {locale} />
											</li>
										{/each}
									</ul>
								</div>
							</div>
						</article>
					{/each}
				</section>
			{/if}
		{/if}

		<section class="map-alerts" aria-label={t.alerts}>
			<h3>{t.alerts}</h3>
			{#if detail.alerts.length > 0}
				<ul>
					{#each detail.alerts.slice(0, compact ? 2 : 4) as alert (alert.id)}
						{@const cause = causeLabel(alert.cause, locale)}
						{@const effect = effectLabel(alert.effect, locale)}
						<li data-severity={alert.severity}>
							<button
								type="button"
								class="map-alert-button"
								aria-label={t.selectAlert(displayAlert(alert))}
								onclick={() => onalertselect?.(alert)}
							>
								{displayAlert(alert)}
								<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
							</button>
							{#if cause || effect}
								<dl class="map-alert-meta">
									{#if cause}
										<div>
											<dt>{t.cause}</dt>
											<dd>{cause}</dd>
										</div>
									{/if}
									{#if effect}
										<div>
											<dt>{t.effect}</dt>
											<dd>{effect}</dd>
										</div>
									{/if}
								</dl>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p>{t.noAlerts}</p>
			{/if}
		</section>
	</article>
{/if}

<style>
	.map-selection-detail {
		display: flex;
		flex-direction: column;
		gap: 1.15rem;
		font-family: var(--font-body);
		color: var(--foreground);
	}
	.map-selection-detail.compact {
		gap: 0.7rem;
		min-width: 14rem;
		max-width: 18rem;
	}

	/* ── Header ───────────────────────────────────────────────── */
	.map-selection-head {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding-bottom: 0.85rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.compact .map-selection-head {
		padding-bottom: 0.55rem;
	}
	.map-selection-kind {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	/* Leading signage tick — a short brand rule before the kicker. */
	.map-selection-kind::before {
		content: '';
		width: 1.35rem;
		height: 2px;
		border-radius: var(--radius-pill);
		background: var(--primary);
	}
	.map-selection-title {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-heading);
		font-weight: 600;
		line-height: 1.08;
		letter-spacing: -0.01em;
		text-wrap: balance;
		color: var(--foreground);
	}
	.compact .map-selection-title {
		font-size: var(--text-subheading);
	}
	/* ── Identity + stat pills ────────────────────────────────── */
	.map-selection-id,
	.map-stop-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		align-items: center;
	}
	.map-selection-id span,
	.map-stop-stats span {
		display: inline-flex;
		min-height: 1.85rem;
		align-items: center;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		background: var(--muted);
		padding: 0.25rem 0.7rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		letter-spacing: 0.01em;
		color: var(--muted-foreground);
	}
	.map-selection-id span {
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		background: transparent;
		border-color: transparent;
		padding-inline: 0;
		color: var(--muted-foreground);
	}
	.map-selection-id strong,
	.map-id-action {
		display: inline-flex;
		min-height: 1.85rem;
		align-items: center;
		border: 1px solid var(--border-brand);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		padding: 0.25rem 0.7rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--foreground);
	}
	.map-id-action {
		gap: 0.35rem;
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out);
	}
	.map-id-action strong {
		display: inline;
		min-height: auto;
		border: 0;
		background: transparent;
		padding: 0;
	}
	.map-id-action :global(svg) {
		opacity: 0.55;
		transition: transform var(--duration-fast) var(--ease-out);
	}
	.map-id-action:hover {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 18%, transparent);
		border-color: var(--border-brand-active);
	}
	.map-id-action:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	/* ── Not-reporting note — calm, honest per-bus stale-GPS caution ──── */
	.map-not-reporting {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0;
		padding: 0.4rem 0.6rem 0.4rem 0.75rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		background: var(--muted);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		overflow: hidden;
	}
	.map-not-reporting :global(svg) {
		flex: none;
		opacity: 0.75;
	}
	/* Leading signage rail — calm + honest, not alarmist. */
	.map-not-reporting::before {
		content: '';
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: 3px;
		background: var(--muted-foreground);
		opacity: 0.5;
	}

	/* ── Attribute grid (status / crowding / delay …) ─────────── */
	.map-detail-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
		margin: 0;
	}
	.map-detail-grid div {
		display: grid;
		grid-template-columns: 5.75rem minmax(0, 1fr);
		gap: 0.6rem;
		align-items: center;
		min-height: 2.4rem;
		border-bottom: 1px solid var(--border-subtle);
		padding-block: 0.5rem;
	}
	.map-detail-grid div:last-child {
		border-bottom: 0;
	}
	.map-detail-grid dt {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.map-detail-grid dd {
		min-width: 0;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-small);
		color: var(--foreground);
	}
	.map-inline-action {
		display: inline-flex;
		gap: 0.3rem;
		max-width: 100%;
		align-items: center;
		justify-content: flex-start;
		min-height: 1.7rem;
		padding: 0.2rem 0.55rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--foreground);
		text-align: left;
		background: color-mix(in srgb, var(--primary) 9%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 28%, var(--border) 72%);
		border-radius: var(--radius-pill);
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition:
			color var(--duration-fast) var(--ease-out),
			background-color var(--duration-fast) var(--ease-out),
			border-color var(--duration-fast) var(--ease-out);
	}
	/* The name shrinks + truncates inside the pill so a long stop name (e.g.
	   "Next station") never pushes the chevron out or overflows a narrow rail. */
	.map-inline-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.map-inline-action :global(svg) {
		flex: none;
		opacity: 0.5;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.map-inline-action:hover {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		border-color: var(--border-brand);
	}
	.map-inline-action:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}

	/* ── Delay tone tag — colour-codes early / on-time / late ─── */
	.map-delay-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-mono);
		font-size: inherit;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--muted-foreground);
		white-space: nowrap;
	}
	.map-delay-tag::before {
		content: '';
		width: 0.45rem;
		height: 0.45rem;
		border-radius: var(--radius-pill);
		background: currentcolor;
		flex: none;
	}
	.map-delay-tag[data-tone='none'] {
		color: var(--muted-foreground);
	}
	.map-delay-tag[data-tone='none']::before {
		display: none;
	}
	.map-delay-tag[data-tone='early'] {
		color: var(--dataviz-status-early);
	}
	.map-delay-tag[data-tone='on-time'] {
		color: var(--dataviz-status-on-time);
	}
	.map-delay-tag[data-tone='late'] {
		color: var(--dataviz-status-late);
	}
	.map-delay-tag[data-tone='severe'] {
		color: var(--dataviz-status-severe);
	}
	.map-status-label {
		color: var(--muted-foreground);
	}
	.map-inline-action:focus-visible,
	.map-id-action:focus-visible,
	.map-stop-action:focus-visible,
	.map-vehicle-action:focus-visible,
	.map-alert-button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	/* ── Departures list ──────────────────────────────────────── */
	.map-departures {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.map-departures li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		position: relative;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		background: var(--muted);
		padding: 0.5rem 0.65rem 0.5rem 0.85rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		overflow: hidden;
	}
	/* Left signage rail accent on each departure row. */
	.map-departures li::before {
		content: '';
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: 3px;
		background: var(--primary);
		opacity: 0.55;
	}

	/* ── Section scaffolding (shared) ─────────────────────────── */
	.map-stop-sequence,
	.map-route-times,
	.map-live-buses {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.map-stop-sequence h3,
	.map-route-times h3,
	.map-live-buses h3 {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.map-stop-sequence h3::after,
	.map-route-times h3::after,
	.map-live-buses h3::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border-subtle);
	}
	.map-stop-sequence ol,
	.map-route-times ul,
	.map-live-buses ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.map-direction-block {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.map-direction-block + .map-direction-block {
		margin-top: 0.55rem;
	}
	.map-direction-block h4,
	.map-route-time h4 {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.map-direction-block h4 {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding-bottom: 0.3rem;
		color: var(--accent-text);
	}
	.map-direction-block h4 small {
		text-transform: none;
		letter-spacing: 0;
		color: var(--muted-foreground);
	}
	/* The direction name + its inline inferred marker share a baseline row; the
	   marker reads back its normal-case absence copy, not the uppercase eyebrow. */
	.map-direction-name {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
		text-transform: none;
		letter-spacing: 0;
	}
	/* The no-live-data row in the Live arrivals column reads as a quiet absence,
	   not an arrival; it carries no time, just the honest "no prediction" value. */
	.map-live-empty {
		color: var(--muted-foreground);
	}

	/* ── Stop sequence rows ───────────────────────────────────── */
	.map-stop-action {
		display: grid;
		grid-template-columns: 1.9rem minmax(0, 1fr) auto;
		gap: 0.65rem;
		width: calc(100% + 1.1rem);
		margin-inline: -0.55rem;
		align-items: center;
		padding: 0.5rem 0.55rem;
		border-radius: var(--radius-sm);
		color: var(--foreground);
		text-align: left;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--border-subtle);
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--ease-out);
	}
	.map-stop-action span {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-align: center;
		color: var(--muted-foreground);
	}
	.map-stop-action strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-small);
		font-weight: 500;
		transition: color var(--duration-fast) var(--ease-out);
	}
	.map-stop-action :global(svg) {
		opacity: 0.45;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.map-stop-action small {
		grid-column: 2;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		margin-top: 0.1rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
	.map-stop-action small time {
		font-weight: 600;
		color: var(--foreground);
	}
	.map-stop-action:hover {
		background: color-mix(in srgb, var(--primary) 7%, transparent);
	}
	.map-stop-action:hover strong {
		color: var(--primary);
	}
	.map-stop-action:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}

	/* ── Live-bus rows ────────────────────────────────────────── */
	.map-vehicle-action {
		display: grid;
		grid-template-columns: minmax(3.5rem, auto) minmax(0, 1fr) auto auto;
		gap: 0.6rem;
		width: calc(100% + 1.1rem);
		margin-inline: -0.55rem;
		align-items: center;
		padding: 0.5rem 0.55rem;
		border-radius: var(--radius-sm);
		color: var(--foreground);
		text-align: left;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--border-subtle);
		cursor: pointer;
		transition: background-color var(--duration-fast) var(--ease-out);
	}
	.map-vehicle-action strong {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		color: var(--primary);
	}
	.map-vehicle-action > span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-small);
		transition: color var(--duration-fast) var(--ease-out);
	}
	.map-vehicle-action small {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
	.map-vehicle-action :global(svg) {
		opacity: 0.45;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.map-vehicle-action:hover {
		background: color-mix(in srgb, var(--primary) 7%, transparent);
	}
	.map-vehicle-action:hover > span {
		color: var(--primary);
	}
	.map-vehicle-action:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	/* ── Route-time card (stop detail) ────────────────────────── */
	.map-route-times {
		gap: 0.6rem;
	}
	.map-route-time {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 0.75rem;
		background: var(--card);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
	}
	.map-route-time header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding-bottom: 0.55rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.map-route-time header span {
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	.map-time-columns {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}
	.map-time-columns h4 {
		margin-bottom: 0.2rem;
	}
	.map-time-columns li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.18rem 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--foreground);
	}
	.map-time-columns li time {
		font-weight: 600;
	}
	/* ── Alerts — severity-coded signage rail ─────────────────── */
	.map-alerts {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.map-alerts h3 {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.map-alerts h3::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border-subtle);
	}
	.map-alerts ul {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.map-alerts li {
		--alert-tone: var(--dataviz-severity-high);
		position: relative;
		margin: 0;
		border: 1px solid color-mix(in srgb, var(--alert-tone) 32%, var(--border) 68%);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--alert-tone) 9%, var(--card));
		padding: 0.5rem 0.6rem 0.5rem 0.85rem;
		font-size: var(--text-small);
		color: var(--foreground);
		overflow: hidden;
	}
	/* Severity rail down the leading edge. */
	.map-alerts li::before {
		content: '';
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: 3px;
		background: var(--alert-tone);
	}
	.map-alerts li[data-severity='critical'] {
		--alert-tone: var(--dataviz-severity-critical);
	}
	.map-alerts li[data-severity='high'] {
		--alert-tone: var(--dataviz-severity-high);
	}
	.map-alerts li[data-severity='watch'] {
		--alert-tone: var(--dataviz-severity-watch);
	}
	.map-alert-button {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0;
		color: inherit;
		font: inherit;
		line-height: 1.35;
		text-align: left;
		background: transparent;
		border: 0;
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-out);
	}
	.map-alert-button :global(svg) {
		flex: none;
		opacity: 0.55;
		transition:
			opacity var(--duration-fast) var(--ease-out),
			transform var(--duration-fast) var(--ease-out);
	}
	.map-alert-button:hover {
		color: var(--primary);
	}
	.map-alert-button:hover :global(svg) {
		opacity: 1;
		transform: translateX(2px);
	}
	/* Cause / effect metadata — a labeled mono caption line under the headline.
	   Each entry is a small uppercase caption + value pill, tinted by the alert's
	   own severity tone so it reads as part of the same signage block. */
	.map-alert-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.6rem;
		margin: 0.5rem 0 0;
	}
	.map-alert-meta div {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		min-width: 0;
	}
	.map-alert-meta dt {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: color-mix(in srgb, var(--alert-tone) 70%, var(--muted-foreground));
	}
	.map-alert-meta dd {
		margin: 0;
		min-width: 0;
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--foreground);
	}
	/* Empty state — quiet, distinct from an active alert. */
	.map-alerts p {
		margin: 0;
		border: 1px dashed var(--border-subtle);
		border-radius: var(--radius-md);
		background: var(--muted);
		padding: 0.55rem 0.7rem;
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	@media (max-width: 42rem) {
		.map-detail-grid div {
			grid-template-columns: minmax(0, 1fr);
			align-items: start;
			min-height: 0;
			gap: 0.25rem;
		}
		.map-detail-grid dd {
			white-space: normal;
		}
		.map-inline-action {
			align-items: flex-start;
			white-space: normal;
		}
		/* On phones the pill wraps instead of truncating, so the full name reads. */
		.map-inline-label {
			overflow: visible;
			text-overflow: clip;
			white-space: normal;
		}
		.map-stop-action {
			align-items: start;
		}
		.map-stop-action span {
			padding-top: 0.1rem;
		}
		.map-stop-action strong {
			white-space: normal;
		}
		.map-time-columns {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.4rem;
		}
	}
	/* Graceful shrink inside the resizable right-panel dock. The viewport media
	   query above misses the case the user hits most: dragging the dock narrower
	   while the viewport stays wide. These container queries reflow against the
	   PANEL'S OWN width (the `right-panel` container the dock declares), so the
	   detail degrades — stacks, truncates, drops the least-essential text —
	   instead of clipping or overflowing as the handle is dragged in. */
	@container right-panel (max-width: 21rem) {
		.map-detail-grid div {
			grid-template-columns: minmax(0, 1fr);
			align-items: start;
			min-height: 0;
			gap: 0.25rem;
		}
		.map-detail-grid dd {
			white-space: normal;
		}
		.map-inline-action {
			align-items: flex-start;
			white-space: normal;
		}
		.map-inline-label {
			overflow: visible;
			text-overflow: clip;
			white-space: normal;
		}
		.map-stop-action {
			align-items: start;
		}
		.map-stop-action strong {
			white-space: normal;
		}
		/* The verbose status word drops; the coloured delay tag still carries the
		   state, so the live-bus row stays legible at a narrow width. */
		.map-vehicle-action .map-status-label {
			display: none;
		}
		.map-time-columns {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.4rem;
		}
	}
	/* E4 — cuter, compact arrivals when the dock is dragged NARROW. The Past/Next/
	   Live three-up is unreadable in a thin rail, so below ~17rem of the PANEL'S OWN
	   width (the `right-panel` container the dock declares) we collapse to a single
	   tidy compact list: the Past column drops (the least-essential — riders watch
	   what's COMING), and the Next + Live columns stack as a clean list, each row
	   still carrying its coloured delay tag so the honest state survives. The honest
	   empty states (the "No data" <li> and the no-live-departures stand-down) are
	   untouched. The query targets DESCENDANTS of .right-panel (the parent declares
	   the container) — never a self-target. */
	@container right-panel (max-width: 17rem) {
		.map-time-columns {
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}
		/* Drop the least-essential Past-times column; Next + Live carry the reading. */
		.map-time-col--past {
			display: none;
		}
		/* Compact each remaining column into a quiet stacked list with a tight gap. */
		.map-time-col h4 {
			margin-bottom: 0.1rem;
		}
		.map-time-columns li {
			padding-block: 0.12rem;
		}
		/* The Live list reads as the cuter primary block: a touch more breathing room
		   between its dated rows so the delay tags do not crowd at the narrow width. */
		.map-live-list li {
			gap: 0.3rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.map-inline-action,
		.map-id-action,
		.map-stop-action,
		.map-vehicle-action,
		.map-alert-button,
		.map-inline-action :global(svg),
		.map-id-action :global(svg),
		.map-stop-action :global(svg),
		.map-vehicle-action :global(svg),
		.map-alert-button :global(svg) {
			transition: none;
		}
		.map-inline-action:hover :global(svg),
		.map-id-action:hover :global(svg),
		.map-stop-action:hover :global(svg),
		.map-vehicle-action:hover :global(svg),
		.map-alert-button:hover :global(svg) {
			transform: none;
		}
	}
</style>

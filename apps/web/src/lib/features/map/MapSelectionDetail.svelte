<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Locale } from '$lib/i18n';
	import type { Chip } from '$lib/filters';
	import type { Alert, OccupancyCode, StatusCode, StopDeparture, Vehicle } from '$lib/v1/schemas';
	import { formatUtc } from '$lib/utils/time';
	import { OCCUPANCY_LABELS, STATUS_LABELS } from './map.copy';
	import { alertDisplayText } from './mapAlerts';
	import type { MapSelection, MapSelectionDetail } from './mapSelection';

	interface Props {
		detail: MapSelectionDetail | null;
		locale: Locale;
		compact?: boolean;
		onselect?: (selection: MapSelection) => void;
		onfilter?: (chip: Chip) => void;
		onalertselect?: (alert: Alert) => void;
	}

	let { detail, locale, compact = false, onselect, onfilter, onalertselect }: Props = $props();

	const labels = {
		en: {
			bus: 'Bus',
			stop: 'Stop',
			route: 'Route',
			trip: 'Trip',
			status: 'Status',
			crowding: 'Crowding',
			delay: 'Delay',
			nextStop: 'Next stop',
			stopCode: 'Stop code',
			alerts: 'Alerts',
			noAlerts: 'No alerts attached',
			noData: 'No data',
			noTrip: 'No trip linked',
			noNextStop: 'No next stop',
			noDelay: 'No delay',
			early: (minutes: number) => `${Math.abs(minutes)} min early`,
			late: (minutes: number) => `${minutes} min late`,
			onTime: 'On time',
			departures: (count: number) => `${count} departure${count === 1 ? '' : 's'}`,
			vehiclesHeading: (count: number) => `${count} bus${count === 1 ? '' : 'es'} heading here`,
			visibleBuses: (count: number) => `${count} bus${count === 1 ? '' : 'es'} visible`,
			direction: 'Direction',
			routes: 'Routes',
			stops: 'Stops',
			pastStops: 'Past stops',
			nextStops: 'Next stops',
			pastTimes: 'Past times',
			nextTimes: 'Next times',
			live: 'Live',
			selectRoute: (route: string) => `Select route ${route}`,
			selectDepartureRoute: (route: string) => `Select departure route ${route}`,
			selectStop: (stop: string) => `Select stop ${stop}`,
			selectBus: (bus: string) => `Select bus ${bus}`,
			selectAlert: (alert: string) => `Select alert ${alert}`,
			filterStatus: (status: string) => `Filter status ${status}`,
			filterCrowding: (crowding: string) => `Filter crowding ${crowding}`,
			filterTrip: (trip: string) => `Filter trip ${trip}`,
			liveBuses: 'Live buses',
		},
		fr: {
			bus: 'Bus',
			stop: 'Arrêt',
			route: 'Ligne',
			trip: 'Trajet',
			status: 'Statut',
			crowding: 'Achalandage',
			delay: 'Retard',
			nextStop: 'Prochain arrêt',
			stopCode: "Code d'arrêt",
			alerts: 'Alertes',
			noAlerts: 'Aucune alerte liée',
			noData: 'Aucune donnée',
			noTrip: 'Aucun trajet lié',
			noNextStop: 'Aucun prochain arrêt',
			noDelay: 'Aucun retard',
			early: (minutes: number) => `${Math.abs(minutes)} min en avance`,
			late: (minutes: number) => `${minutes} min en retard`,
			onTime: "À l'heure",
			departures: (count: number) => `${count} départ${count === 1 ? '' : 's'}`,
			vehiclesHeading: (count: number) => `${count} bus vers cet arrêt`,
			visibleBuses: (count: number) => `${count} bus visible${count === 1 ? '' : 's'}`,
			direction: 'Direction',
			routes: 'Lignes',
			stops: 'Arrêts',
			pastStops: 'Arrêts passés',
			nextStops: 'Prochains arrêts',
			pastTimes: 'Passages passés',
			nextTimes: 'Prochains passages',
			live: 'Direct',
			selectRoute: (route: string) => `Sélectionner la ligne ${route}`,
			selectDepartureRoute: (route: string) => `Sélectionner le départ de la ligne ${route}`,
			selectStop: (stop: string) => `Sélectionner l’arrêt ${stop}`,
			selectBus: (bus: string) => `Sélectionner le bus ${bus}`,
			selectAlert: (alert: string) => `Sélectionner l’alerte ${alert}`,
			filterStatus: (status: string) => `Filtrer le statut ${status}`,
			filterCrowding: (crowding: string) => `Filtrer l’achalandage ${crowding}`,
			filterTrip: (trip: string) => `Filtrer le trajet ${trip}`,
			liveBuses: 'Bus en direct',
		},
	} as const;

	const t = $derived(labels[locale]);

	function delayLabel(delay: number | null | undefined): string {
		if (delay == null) return t.noDelay;
		if (delay < 0) return t.early(delay);
		if (delay > 0) return t.late(delay);
		return t.onTime;
	}

	// Presentation-only tone for a delay reading — maps a delay value to a
	// dataviz status band so on-time / early / late punch in colour. No data
	// wiring change: derived purely from the same value delayLabel() formats.
	function delayTone(delay: number | null | undefined): string {
		if (delay == null) return 'none';
		if (delay < 0) return 'early';
		if (delay >= 5) return 'severe';
		if (delay > 0) return 'late';
		return 'on-time';
	}

	function timeLabel(iso: string | null | undefined): string {
		return iso ? formatUtc(iso, locale, { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
	}

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

	function vehicleForDeparture(
		vehicles: readonly Vehicle[],
		departure: StopDeparture,
	): Vehicle | null {
		return departure.trip
			? (vehicles.find((vehicle) => vehicle.trip === departure.trip) ?? null)
			: null;
	}

	function displayAlert(alert: Alert): string {
		return alertDisplayText(alert, locale);
	}

	function directionLabel(item: Extract<MapSelectionDetail, { kind: 'route' }>): string {
		if (item.directions.length === 1) return item.directions[0]?.label ?? t.noData;
		return item.directions.length > 0
			? item.directions.map((direction) => direction.label).join(' / ')
			: t.noData;
	}
</script>

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
						<span class="map-delay-tag" data-tone={delayTone(detail.vehicle.delay_min)}>
							{delayLabel(detail.vehicle.delay_min)}
						</span>
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
							{detail.vehicle.next_stop ?? t.noNextStop}
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
										aria-label={t.selectStop(stop.name)}
										onclick={() => selectStop(stop.id)}
									>
										<span>{stop.seq ?? ''}</span>
										<strong>{stop.name}</strong>
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
										aria-label={t.selectStop(stop.name)}
										onclick={() => selectStop(stop.id)}
									>
										<span>{stop.seq ?? ''}</span>
										<strong>{stop.name}</strong>
										<ChevronRightIcon size={13} strokeWidth={2.4} aria-hidden="true" />
										{#if stop.etaUtc}
											<small>
												<time>{timeLabel(stop.etaUtc)}</time>
												<span class="map-delay-tag" data-tone={delayTone(stop.delayMin)}>
													{delayLabel(stop.delayMin)}
												</span>
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
					<dd>{detail.route.long ?? detail.id}</dd>
				</div>
				<div>
					<dt>{t.direction}</dt>
					<dd>{directionLabel(detail)}</dd>
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
										<span class="map-delay-tag" data-tone={delayTone(vehicle.delay_min)}>
											{delayLabel(vehicle.delay_min)}
										</span>
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
								<span>{direction.label}</span>
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
											aria-label={t.selectStop(stop.name)}
											onclick={() => selectStop(stop.id)}
										>
											<span>{stop.seq ?? ''}</span>
											<strong>{stop.name}</strong>
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
										<span class="map-delay-tag" data-tone={delayTone(vehicle.delay_min)}>
											{delayLabel(vehicle.delay_min)}
										</span>
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
							<span class="map-delay-tag" data-tone={delayTone(departure.delay_min)}>
								{delayLabel(departure.delay_min)}
							</span>
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
							<div class="map-time-columns">
								<div>
									<h4>{t.pastTimes}</h4>
									<ul>
										{#each route.pastTimes.slice(-4) as time (`past-${route.route}-${time}`)}
											<li>{time}</li>
										{:else}
											<li>{t.noData}</li>
										{/each}
									</ul>
								</div>
								<div>
									<h4>{t.nextTimes}</h4>
									<ul>
										{#each route.futureTimes.slice(0, 4) as time (`future-${route.route}-${time}`)}
											<li>{time}</li>
										{:else}
											<li>{t.noData}</li>
										{/each}
									</ul>
								</div>
								{#if route.liveDepartures.length > 0}
									<div>
										<h4>{t.live}</h4>
										<ul>
											{#each route.liveDepartures.slice(0, 3) as departure (`live-${route.route}-${departure.trip ?? departure.eta_utc}`)}
												<li>
													<time>{timeLabel(departure.eta_utc)}</time>
													<span class="map-delay-tag" data-tone={delayTone(departure.delay_min)}>
														{delayLabel(departure.delay_min)}
													</span>
												</li>
											{/each}
										</ul>
									</div>
								{/if}
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
		letter-spacing: 0.18em;
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
		letter-spacing: 0.1em;
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
		letter-spacing: 0.08em;
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
		letter-spacing: 0.14em;
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
		letter-spacing: 0.08em;
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
		letter-spacing: 0.14em;
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

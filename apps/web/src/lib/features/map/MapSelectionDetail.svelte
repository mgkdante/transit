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
					<dd>{delayLabel(detail.vehicle.delay_min)}</dd>
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
								{nextStop.name}
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
											<small>{timeLabel(stop.etaUtc)} · {delayLabel(stop.delayMin)}</small>
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
									<small
										>{STATUS_LABELS[locale][vehicle.status]} · {delayLabel(
											vehicle.delay_min,
										)}</small
									>
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
									<small
										>{STATUS_LABELS[locale][vehicle.status]} · {delayLabel(
											vehicle.delay_min,
										)}</small
									>
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
							<span>{delayLabel(departure.delay_min)}</span>
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
												<li>{timeLabel(departure.eta_utc)} · {delayLabel(departure.delay_min)}</li>
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
		gap: 0.9rem;
		font-family: var(--font-sans);
		color: var(--foreground);
	}
	.map-selection-detail.compact {
		gap: 0.65rem;
		min-width: 14rem;
		max-width: 18rem;
	}
	.map-selection-head {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.map-selection-kind {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.map-selection-title {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-subheading);
		line-height: 1.05;
		color: var(--foreground);
	}
	.compact .map-selection-title {
		font-size: var(--text-body);
	}
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
		min-height: 1.8rem;
		align-items: center;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		background: var(--muted);
		padding: 0.25rem 0.6rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	.map-selection-id strong,
	.map-id-action {
		display: inline-flex;
		min-height: 1.8rem;
		align-items: center;
		border: 1px solid color-mix(in srgb, var(--primary) 42%, var(--border) 58%);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		padding: 0.25rem 0.6rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--foreground);
	}
	.map-id-action {
		gap: 0.3rem;
		cursor: pointer;
		transition:
			color 150ms ease,
			background-color 150ms ease,
			border-color 150ms ease;
	}
	.map-id-action strong {
		display: inline;
		min-height: auto;
		border: 0;
		background: transparent;
		padding: 0;
	}
	.map-id-action:hover {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 18%, transparent);
		border-color: color-mix(in srgb, var(--primary) 52%, var(--border) 48%);
	}
	.map-detail-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.45rem;
		margin: 0;
	}
	.map-detail-grid div {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr);
		gap: 0.55rem;
		align-items: baseline;
		border-bottom: 1px solid var(--border-subtle);
		padding-bottom: 0.45rem;
	}
	.map-detail-grid dt {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
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
		min-height: 1.65rem;
		padding: 0.15rem 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--foreground);
		text-align: left;
		background: color-mix(in srgb, var(--primary) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 32%, var(--border) 68%);
		border-radius: var(--radius-pill);
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition:
			color 150ms ease,
			background-color 150ms ease,
			border-color 150ms ease;
	}
	.map-inline-action:hover {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		border-color: color-mix(in srgb, var(--primary) 48%, var(--border) 52%);
	}
	.map-inline-action:focus-visible,
	.map-id-action:focus-visible,
	.map-stop-action:focus-visible,
	.map-vehicle-action:focus-visible,
	.map-alert-button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.map-departures {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.map-departures li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		background: var(--muted);
		padding: 0.45rem 0.55rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}
	.map-stop-sequence,
	.map-route-times,
	.map-live-buses {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.map-stop-sequence h3,
	.map-route-times h3,
	.map-live-buses h3 {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		color: var(--accent-text);
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
		gap: 0.4rem;
	}
	.map-direction-block h4,
	.map-route-time h4 {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.map-direction-block h4 {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		color: var(--accent-text);
	}
	.map-direction-block h4 small {
		color: var(--muted-foreground);
	}
	.map-stop-action {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr) auto;
		gap: 0.55rem;
		width: 100%;
		align-items: baseline;
		padding: 0.42rem 0;
		color: var(--foreground);
		text-align: left;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--border-subtle);
		cursor: pointer;
	}
	.map-stop-action span {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	.map-stop-action strong {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-small);
		font-weight: 500;
	}
	.map-stop-action small {
		grid-column: 2;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
	.map-stop-action:hover strong {
		color: var(--primary);
	}
	.map-vehicle-action {
		display: grid;
		grid-template-columns: minmax(3.5rem, auto) minmax(0, 1fr) auto auto;
		gap: 0.55rem;
		width: 100%;
		align-items: baseline;
		padding: 0.42rem 0;
		color: var(--foreground);
		text-align: left;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--border-subtle);
		cursor: pointer;
	}
	.map-vehicle-action strong {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--primary);
	}
	.map-vehicle-action span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-small);
	}
	.map-vehicle-action small {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
	.map-vehicle-action:hover span {
		color: var(--primary);
	}
	.map-route-time {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.65rem;
		background: var(--muted);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
	}
	.map-route-time header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}
	.map-route-time header span {
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	.map-time-columns {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.6rem;
	}
	.map-time-columns li {
		padding: 0.15rem 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--foreground);
	}
	.map-alerts {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.map-alerts h3 {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.map-alerts ul {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.map-alerts li,
	.map-alerts p {
		margin: 0;
		border: 1px solid color-mix(in srgb, var(--dataviz-severity-high) 30%, var(--border) 70%);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--dataviz-severity-high) 10%, transparent);
		padding: 0.45rem 0.55rem;
		font-size: var(--text-small);
		color: var(--foreground);
	}
	.map-alert-button {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		background: transparent;
		border: 0;
		cursor: pointer;
	}
	.map-alert-button:hover {
		color: var(--primary);
	}
	.map-alerts p {
		border-color: var(--border-subtle);
		background: var(--muted);
		color: var(--muted-foreground);
	}
	@media (max-width: 42rem) {
		.map-detail-grid div {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.2rem;
		}
		.map-detail-grid dd {
			white-space: normal;
		}
		.map-inline-action {
			align-items: flex-start;
			white-space: normal;
		}
		.map-stop-action strong {
			white-space: normal;
		}
		.map-time-columns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.map-inline-action {
			transition: none;
		}
	}
</style>

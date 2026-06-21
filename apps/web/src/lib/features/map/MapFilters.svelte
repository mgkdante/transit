<!--
  MapFilters — the combinable state filter for the live map (slice-9.3).

  This IS the colour legend AND the filter: status + crowding chips, each a
  COLOUR swatch + label (no shape glyph — shape is the entity key's job, colour
  is state). Toggling a chip REPAINTS the matching buses in that state's colour
  and HIDES the rest; status × crowding combine (AND). All state lives in the
  URL via the shared filter store, so a filtered view is shareable +
  deep-linkable from anywhere (`/map?status=late`).

  DOCTRINE: chips show the dataviz state colour (status/occupancy scales);
  --primary stays interactive-only (the active-chip ring/affordance).
-->
<script lang="ts">
	import BusFrontIcon from '@lucide/svelte/icons/bus-front';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import MapPinnedIcon from '@lucide/svelte/icons/map-pinned';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpenIcon from '@lucide/svelte/icons/panel-left-open';
	import RouteIcon from '@lucide/svelte/icons/route';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import UsersRoundIcon from '@lucide/svelte/icons/users-round';
	import XIcon from '@lucide/svelte/icons/x';
	import type { AlertEntityKind, EntityKind, FilterStore } from '$lib/filters';
	import { STATUS_CODES, OCCUPANCY_CODES } from '$lib/v1/schemas';
	import type { RouteIndexEntry, StopIndexEntry } from '$lib/v1';
	import { statusVar, occupancyVar } from '$lib/components/dataviz';
	import type { Locale } from '$lib/i18n';
	import { copy as MAP_COPY, STATUS_LABELS, OCCUPANCY_LABELS } from './map.copy';
	import MarkerGlyph from './MarkerGlyph.svelte';

	interface Props {
		store: FilterStore;
		locale: Locale;
		routes?: readonly RouteIndexEntry[];
		stops?: readonly StopIndexEntry[];
		collapsible?: boolean;
		onselect?: () => void;
		class?: string;
	}
	let {
		store,
		locale,
		routes = [],
		stops = [],
		collapsible = true,
		onselect,
		class: className = '',
	}: Props = $props();
	let filterOpen = $state(true);
	const t = $derived(MAP_COPY[locale]);
	const panelOpen = $derived(!collapsible || filterOpen);
	const collator = $derived(new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }));
	const routeById = $derived(new Map(routes.map((route) => [route.id, route])));
	const stopById = $derived(new Map(stops.map((stop) => [stop.id, stop])));
	const selectedRouteIds = $derived(
		Array.from(store.routes).sort((a, b) => collator.compare(a, b)),
	);
	const selectedRoutes = $derived(
		selectedRouteIds.map((id) => routeById.get(id) ?? fallbackRoute(id)),
	);
	const selectedStopIds = $derived(Array.from(store.stops).sort((a, b) => collator.compare(a, b)));
	const selectedStops = $derived(selectedStopIds.map((id) => stopById.get(id) ?? fallbackStop(id)));
	const selectedVehicleIds = $derived(
		Array.from(store.vehicles).sort((a, b) => collator.compare(a, b)),
	);
	const selectedTripIds = $derived(Array.from(store.trips).sort((a, b) => collator.compare(a, b)));
	const entityOptions = $derived([
		{ kind: 'bus', label: t.entityBus },
		{ kind: 'stop', label: t.entityStop, stop: true },
	] satisfies {
		kind: EntityKind;
		label: string;
		stop?: boolean;
	}[]);
	const alertOptions = $derived([
		{ kind: 'has_alert', label: t.alertHas, aria: t.alertHasAria },
	] satisfies {
		kind: AlertEntityKind;
		label: string;
		aria: string;
	}[]);

	function clearFilters(): void {
		store.clear();
		onselect?.();
	}

	function fallbackRoute(id: string): RouteIndexEntry {
		return { id, short: id, type: 3 };
	}

	function routeDisplay(route: RouteIndexEntry): string {
		return route.long ? `${route.short} ${route.long}` : route.short;
	}

	function fallbackStop(id: string): StopIndexEntry {
		return { id, name: id, lat: 0, lon: 0, code: id };
	}

	function stopDisplay(stop: StopIndexEntry): string {
		if (stop.name === stop.id) return stop.code ?? stop.id;
		return stop.code ? `${stop.name} · ${stop.code}` : stop.name;
	}

	function removeRoute(route: RouteIndexEntry): void {
		store.removeRoute(route.id);
		onselect?.();
	}

	function removeStop(stop: StopIndexEntry): void {
		store.removeStop(stop.id);
		onselect?.();
	}

	function removeVehicle(id: string): void {
		store.removeVehicle(id);
		onselect?.();
	}

	function removeTrip(id: string): void {
		store.removeTrip(id);
		onselect?.();
	}

	function toggleStatus(code: (typeof STATUS_CODES)[number]): void {
		store.toggleStatus(code);
		onselect?.();
	}

	function toggleOccupancy(code: (typeof OCCUPANCY_CODES)[number]): void {
		store.toggleOccupancy(code);
		onselect?.();
	}

	function toggleEntity(kind: EntityKind): void {
		store.toggleEntity(kind);
		onselect?.();
	}

	function toggleAlert(kind: AlertEntityKind): void {
		store.toggleAlert(kind);
		onselect?.();
	}
</script>

<div
	class="map-filters {className}"
	data-open={panelOpen}
	data-collapsible={collapsible}
	role="group"
	aria-label={t.filterTitle}
>
	<div class="mf-controls">
		<div class="mf-head">
			{#if collapsible}
				<button
					type="button"
					class="mf-toggle"
					aria-expanded={filterOpen}
					aria-label={t.filterTitle}
					onclick={() => (filterOpen = !filterOpen)}
				>
					<span class="mf-toggle-icon" aria-hidden="true">
						{#if filterOpen}
							<PanelLeftCloseIcon size={15} strokeWidth={2.2} />
						{:else}
							<PanelLeftOpenIcon size={15} strokeWidth={2.2} />
						{/if}
					</span>
					{#if filterOpen}
						<span class="mf-title">{t.filterTitle}</span>
					{/if}
				</button>
			{:else}
				<span class="mf-title">{t.filterTitle}</span>
			{/if}
		</div>
		<div class="mf-clear-row">
			<button
				type="button"
				class="mf-chip mf-clear"
				data-active={!store.isEmpty}
				disabled={store.isEmpty}
				aria-label={t.filterClear}
				onclick={clearFilters}
			>
				<span class="mf-clear-icon" aria-hidden="true">
					<XIcon size={13} strokeWidth={2.35} />
				</span>
				{#if panelOpen}
					<span class="mf-chip-text mf-clear-text">{t.filterClear}</span>
				{/if}
			</button>
		</div>
	</div>

	<div class="mf-body" data-testid={!panelOpen && collapsible ? 'map-filter-rail' : undefined}>
		{#if selectedRoutes.length > 0}
			<div class="mf-group">
				<span class="mf-group-label" aria-label={t.modeRoutes}>
					<span class="mf-group-badge mf-group-badge-routes" data-icon="routes" aria-hidden="true">
						<RouteIcon size={13} strokeWidth={2.35} />
					</span>
					{#if panelOpen}
						<span class="mf-label-text">{t.modeRoutes}</span>
					{/if}
				</span>
				<div class="mf-chips">
					{#each selectedRoutes as route (route.id)}
						<button
							type="button"
							class="mf-chip mf-route-chip"
							data-on="true"
							aria-label="{t.routeRemove} {route.short}"
							aria-pressed="true"
							style="--chip:var(--accent-text)"
							onclick={() => removeRoute(route)}
						>
							<span class="mf-swatch"></span>
							{#if panelOpen}
								<span class="mf-chip-text">{routeDisplay(route)}</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if selectedStops.length > 0}
			<div class="mf-group">
				<span class="mf-group-label" aria-label={t.modeStops}>
					<span class="mf-group-badge mf-group-badge-stops" data-icon="stops" aria-hidden="true">
						<MapPinnedIcon size={13} strokeWidth={2.35} />
					</span>
					{#if panelOpen}
						<span class="mf-label-text">{t.modeStops}</span>
					{/if}
				</span>
				<div class="mf-chips">
					{#each selectedStops as stop (stop.id)}
						<button
							type="button"
							class="mf-chip mf-id-chip"
							data-on="true"
							aria-label="{t.stopRemove} {stop.code ?? stop.id}"
							aria-pressed="true"
							style="--chip:var(--accent)"
							onclick={() => removeStop(stop)}
						>
							<span class="mf-swatch"></span>
							{#if panelOpen}
								<span class="mf-chip-text">{stopDisplay(stop)}</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if selectedVehicleIds.length > 0}
			<div class="mf-group">
				<span class="mf-group-label" aria-label={t.modeVehicles}>
					<span class="mf-group-badge mf-group-badge-buses" data-icon="buses" aria-hidden="true">
						<BusFrontIcon size={13} strokeWidth={2.35} />
					</span>
					{#if panelOpen}
						<span class="mf-label-text">{t.modeVehicles}</span>
					{/if}
				</span>
				<div class="mf-chips">
					{#each selectedVehicleIds as vehicleId (vehicleId)}
						<button
							type="button"
							class="mf-chip mf-id-chip"
							data-on="true"
							aria-label="{t.vehicleRemove} {vehicleId}"
							aria-pressed="true"
							style="--chip:var(--primary)"
							onclick={() => removeVehicle(vehicleId)}
						>
							<span class="mf-swatch"></span>
							{#if panelOpen}
								<span class="mf-chip-text">{t.vehicleLabel} {vehicleId}</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		{#if selectedTripIds.length > 0}
			<div class="mf-group">
				<span class="mf-group-label" aria-label={t.modeTrips}>
					<span class="mf-group-badge mf-group-badge-trips" data-icon="trips" aria-hidden="true">
						<TicketIcon size={13} strokeWidth={2.35} />
					</span>
					{#if panelOpen}
						<span class="mf-label-text">{t.modeTrips}</span>
					{/if}
				</span>
				<div class="mf-chips">
					{#each selectedTripIds as tripId (tripId)}
						<button
							type="button"
							class="mf-chip mf-id-chip"
							data-on="true"
							aria-label="{t.tripRemove} {tripId}"
							aria-pressed="true"
							style="--chip:var(--primary)"
							onclick={() => removeTrip(tripId)}
						>
							<span class="mf-swatch"></span>
							{#if panelOpen}
								<span class="mf-chip-text">{t.tripLabel} {tripId}</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<div class="mf-group">
			<span class="mf-group-label" aria-label={t.modeStatus}>
				<span class="mf-group-badge mf-group-badge-status" data-icon="status" aria-hidden="true">
					<GaugeIcon size={13} strokeWidth={2.35} />
				</span>
				{#if panelOpen}
					<span class="mf-label-text">{t.modeStatus}</span>
				{/if}
			</span>
			<div class="mf-chips">
				{#each STATUS_CODES as code (code)}
					<button
						type="button"
						class="mf-chip"
						data-on={store.status.includes(code)}
						aria-label={STATUS_LABELS[locale][code]}
						aria-pressed={store.status.includes(code)}
						style="--chip:{statusVar(code)}"
						onclick={() => toggleStatus(code)}
					>
						<span class="mf-swatch"></span>
						{#if panelOpen}
							<span class="mf-chip-text">{STATUS_LABELS[locale][code]}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<div class="mf-group">
			<span class="mf-group-label" aria-label={t.modeOccupancy}>
				<span
					class="mf-group-badge mf-group-badge-crowding"
					data-icon="crowding"
					aria-hidden="true"
				>
					<UsersRoundIcon size={13} strokeWidth={2.35} />
				</span>
				{#if panelOpen}
					<span class="mf-label-text">{t.modeOccupancy}</span>
				{/if}
			</span>
			<div class="mf-chips">
				{#each OCCUPANCY_CODES as code (code)}
					<button
						type="button"
						class="mf-chip"
						data-on={store.occupancy.includes(code)}
						aria-label={OCCUPANCY_LABELS[locale][code]}
						aria-pressed={store.occupancy.includes(code)}
						style="--chip:{occupancyVar(code)}"
						onclick={() => toggleOccupancy(code)}
					>
						<span class="mf-swatch"></span>
						{#if panelOpen}
							<span class="mf-chip-text">{OCCUPANCY_LABELS[locale][code]}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<div class="mf-group">
			<span class="mf-group-label" aria-label={t.legendTitle}>
				<span class="mf-group-badge mf-group-badge-shapes" data-icon="shapes" aria-hidden="true">
					<MapPinnedIcon size={13} strokeWidth={2.35} />
				</span>
				{#if panelOpen}
					<span class="mf-label-text">{t.legendTitle}</span>
				{/if}
			</span>
			<div class="mf-chips">
				{#each entityOptions as item (item.kind)}
					<button
						type="button"
						class="mf-chip mf-shape-chip"
						data-on={store.entities.includes(item.kind)}
						aria-label={item.label}
						aria-pressed={store.entities.includes(item.kind)}
						onclick={() => toggleEntity(item.kind)}
					>
						<span class:mf-shape-stop={item.stop} class="mf-glyph">
							<MarkerGlyph kind={item.kind} />
						</span>
						{#if panelOpen}
							<span class="mf-chip-text">{item.label}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<div class="mf-group">
			<span class="mf-group-label" aria-label={t.modeAlerts}>
				<span class="mf-group-badge mf-group-badge-alerts" data-icon="alerts" aria-hidden="true">
					<TriangleAlertIcon size={13} strokeWidth={2.35} />
				</span>
				{#if panelOpen}
					<span class="mf-label-text">{t.modeAlerts}</span>
				{/if}
			</span>
			<div class="mf-chips">
				{#each alertOptions as item (item.kind)}
					<button
						type="button"
						class="mf-chip mf-alert-chip"
						data-on={store.alerts.includes(item.kind)}
						aria-label={item.aria}
						aria-pressed={store.alerts.includes(item.kind)}
						style="--chip:var(--dataviz-severity-high)"
						onclick={() => toggleAlert(item.kind)}
					>
						<span class="mf-swatch"></span>
						{#if panelOpen}
							<span class="mf-chip-text">{item.label}</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	.map-filters {
		--mf-control-size: 2rem;
		--mf-header-control-size: 2rem;
		--mf-badge-size: 1.4rem;
		--mf-badge-icon-size: 0.82rem;
		--mf-swatch-size: 0.7rem;
		/* The structural hairline tint: a brand-warmed border that reads on both
		   the dark board and the cool-slate paper. */
		--mf-edge: color-mix(in srgb, var(--border) 82%, var(--primary) 18%);

		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		width: 16rem;
		max-width: calc(100vw - 2rem);
		max-height: min(72dvh, calc(100dvh - 7rem));
		padding: 0.55rem 0.7rem 0.7rem;
		background: color-mix(in srgb, var(--card) 90%, transparent);
		border: 1px solid var(--mf-edge);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(10px) saturate(1.1);
		overflow: hidden;
		transition:
			width var(--duration-slow) var(--ease-out),
			background-color var(--duration-slow) var(--ease-out),
			border-color var(--duration-slow) var(--ease-out);
	}
	.map-filters[data-open='false'] {
		width: 4.95rem;
	}
	.mf-controls {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
		padding-bottom: 0.6rem;
		border-bottom: 1px solid color-mix(in srgb, var(--mf-edge) 70%, transparent);
	}
	.mf-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.55rem;
		min-width: 0;
	}
	.mf-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		min-height: 2rem;
		padding: 0.25rem 0.3rem;
		margin: -0.25rem -0.3rem;
		color: var(--muted-foreground);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		overflow: hidden;
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default);
	}
	.mf-toggle-icon {
		display: inline-grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		flex: none;
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent);
		border-radius: var(--radius-sm);
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.mf-toggle:hover {
		color: var(--foreground);
	}
	.mf-toggle:hover .mf-toggle-icon {
		color: var(--primary-hover);
		background: color-mix(in srgb, var(--primary) 18%, transparent);
		border-color: color-mix(in srgb, var(--primary) 45%, transparent);
	}
	.mf-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.mf-title {
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mf-clear-row {
		display: flex;
		min-width: 0;
	}
	.mf-body {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		padding-right: 0.5rem;
		scrollbar-gutter: stable;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--primary) 40%, var(--border) 60%) transparent;
	}
	.mf-body::-webkit-scrollbar {
		width: 0.4rem;
	}
	.mf-body::-webkit-scrollbar-track {
		background: transparent;
	}
	.mf-body::-webkit-scrollbar-thumb {
		background: color-mix(in srgb, var(--primary) 32%, var(--border) 68%);
		border-radius: var(--radius-pill);
	}
	.mf-body::-webkit-scrollbar-thumb:hover {
		background: color-mix(in srgb, var(--primary) 48%, var(--border) 52%);
	}
	.mf-group {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
	}
	.mf-group-label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
		min-width: 0;
		overflow: hidden;
	}
	.mf-label-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.map-filters[data-open='true'] .mf-group-label {
		position: relative;
	}
	/* Hairline rule trailing the overline label fills the row — gives each
	   section a confident, edge-to-edge demarcation without a heavy divider. */
	.map-filters[data-open='true'] .mf-group-label::after {
		content: '';
		flex: 1;
		height: 1px;
		min-width: 0.5rem;
		background: linear-gradient(
			to right,
			color-mix(in srgb, var(--mf-edge) 80%, transparent),
			transparent
		);
	}
	.mf-group-badge {
		display: inline-grid;
		place-items: center;
		width: var(--mf-badge-size);
		height: var(--mf-badge-size);
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1;
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 32%, transparent);
		border-radius: var(--radius-sm);
	}
	.mf-group-badge :global(svg) {
		width: var(--mf-badge-icon-size);
		height: var(--mf-badge-icon-size);
	}
	.mf-group-badge-status {
		color: var(--dataviz-status-late);
		background: color-mix(in srgb, var(--dataviz-status-late) 15%, transparent);
		border-color: color-mix(in srgb, var(--dataviz-status-late) 32%, transparent);
	}
	.mf-group-badge-crowding {
		color: var(--dataviz-occupancy-standing);
		background: color-mix(in srgb, var(--dataviz-occupancy-standing) 16%, transparent);
		border-color: color-mix(in srgb, var(--dataviz-occupancy-standing) 32%, transparent);
	}
	.mf-group-badge-shapes {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		border-color: color-mix(in srgb, var(--primary) 32%, transparent);
	}
	.mf-group-badge-alerts {
		color: var(--dataviz-severity-high);
		background: color-mix(in srgb, var(--dataviz-severity-high) 14%, transparent);
		border-color: color-mix(in srgb, var(--dataviz-severity-high) 32%, transparent);
	}
	.mf-group-badge-routes {
		color: var(--accent-text);
		background: color-mix(in srgb, var(--accent-text) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent-text) 32%, transparent);
	}
	.mf-group-badge-stops {
		color: var(--map-stop-fill);
		background: color-mix(in srgb, var(--map-stop-fill) 14%, transparent);
		border-color: color-mix(in srgb, var(--map-stop-fill) 32%, transparent);
	}
	.mf-group-badge-buses,
	.mf-group-badge-trips {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		border-color: color-mix(in srgb, var(--primary) 32%, transparent);
	}
	.mf-chips {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.3rem;
		min-width: 0;
	}
	.mf-chip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: flex-start;
		width: 100%;
		min-height: var(--mf-control-size);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		letter-spacing: 0.01em;
		padding: 0.3rem 0.7rem 0.3rem 0.5rem;
		text-align: left;
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--muted) 70%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		cursor: pointer;
		overflow: hidden;
		transition:
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}
	.map-filters[data-open='false'] .mf-chip {
		justify-content: center;
		gap: 0;
		width: var(--mf-control-size);
		height: var(--mf-control-size);
		min-height: var(--mf-control-size);
		margin-inline: auto;
		padding: 0;
	}
	.mf-chip-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mf-clear {
		--chip: var(--primary);
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 9%, var(--muted) 91%);
		border-color: color-mix(in srgb, var(--primary) 30%, var(--border) 70%);
	}
	.mf-clear[data-active='false'] {
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--muted) 70%, transparent);
		border-color: var(--border-subtle);
		cursor: not-allowed;
		opacity: 0.5;
	}
	.mf-clear-icon {
		display: inline-grid;
		place-items: center;
		width: var(--mf-swatch-size);
		height: var(--mf-swatch-size);
		flex: none;
	}
	.mf-clear-icon :global(svg) {
		width: var(--mf-swatch-size);
		height: var(--mf-swatch-size);
	}
	.mf-chip:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--chip, var(--primary)) 12%, var(--muted) 88%);
		border-color: color-mix(in srgb, var(--chip, var(--primary)) 48%, var(--border) 52%);
	}
	.mf-chip:hover .mf-swatch {
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--chip) 65%, transparent);
	}
	.mf-clear:disabled:hover {
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--muted) 70%, transparent);
		border-color: var(--border-subtle);
	}
	.mf-clear:disabled:hover .mf-clear-icon {
		box-shadow: none;
	}
	.mf-chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.mf-chip:active {
		transform: translateY(0.5px);
	}
	/* Active: the chip adopts its state colour — tinted fill, full-strength
	   border, and a soft tonal ring so the "on" state reads at a glance. */
	.mf-chip[data-on='true'] {
		color: var(--foreground);
		font-weight: 600;
		background: color-mix(in srgb, var(--chip) 20%, var(--card));
		border-color: var(--chip);
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--chip) 35%, transparent),
			0 0 0 1px color-mix(in srgb, var(--chip) 28%, transparent);
	}
	.mf-chip[data-on='true']:hover {
		background: color-mix(in srgb, var(--chip) 26%, var(--card));
	}
	.mf-chip[data-on='true'] .mf-swatch {
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--chip) 70%, transparent),
			0 0 6px color-mix(in srgb, var(--chip) 45%, transparent);
	}
	/* Colour swatch only — the chip's state is its hue, never a shape. */
	.mf-swatch {
		width: var(--mf-swatch-size);
		height: var(--mf-swatch-size);
		border-radius: 50%;
		background: var(--chip);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--chip) 50%, transparent);
		flex: none;
		transition: box-shadow var(--duration-fast) var(--ease-default);
	}
	.mf-glyph {
		display: inline-grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		padding: 0.16rem;
		flex: none;
		color: var(--primary);
		/* Knocked-out parts (windshield / headlights / pin hole) read as cut-outs
		   against the panel surface, mirroring the sprite's halo cut. */
		--marker-glyph-cut: var(--card);
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 36%, transparent);
		border-radius: var(--radius-sm);
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.mf-shape-stop {
		color: var(--map-stop-fill);
		background: color-mix(in srgb, var(--map-stop-fill) 16%, transparent);
		border-color: color-mix(in srgb, var(--map-stop-fill) 36%, transparent);
	}
	.mf-shape-chip:hover .mf-glyph {
		background: color-mix(in srgb, var(--primary) 22%, transparent);
		border-color: color-mix(in srgb, var(--primary) 48%, transparent);
	}
	.mf-shape-chip:hover .mf-shape-stop {
		background: color-mix(in srgb, var(--map-stop-fill) 22%, transparent);
		border-color: color-mix(in srgb, var(--map-stop-fill) 48%, transparent);
	}
	.mf-shape-chip[data-on='true'] {
		color: var(--foreground);
		font-weight: 600;
		background: color-mix(in srgb, var(--primary) 16%, var(--card));
		border-color: color-mix(in srgb, var(--primary) 58%, transparent);
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--primary) 30%, transparent),
			0 0 0 1px color-mix(in srgb, var(--primary) 24%, transparent);
	}
	/* Active keeps the pictogram in its entity hue (bus orange / stop fill) — the
	   map shows the bus orange in every state, so the legend stays faithful; the
	   "on" signal is the brighter glyph box + the chip's own border/ring. */
	.mf-shape-chip[data-on='true'] .mf-glyph {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 26%, transparent);
		border-color: color-mix(in srgb, var(--primary) 55%, transparent);
	}
	.mf-shape-chip[data-on='true'] .mf-shape-stop {
		color: var(--map-stop-fill);
		background: color-mix(in srgb, var(--map-stop-fill) 26%, transparent);
		border-color: color-mix(in srgb, var(--map-stop-fill) 55%, transparent);
	}
	.mf-alert-chip {
		--chip: var(--dataviz-severity-high);
	}
	@media (prefers-reduced-motion: reduce) {
		.map-filters,
		.mf-toggle,
		.mf-toggle-icon,
		.mf-chip,
		.mf-swatch,
		.mf-glyph {
			transition: none;
		}
		.mf-chip:active {
			transform: none;
		}
	}
</style>

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
	import { tick } from 'svelte';
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
	let filterBodyEl = $state<HTMLElement | null>(null);
	let bodyScrollable = $state(false);
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
		{ kind: 'bus_direction', glyph: '▲', label: t.entityBusDirection },
		{ kind: 'bus_no_direction', glyph: '■', label: t.entityBusNoDirection },
		{ kind: 'stop', glyph: '◆', label: t.entityStop, stop: true },
	] satisfies {
		kind: EntityKind;
		glyph: string;
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

	function updateBodyScrollable(): void {
		const node = filterBodyEl;
		bodyScrollable = node ? node.scrollHeight > node.clientHeight + 1 : false;
	}

	const scrollDependency = $derived(
		[
			panelOpen,
			selectedRoutes.length,
			selectedStops.length,
			selectedVehicleIds.length,
			selectedTripIds.length,
			store.status.join(','),
			store.occupancy.join(','),
			store.entities.join(','),
			store.alerts.join(','),
		].join('|'),
	);

	$effect(() => {
		const node = filterBodyEl;
		const dependency = scrollDependency;
		if (!node || !dependency) return;
		void tick().then(updateBodyScrollable);
	});

	$effect(() => {
		const node = filterBodyEl;
		if (!node || typeof ResizeObserver === 'undefined') return;

		const observer = new ResizeObserver(updateBodyScrollable);
		observer.observe(node);

		return () => observer.disconnect();
	});
</script>

<div
	class="map-filters {className}"
	data-open={panelOpen}
	data-collapsible={collapsible}
	data-scrollable={bodyScrollable}
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
					{#if filterOpen}
						<PanelLeftCloseIcon size={15} strokeWidth={2.2} aria-hidden="true" />
						<span class="mf-title">{t.filterTitle}</span>
					{:else}
						<PanelLeftOpenIcon size={15} strokeWidth={2.2} aria-hidden="true" />
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

	<div
		bind:this={filterBodyEl}
		class="mf-body"
		data-testid={!panelOpen && collapsible ? 'map-filter-rail' : undefined}
	>
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
							style="--chip:var(--primary)"
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
						<span class:mf-shape-stop={item.stop} class="mf-glyph">{item.glyph}</span>
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
		--mf-badge-size: 1.35rem;
		--mf-badge-icon-size: 0.82rem;
		--mf-swatch-size: 0.72rem;

		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 15.75rem;
		max-width: calc(100vw - 2rem);
		max-height: min(72dvh, calc(100dvh - 7rem));
		padding: 0.85rem;
		background: color-mix(in srgb, var(--card) 92%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 84%, var(--primary) 16%);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(8px);
		overflow: hidden;
		transition: width var(--duration-slow) var(--ease-default);
	}
	.map-filters[data-open='false'] {
		width: 3.7rem;
	}
	.map-filters[data-open='false'][data-scrollable='true'] {
		width: 4.95rem;
	}
	.mf-controls {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
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
		gap: 0.35rem;
		min-height: 2rem;
		padding: 0;
		color: inherit;
		background: none;
		border: none;
		cursor: pointer;
		overflow: hidden;
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default);
	}
	.mf-toggle:hover {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 8%, transparent);
	}
	.mf-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}
	.mf-title {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted-foreground);
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
		gap: 0.75rem;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		padding-right: 0;
		scrollbar-gutter: auto;
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--primary) 42%, var(--border) 58%) transparent;
	}
	.map-filters[data-scrollable='true'] .mf-body {
		padding-right: 0.5rem;
		scrollbar-gutter: stable;
	}
	.mf-body::-webkit-scrollbar {
		width: 0.45rem;
	}
	.mf-body::-webkit-scrollbar-track {
		background: transparent;
	}
	.mf-body::-webkit-scrollbar-thumb {
		background: color-mix(in srgb, var(--primary) 36%, var(--border) 64%);
		border-radius: var(--radius-pill);
	}
	.mf-group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.mf-group-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--accent-text);
		min-width: 0;
		overflow: hidden;
	}
	.mf-label-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		border: 1px solid color-mix(in srgb, var(--primary) 34%, transparent);
		border-radius: var(--radius-pill);
	}
	.mf-group-badge :global(svg) {
		width: var(--mf-badge-icon-size);
		height: var(--mf-badge-icon-size);
	}
	.mf-group-badge-status {
		color: var(--dataviz-status-late);
		background: color-mix(in srgb, var(--dataviz-status-late) 14%, transparent);
		border-color: color-mix(in srgb, var(--dataviz-status-late) 34%, transparent);
	}
	.mf-group-badge-crowding {
		color: var(--dataviz-occupancy-standing);
		background: color-mix(in srgb, var(--dataviz-occupancy-standing) 16%, transparent);
		border-color: color-mix(in srgb, var(--dataviz-occupancy-standing) 34%, transparent);
	}
	.mf-group-badge-shapes {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		border-color: color-mix(in srgb, var(--primary) 34%, transparent);
	}
	.mf-group-badge-alerts {
		color: var(--dataviz-severity-high);
		background: color-mix(in srgb, var(--dataviz-severity-high) 14%, transparent);
		border-color: color-mix(in srgb, var(--dataviz-severity-high) 34%, transparent);
	}
	.mf-group-badge-routes {
		color: var(--accent-text);
		background: color-mix(in srgb, var(--accent-text) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent-text) 34%, transparent);
	}
	.mf-group-badge-stops,
	.mf-group-badge-buses,
	.mf-group-badge-trips {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 14%, transparent);
		border-color: color-mix(in srgb, var(--primary) 34%, transparent);
	}
	.mf-chips {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem;
		min-width: 0;
	}
	.mf-chip {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		justify-content: flex-start;
		width: 100%;
		min-height: var(--mf-control-size);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		padding: 0.28rem 0.55rem;
		text-align: left;
		color: var(--muted-foreground);
		background: var(--muted);
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		cursor: pointer;
		overflow: hidden;
		transition:
			color 120ms ease,
			border-color 120ms ease,
			background-color 120ms ease;
	}
	.map-filters[data-open='false'] .mf-chip {
		justify-content: center;
		width: var(--mf-control-size);
		height: var(--mf-control-size);
		min-height: var(--mf-control-size);
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
		background: color-mix(in srgb, var(--primary) 8%, var(--muted) 92%);
		border-color: color-mix(in srgb, var(--primary) 30%, var(--border) 70%);
	}
	.mf-clear[data-active='false'] {
		color: var(--muted-foreground);
		background: var(--muted);
		border-color: var(--border-subtle);
		cursor: not-allowed;
		opacity: 0.56;
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
		background: color-mix(in srgb, var(--chip, var(--primary)) 10%, var(--muted) 90%);
		border-color: color-mix(in srgb, var(--chip, var(--primary)) 42%, var(--border) 58%);
	}
	.mf-clear:disabled:hover {
		color: var(--muted-foreground);
		background: var(--muted);
		border-color: var(--border-subtle);
	}
	.mf-chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	/* Active: the chip adopts its state colour (tinted bg + coloured border + text). */
	.mf-chip[data-on='true'] {
		color: var(--foreground);
		background: color-mix(in srgb, var(--chip) 22%, transparent);
		border-color: var(--chip);
	}
	/* Colour swatch only — the chip's state is its hue, never a shape. */
	.mf-swatch {
		width: var(--mf-swatch-size);
		height: var(--mf-swatch-size);
		border-radius: 50%;
		background: var(--chip);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--chip) 55%, transparent);
		flex: none;
	}
	.mf-glyph {
		display: inline-grid;
		place-items: center;
		width: var(--mf-badge-size);
		height: var(--mf-badge-size);
		flex: none;
		font-size: var(--text-body);
		line-height: 1;
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 38%, transparent);
		border-radius: var(--radius-pill);
	}
	.mf-shape-stop {
		opacity: 0.72;
	}
	.mf-shape-chip[data-on='true'] {
		color: var(--foreground);
		background: color-mix(in srgb, var(--primary) 18%, var(--popover) 72%);
		border-color: color-mix(in srgb, var(--primary) 55%, transparent);
	}
	.mf-alert-chip {
		--chip: var(--dataviz-severity-high);
	}
	@media (prefers-reduced-motion: reduce) {
		.map-filters,
		.mf-chip {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import BusFrontIcon from '@lucide/svelte/icons/bus-front';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import RouteIcon from '@lucide/svelte/icons/route';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import XIcon from '@lucide/svelte/icons/x';
	import { onMount, tick, type Snippet } from 'svelte';
	import { browser } from '$app/environment';
	import type { AlertEntityKind, EntityKind, FilterStore } from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import type { RouteIndexEntry, StopIndexEntry } from '$lib/v1';
	import { OCCUPANCY_CODES, STATUS_CODES } from '$lib/v1/schemas/types';
	import { OCCUPANCY_LABELS, STATUS_LABELS } from '$lib/v1/enumLabels';
	import { STATUS_GLYPH, occupancyGlyph, occupancyVar, statusVar } from '$lib/components/dataviz';
	import MapFilterGroup from './MapFilterGroup.svelte';
	import type { MapFilterGroupKind } from './MapFilterGroup.svelte';
	import MapFilterRail from './MapFilterRail.svelte';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import { copy as MAP_COPY } from './map.copy';

	const STORAGE_KEY = 'transit:controls-rail';
	type RailTarget = 'motion' | MapFilterGroupKind;

	interface Props {
		store: FilterStore;
		locale: Locale;
		routes?: readonly RouteIndexEntry[];
		stops?: readonly StopIndexEntry[];
		collapsible?: boolean;
		controlsMode?: boolean;
		header?: Snippet<[boolean]>;
		class?: string;
	}

	let {
		store,
		locale,
		routes = [],
		stops = [],
		collapsible = true,
		controlsMode = false,
		header,
		class: className = '',
	}: Props = $props();

	let rootEl = $state<HTMLElement | null>(null);
	let filterOpen = $state(true);
	let markersOpen = $state(true);
	let alertsOpen = $state(true);
	let activeOpen = $state(false);
	let statusOpen = $state(true);
	let crowdingOpen = $state(true);
	let previousSelectedCount = 0;

	const t = $derived(MAP_COPY[locale]);
	const panelTitle = $derived(controlsMode ? t.controlsTitle : t.filterTitle);
	const panelOpen = $derived(!collapsible || filterOpen);
	const presentation = $derived<'desktop' | 'drawer'>(collapsible ? 'desktop' : 'drawer');
	const controlsId = $derived(`map-filter-controls-${presentation}`);
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
	const selectedCount = $derived(
		selectedRoutes.length +
			selectedStops.length +
			selectedVehicleIds.length +
			selectedTripIds.length,
	);
	const filterCount = $derived(store.chips.length);
	const entityOptions = $derived([
		{ kind: 'bus', label: t.entityBus },
		{ kind: 'stop', label: t.entityStop, stop: true },
	] satisfies { kind: EntityKind; label: string; stop?: boolean }[]);
	const alertOptions = $derived([
		{ kind: 'has_alert', label: t.alertHas, aria: t.alertHasAria },
	] satisfies { kind: AlertEntityKind; label: string; aria: string }[]);

	onMount(() => {
		if (!collapsible) return;
		filterOpen = !readRailCollapsed();
	});

	$effect(() => {
		const count = selectedCount;
		if (count > 0 && previousSelectedCount === 0) activeOpen = true;
		if (count === 0) activeOpen = false;
		previousSelectedCount = count;
	});

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

	function readRailCollapsed(): boolean {
		if (!browser) return false;
		try {
			return localStorage.getItem(STORAGE_KEY) === 'true';
		} catch {
			return false;
		}
	}

	function persistRailState(collapsed: boolean): void {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, String(collapsed));
		} catch {
			// Storage denial must not block the controls.
		}
	}

	function setPanelOpen(open: boolean): void {
		filterOpen = open;
		if (collapsible) persistRailState(!open);
	}

	async function togglePanel(open: boolean): Promise<void> {
		setPanelOpen(open);
		await tick();
		rootEl?.querySelector<HTMLElement>(open ? '.mf-toggle' : '.mf-rail-expand')?.focus();
	}

	function toggleGroup(kind: MapFilterGroupKind): void {
		if (kind === 'markers') markersOpen = !markersOpen;
		else if (kind === 'alerts') alertsOpen = !alertsOpen;
		else if (kind === 'active') activeOpen = !activeOpen;
		else if (kind === 'status') statusOpen = !statusOpen;
		else crowdingOpen = !crowdingOpen;
	}

	function openGroup(kind: MapFilterGroupKind): void {
		if (kind === 'markers') markersOpen = true;
		else if (kind === 'alerts') alertsOpen = true;
		else if (kind === 'active') activeOpen = true;
		else if (kind === 'status') statusOpen = true;
		else crowdingOpen = true;
	}

	async function activateRail(target: RailTarget): Promise<void> {
		if (target !== 'motion') openGroup(target);
		setPanelOpen(true);
		await tick();
		const selector =
			target === 'motion'
				? '[data-testid="map-motion-switch"]'
				: `[data-filter-group="${target}"] .mf-group-trigger`;
		rootEl?.querySelector<HTMLElement>(selector)?.focus();
	}

	async function focusAfterRemoval(): Promise<void> {
		await tick();
		rootEl?.querySelector<HTMLElement>('[data-filter-group="active"] .mf-group-trigger')?.focus();
	}

	async function clearFilters(): Promise<void> {
		store.clear();
		await tick();
		if (presentation === 'drawer') {
			rootEl
				?.closest<HTMLElement>('[data-m6b-controls-drawer]')
				?.querySelector<HTMLElement>('[data-testid="map-filter-done"]')
				?.focus();
			return;
		}
		const fallback = collapsible && !filterOpen ? '.mf-rail-expand' : '.mf-toggle';
		rootEl?.querySelector<HTMLElement>(fallback)?.focus();
	}

	async function removeRoute(route: RouteIndexEntry): Promise<void> {
		store.removeRoute(route.id);
		await focusAfterRemoval();
	}

	async function removeStop(stop: StopIndexEntry): Promise<void> {
		store.removeStop(stop.id);
		await focusAfterRemoval();
	}

	async function removeVehicle(id: string): Promise<void> {
		store.removeVehicle(id);
		await focusAfterRemoval();
	}

	async function removeTrip(id: string): Promise<void> {
		store.removeTrip(id);
		await focusAfterRemoval();
	}

	function toggleStatus(code: (typeof STATUS_CODES)[number]): void {
		store.toggleStatus(code);
	}

	function toggleOccupancy(code: (typeof OCCUPANCY_CODES)[number]): void {
		store.toggleOccupancy(code);
	}

	function toggleEntity(kind: EntityKind): void {
		store.toggleEntity(kind);
	}

	function toggleAlert(kind: AlertEntityKind): void {
		store.toggleAlert(kind);
	}
</script>

<div
	bind:this={rootEl}
	class="map-filters {className}"
	data-open={panelOpen}
	data-collapsible={collapsible}
	data-controls={controlsMode}
	data-presentation={presentation}
	role="group"
	aria-label={panelTitle}
>
	<div id={controlsId} class="mf-expanded" aria-hidden={!panelOpen} inert={!panelOpen}>
		<div class="mf-controls">
			<div class="mf-head">
				{#if collapsible}
					<button
						type="button"
						class="mf-toggle"
						aria-expanded={filterOpen}
						aria-controls={controlsId}
						aria-label={t.controlsCollapse}
						onclick={() => void togglePanel(false)}
					>
						<PanelLeftCloseIcon size={16} strokeWidth={2.25} aria-hidden="true" />
						<span class="mf-title">{panelTitle}</span>
					</button>
				{:else}
					<span class="mf-title">{panelTitle}</span>
				{/if}
				{#if filterCount > 0}
					<span class="mf-head-count">{filterCount}</span>
				{/if}
				{#if !store.isEmpty}
					<button type="button" class="mf-clear" onclick={() => void clearFilters()}>
						<XIcon size={15} strokeWidth={2.35} aria-hidden="true" />
						<span>{t.filterClear}</span>
					</button>
				{/if}
			</div>
			{#if header}
				<div class="mf-header" data-testid="map-filter-header">
					{@render header(!panelOpen)}
				</div>
			{/if}
		</div>

		<div class="mf-body">
			<MapFilterGroup
				kind="markers"
				label={t.legendTitle}
				open={markersOpen}
				{presentation}
				ontoggle={() => toggleGroup('markers')}
			>
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
							<span class="mf-chip-text">{item.label}</span>
						</button>
					{/each}
				</div>
			</MapFilterGroup>

			<MapFilterGroup
				kind="alerts"
				label={t.modeAlerts}
				open={alertsOpen}
				{presentation}
				ontoggle={() => toggleGroup('alerts')}
			>
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
							<span class="mf-chip-text">{item.label}</span>
						</button>
					{/each}
				</div>
			</MapFilterGroup>

			<MapFilterGroup
				kind="active"
				label={t.activeTitle}
				open={activeOpen}
				{presentation}
				count={selectedCount}
				ontoggle={() => toggleGroup('active')}
			>
				<div class="mf-active-groups">
					{#if selectedRoutes.length > 0}
						<div class="mf-active-set">
							<span class="mf-active-label"><RouteIcon size={13} />{t.modeRoutes}</span>
							<div class="mf-chips">
								{#each selectedRoutes as route (route.id)}
									<button
										type="button"
										class="mf-chip"
										data-on="true"
										aria-label="{t.routeRemove} {route.short}"
										aria-pressed="true"
										style="--chip:var(--accent-text)"
										onclick={() => void removeRoute(route)}
									>
										<span class="mf-swatch"></span>
										<span class="mf-chip-text">{routeDisplay(route)}</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if selectedStops.length > 0}
						<div class="mf-active-set">
							<span class="mf-active-label">{t.modeStops}</span>
							<div class="mf-chips">
								{#each selectedStops as stop (stop.id)}
									<button
										type="button"
										class="mf-chip"
										data-on="true"
										aria-label="{t.stopRemove} {stop.code ?? stop.id}"
										aria-pressed="true"
										style="--chip:var(--accent)"
										onclick={() => void removeStop(stop)}
									>
										<span class="mf-swatch"></span>
										<span class="mf-chip-text">{stopDisplay(stop)}</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if selectedVehicleIds.length > 0}
						<div class="mf-active-set">
							<span class="mf-active-label"><BusFrontIcon size={13} />{t.modeVehicles}</span>
							<div class="mf-chips">
								{#each selectedVehicleIds as vehicleId (vehicleId)}
									<button
										type="button"
										class="mf-chip"
										data-on="true"
										aria-label="{t.vehicleRemove} {vehicleId}"
										aria-pressed="true"
										style="--chip:var(--primary)"
										onclick={() => void removeVehicle(vehicleId)}
									>
										<span class="mf-swatch"></span>
										<span class="mf-chip-text">{t.vehicleLabel} {vehicleId}</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if selectedTripIds.length > 0}
						<div class="mf-active-set">
							<span class="mf-active-label"><TicketIcon size={13} />{t.modeTrips}</span>
							<div class="mf-chips">
								{#each selectedTripIds as tripId (tripId)}
									<button
										type="button"
										class="mf-chip"
										data-on="true"
										aria-label="{t.tripRemove} {tripId}"
										aria-pressed="true"
										style="--chip:var(--primary)"
										onclick={() => void removeTrip(tripId)}
									>
										<span class="mf-swatch"></span>
										<span class="mf-chip-text">{t.tripLabel} {tripId}</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</MapFilterGroup>

			<MapFilterGroup
				kind="status"
				label={t.modeStatus}
				open={statusOpen}
				{presentation}
				ontoggle={() => toggleGroup('status')}
			>
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
							<span
								class="mf-state-glyph"
								data-m6d-glyph-kind="status"
								data-m6d-glyph-code={code}
								aria-hidden="true">{STATUS_GLYPH[code]}</span
							>
							<span class="mf-chip-text">{STATUS_LABELS[locale][code]}</span>
						</button>
					{/each}
				</div>
			</MapFilterGroup>

			<MapFilterGroup
				kind="crowding"
				label={t.modeOccupancy}
				open={crowdingOpen}
				{presentation}
				ontoggle={() => toggleGroup('crowding')}
			>
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
							<span
								class="mf-state-glyph"
								data-m6d-glyph-kind="crowding"
								data-m6d-glyph-code={code}
								aria-hidden="true">{occupancyGlyph(code)}</span
							>
							<span class="mf-chip-text">{OCCUPANCY_LABELS[locale][code]}</span>
						</button>
					{/each}
				</div>
			</MapFilterGroup>
		</div>
	</div>

	{#if collapsible && !panelOpen}
		<div class="mf-rail-layer">
			<MapFilterRail
				copy={t}
				activeCount={selectedCount}
				hasFilters={!store.isEmpty}
				{controlsId}
				onexpand={() => void togglePanel(true)}
				onactivate={(target) => void activateRail(target)}
				onclear={() => void clearFilters()}
			/>
		</div>
	{/if}
</div>

<style>
	.map-filters {
		--mf-control-size: 2rem;
		--mf-swatch-size: 0.7rem;
		--mf-edge: color-mix(in srgb, var(--border) 82%, var(--primary) 18%);
		position: relative;
		display: flex;
		flex-direction: column;
		width: 16rem;
		max-width: calc(100vw - 2rem);
		max-height: min(72dvh, calc(100dvh - 7rem));
		background: color-mix(in srgb, var(--card) 90%, transparent);
		border: 1px solid var(--mf-edge);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(12px) saturate(1.1);
		-webkit-backdrop-filter: blur(12px) saturate(1.1);
		overflow: hidden;
		transition-property: width;
		transition-duration: var(--duration-slow);
		transition-timing-function: var(--ease-out);
	}

	.map-filters[data-open='false'] {
		width: 5.75rem;
		transition-duration: var(--duration-normal);
	}

	.mf-expanded {
		display: flex;
		width: 16rem;
		max-height: inherit;
		min-height: 0;
		flex: none;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem 0.75rem;
		opacity: 1;
		transition-property: opacity;
		transition-duration: var(--duration-fast);
		transition-delay: 100ms;
		transition-timing-function: var(--ease-out);
	}

	.map-filters[data-open='false'] .mf-expanded {
		pointer-events: none;
		opacity: 0;
		transition: none;
	}

	.mf-rail-layer {
		position: absolute;
		inset: 0;
	}

	.mf-controls {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid color-mix(in srgb, var(--mf-edge) 70%, transparent);
	}

	.mf-head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	.mf-toggle {
		display: flex;
		align-items: center;
		min-width: 0;
		min-height: 44px;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		color: var(--foreground);
		background: transparent;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.mf-toggle:hover,
	.mf-toggle:focus-visible {
		background: var(--muted);
	}

	.mf-title {
		min-width: 0;
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.mf-head-count {
		display: inline-grid;
		min-width: 1.4rem;
		height: 1.4rem;
		place-items: center;
		margin-left: auto;
		padding: 0 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-variant-numeric: tabular-nums;
		color: var(--primary-foreground);
		background: var(--primary);
		border-radius: var(--radius-pill);
	}

	.mf-clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		gap: 0.25rem;
		padding: 0.375rem 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 700;
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 9%, var(--muted) 91%);
		border: 1px solid color-mix(in srgb, var(--primary) 30%, var(--border) 70%);
		border-radius: var(--radius-pill);
		cursor: pointer;
	}

	.mf-header {
		display: flex;
		min-width: 0;
		flex-direction: column;
		padding-top: 0.125rem;
	}

	.mf-body {
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		padding-right: 0.5rem;
		scrollbar-color: color-mix(in srgb, var(--primary) 40%, var(--border) 60%) transparent;
		scrollbar-gutter: stable;
		scrollbar-width: thin;
	}

	.mf-body::-webkit-scrollbar {
		width: 0.375rem;
	}

	.mf-body::-webkit-scrollbar-thumb {
		background: color-mix(in srgb, var(--primary) 32%, var(--border) 68%);
		border-radius: var(--radius-pill);
	}

	.mf-chips {
		display: grid;
		min-width: 0;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.375rem;
		padding: 0 0.5rem 0.375rem 2.5rem;
	}

	.mf-chip {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		width: 100%;
		min-height: 2rem;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem 0.375rem 0.5rem;
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		text-align: left;
		background: color-mix(in srgb, var(--muted) 70%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}

	.mf-chip:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--chip, var(--primary)) 12%, var(--muted) 88%);
		border-color: color-mix(in srgb, var(--chip, var(--primary)) 48%, var(--border) 52%);
	}

	.mf-chip[data-on='true'] {
		color: var(--foreground);
		font-weight: 600;
		background: color-mix(in srgb, var(--chip, var(--primary)) 20%, var(--card));
		border-color: var(--chip, var(--primary));
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--chip, var(--primary)) 28%, transparent);
	}

	.mf-chip-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mf-swatch {
		width: var(--mf-swatch-size);
		height: var(--mf-swatch-size);
		flex: none;
		background: var(--chip, var(--primary));
		border-radius: 50%;
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--chip, var(--primary)) 55%, transparent);
	}

	.mf-glyph {
		display: inline-grid;
		width: 1.4rem;
		height: 1.4rem;
		place-items: center;
		padding: 0.125rem;
		flex: none;
		color: var(--primary);
		--marker-glyph-cut: var(--card);
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 36%, transparent);
		border-radius: var(--radius-sm);
	}

	.mf-shape-stop {
		color: var(--map-stop-fill);
		background: color-mix(in srgb, var(--map-stop-fill) 16%, transparent);
		border-color: color-mix(in srgb, var(--map-stop-fill) 36%, transparent);
	}

	.mf-alert-chip {
		--chip: var(--dataviz-severity-high);
	}

	.mf-active-groups {
		display: grid;
		gap: 0.625rem;
	}

	.mf-active-set {
		display: grid;
		gap: 0.25rem;
	}

	.mf-active-label {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-left: 2.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		color: var(--muted-foreground);
		text-transform: uppercase;
	}

	.map-filters[data-presentation='drawer'] {
		width: 100%;
		max-width: none;
		max-height: none;
		background: transparent;
		border: 0;
		border-radius: 0;
		box-shadow: none;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		overflow: visible;
	}

	.map-filters[data-presentation='drawer'] .mf-expanded {
		width: 100%;
		max-width: none;
		max-height: none;
		padding: 0;
	}

	.map-filters[data-presentation='drawer'] .mf-controls {
		display: contents;
	}

	.map-filters[data-presentation='drawer'] .mf-head {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 0.75rem 1rem 0.625rem;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--mf-edge) 70%, transparent);
	}

	.map-filters[data-presentation='drawer'] .mf-header {
		padding: 0.5rem 1rem 0.625rem;
		border-bottom: 1px solid color-mix(in srgb, var(--mf-edge) 70%, transparent);
	}

	.map-filters[data-presentation='drawer'] .mf-body {
		overflow: visible;
		padding: 0.5rem 0.5rem 0.75rem;
		scrollbar-gutter: auto;
	}

	.map-filters[data-presentation='drawer'] .mf-chip {
		min-height: 44px;
	}

	@media (prefers-reduced-motion: reduce) {
		.map-filters,
		.mf-expanded,
		.mf-chip {
			transition: none;
		}
	}
</style>

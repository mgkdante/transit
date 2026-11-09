<script lang="ts">
	import { providerHasAlerts } from '#lib/v1/providers.ts';
	import { onMount, tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Map as MapLibreMap } from 'maplibre-gl';
	import type { MapStageFailure } from '#lib/components/map/MapStage.svelte';
	import { getLocale, type Locale } from '#lib/i18n/index.ts';
	import { clock, desktop, theme } from '@yesid/ui/state';
	import { StateNotice } from '@yesid/ui/feedback';
	import { Button } from '@yesid/ui/button';
	import { createLiveStore } from '#lib/v1/live/store.svelte.ts';
	import { getV1Context } from '#lib/v1/boot.ts';
	import { getBasemap } from '#lib/v1/repositories/basemap.ts';
	import {
		getRoute,
		getRoutesIndex,
		getStop,
		getStopsIndexSlim,
	} from '#lib/v1/repositories/static.ts';
	import type { SlimStopEntry } from '#lib/v1/index.ts';
	import { createFilterStore, fromSearchParams } from '#lib/filters/index.ts';
	import { nearTargetFromSearchParams } from '#lib/search/mapNear.ts';
	import { parseMapFocus } from '#lib/search/mapFocus.ts';
	import { RightPanel } from '#lib/components/shell/index.ts';
	import {
		MapStage,
		nearestStops,
		liveTtlS,
		type WithDistance,
		type FixResolver,
	} from '#lib/components/map/index.ts';
	import { createShapeCacheManager } from './mapShapeCache';
	import { motionMode } from '#lib/stores/index.ts';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import MapFilters from './MapFilters.svelte';
	import MapMotionControl from './MapMotionControl.svelte';
	import MapSelectionDetail from './MapSelectionDetail.svelte';
	import MapSurfaceCanvasLayer from './MapSurfaceCanvasLayer.svelte';
	import MapOverlayChrome from './MapOverlayChrome.svelte';
	import MapDetailOverlay from './MapDetailOverlay.svelte';
	import MapMobileDetailSheet from './MapMobileDetailSheet.svelte';
	import { zoomForNearMePrecision } from './mapGeo';
	import { focusCoordinate, fitRouteBounds } from './mapCamera';
	import {
		buildNearTargetSearch,
		clearNearTargetSearch,
		buildFocusClearSearch,
	} from './mapUrlSync';
	import { motionFeedAnimate } from './motionFeed';
	import { nearTargetKey } from './mapNearMe';
	import { createMapNearMeController, type NearMeOrigin } from './mapNearMeController.svelte';
	import { createMapFocusController } from './mapFocusController.svelte';
	import { createMapUrlCoordinator, MAP_URL_REWRITE } from './mapUrlCoordinator';
	import { deriveMapFitPadding, mapCameraFraming } from './mapCameraFraming';
	import { mapCopy } from './map.copy';
	import { publishRailOffset, readStoredDetailPanelWidth } from './mapDetailPanes';
	import { createMapRuntime, type MapRuntimeFeed } from './mapRuntime.svelte';
	import { createMapSelectionSession, type MapSelection } from './mapSelectionSession.svelte';
	import * as ownerCleanup from './mapOwnerCleanup';

	interface Props {
		onready?: () => void;
		onidle?: () => void;
		onrecovering?: () => void;
		onfailure?: (failure: MapStageFailure | null) => void;
	}

	let { onready, onidle, onrecovering, onfailure }: Props = $props();

	const locale: Locale = getLocale();
	const v1 = getV1Context();
	const manifest = v1.manifest;
	const t = mapCopy(locale, v1.provider?.labels[locale].city ?? manifest.city ?? manifest.provider);
	const framing = mapCameraFraming(v1);
	const alertsAvailable = providerHasAlerts(v1.provider);
	function readMapFilters(params: URLSearchParams) {
		const state = fromSearchParams(params);
		return alertsAvailable ? state : { ...state, alerts: [] };
	}

	let mapWidthPx = $state(1280);

	let detailWidthPx = $state(readStoredDetailPanelWidth());
	let detailCollapsed = $state(false);
	let heroEl = $state<HTMLDivElement | null>(null);
	let detailDragging = $state(false);
	const detailResizeAria = $derived(t.detailResizeLabel);
	const mapFitPadding = $derived(deriveMapFitPadding(desktop.current, mapWidthPx));
	const urlCoordinator = createMapUrlCoordinator(new URL(page.url.href), goto);
	const filters = createFilterStore(
		readMapFilters(new URLSearchParams(page.url.search)),
		urlCoordinator.writeFilters,
	);

	const nearMeController = createMapNearMeController({
		providerId: manifest.provider,
		bbox: manifest.bbox,
		locale,
		goto: urlCoordinator.goto,
		currentUrl: urlCoordinator.currentUrl,
		readTarget: (params) => nearTargetFromSearchParams(params, manifest.bbox),
		targetKey: nearTargetKey,
		buildTargetSearch: buildNearTargetSearch,
		clearTargetSearch: clearNearTargetSearch,
		focusOrigin: focusNearMeOrigin,
		fetch: (input, init) => globalThis.fetch(input, init),
		getGeolocation: () => (typeof navigator === 'undefined' ? null : navigator['geolocation']),
		isSecureContext: () => typeof window === 'undefined' || window.isSecureContext,
		translations: t,
	});
	const focusController = createMapFocusController({
		readFocus: parseMapFocus,
		clearFocus: () => {
			const url = urlCoordinator.currentUrl();
			void urlCoordinator.goto(
				buildFocusClearSearch(url.searchParams, url.pathname),
				MAP_URL_REWRITE,
			);
		},
	});
	type RecoveryCameraIntent =
		| { kind: 'point'; coord: [number, number]; minZoom: number }
		| { kind: 'selection'; selection: MapSelection }
		| { kind: 'url' };
	let recovering = $state(false);
	let recoveryCameraIntent: RecoveryCameraIntent | null = null;
	let recoveryFocusTarget: HTMLElement | null = null;

	let ingestedUrlIdentity = '';
	$effect(() => {
		const url = new URL(page.url.href);
		const urlIdentity = `${url.pathname}${url.search}`;
		if (urlIdentity === ingestedUrlIdentity) return;
		ingestedUrlIdentity = urlIdentity;
		filters.replaceFromUrl(readMapFilters(url.searchParams), urlCoordinator.settle(url));
		if (!alertsAvailable && url.searchParams.has('alert')) {
			const next = new URL(url);
			next.searchParams.delete('alert');
			void urlCoordinator.goto(`${next.pathname}${next.search}`, MAP_URL_REWRITE);
		}
		nearMeController.syncFromUrl(url.searchParams);
		const previousFocus = focusController.pending;
		focusController.syncFromUrl(url.searchParams);
		if (recovering && focusController.pending !== previousFocus) {
			if (focusController.pending) recoveryCameraIntent = { kind: 'url' };
			else if (recoveryCameraIntent?.kind === 'url') recoveryCameraIntent = null;
		}
	});

	const live = createLiveStore(manifest, {
		families: alertsAvailable ? ['vehicles', 'alerts'] : ['vehicles'],
	});
	function reportMapCleanupFailure(error: unknown): void {
		ownerCleanup.reportCleanupFailure('MapHero cleanup failed', error);
	}
	function releaseMapOwner(dispose: () => void): void {
		ownerCleanup.releaseWithRetry(dispose, reportMapCleanupFailure);
	}
	$effect(() => () => {
		releaseMapOwner(nearMeController.dispose);
		releaseMapOwner(urlCoordinator.dispose);
	});
	onMount(() => {
		live.start();
		return () => releaseMapOwner(() => live.stop());
	});

	$effect(() => {
		const unsubscribe = clock.subscribe();
		return () => releaseMapOwner(unsubscribe);
	});

	const liveTtl = liveTtlS(manifest.files?.live?.ttl_s);

	let mapFailure = $state<MapStageFailure | null>(null);
	let hasFirstIdle = $state(false);
	const shapeCache = createShapeCacheManager(getRoute);
	const session = createMapSelectionSession({
		live,
		repositories: { getRoute, getStop, getStopsIndexSlim, getRoutesIndex },
		filters,
		locale,
		timeZone: manifest.tz,
		serverNow: () => clock.serverNow,
		alertsAvailable,
	});
	const runtime = createMapRuntime({
		selection: session,
		readFeed: readMapFeed,
		onpick: selectPickedFeature,
	});
	const map = $derived(runtime.map);
	const selectionStack = $derived(session.stack);
	const detailOpen = $derived(session.detailOpen);
	$effect(() => {
		if (!detailOpen) detailCollapsed = false;
	});

	const stopList = $derived(session.stops);
	const selectedDetail = $derived(session.detail);
	const selectionPresence = $derived(session.presence);
	const selectionSourceHealth = $derived(session.sourceHealth);
	const selectedVehicleAbsence = $derived(session.vehicleAbsence);
	const detailSurfaceKey = $derived(session.surfaceKey);
	const hoverPeek = $derived(session.hoverPeek);
	const routeList = $derived(session.routeList);
	const routeLineRoutes = $derived(session.routeLineRoutes);
	const selectedRouteLine = $derived(session.selectedRouteLine);
	const selectedVehicleId = $derived(session.selectedVehicleId);
	const selectedStopId = $derived(session.selectedStopId);
	const alertVehicleIds = $derived(session.alertVehicleIds);
	const liveEdgeState = $derived(session.liveEdgeState);
	const liveEdgeMessage = $derived(session.liveEdgeMessage);
	const liveDegraded = $derived(session.liveDegraded);
	const selectedFamilyFailureMessage = $derived(session.failureMessage);
	$effect(() => {
		const routes = session.loadedRoutes;
		untrack(() => {
			for (const route of routes) if (route) shapeCache.remember(route);
		});
	});
	function commitPickedSelection(next: MapSelection) {
		session.select(next, 'pick');
	}
	function selectPickedFeature(next: MapSelection) {
		commitPickedSelection(next);
		detailCollapsed = false;
		focusSelection(next);
	}
	function closeDetail() {
		session.close();
		detailCollapsed = false;
	}
	const selectFromDetail = (next: MapSelection) => session.select(next, 'detail');
	const goBackDetail = session.back;
	const applyDetailFilter = session.applyFilter;
	const selectAlertRelated = session.selectAlert;
	const nearbyStops = $derived<WithDistance<SlimStopEntry>[]>(
		nearMeController.origin ? nearestStops(nearMeController.origin, stopList, 5, 1_200) : [],
	);

	function focusSelection(selection: MapSelection, target: MapLibreMap | null = map): boolean {
		if (recovering) {
			recoveryCameraIntent = { kind: 'selection', selection };
			return true;
		}
		if (selection.kind === 'stop') return focusStop(selection.id, target);
		if (selection.kind === 'vehicle') return focusVehicle(selection.id, target);
		return focusRoute(selection.id, target);
	}

	function focusStop(id: string, target: MapLibreMap | null = map): boolean {
		const stop = stopList.find((s) => s.id === id);
		if (!stop) return false;
		return focusCoordinate(target, [stop.lon, stop.lat], 16);
	}

	function focusVehicle(id: string, target: MapLibreMap | null = map): boolean {
		const vehicle = (live.vehicles?.vehicles ?? []).find((v) => v.id === id);
		if (!vehicle) return false;
		return focusCoordinate(target, [vehicle.lon, vehicle.lat], 16);
	}

	function focusRoute(id: string, target: MapLibreMap | null = map): boolean {
		const route = routeList.find((r) => r.id === id);
		if (!route) return false;
		return fitRouteBounds(target, route);
	}

	$effect(() => {
		const pending = focusController.pending;
		if (recovering || !map || !pending) return;
		if (!session.focusReady(pending)) return;
		focusController.consumeOnce(focusSelection);
	});

	function focusNearMeOrigin(origin: NearMeOrigin): void {
		const coord: [number, number] = [origin.lon, origin.lat];
		const minZoom = zoomForNearMePrecision(origin.precision);
		if (recovering) recoveryCameraIntent = { kind: 'point', coord, minZoom };
		else focusCoordinate(map, coord, minZoom);
	}

	function selectNearbyStop(stop: WithDistance<SlimStopEntry>): void {
		commitPickedSelection({ kind: 'stop', id: stop.id });
		detailCollapsed = false;
		if (recovering)
			recoveryCameraIntent = { kind: 'point', coord: [stop.lon, stop.lat], minZoom: 15 };
		else focusCoordinate(map, [stop.lon, stop.lat], 15);
	}

	function onMapReady(m: MapLibreMap, reportSetupFailure?: () => void): void {
		const wasRecovering = recovering;
		hasFirstIdle = false;
		runtime.ready(m, reportSetupFailure);
		if (wasRecovering) {
			recovering = false;
			const intent = recoveryCameraIntent;
			recoveryCameraIntent = null;
			if (intent?.kind === 'point' || intent?.kind === 'selection') {
				if (focusController.pending) focusController.consumeOnce(() => {});
				if (intent.kind === 'point') focusCoordinate(m, intent.coord, intent.minZoom);
				else focusSelection(intent.selection, m);
			}
		} else nearMeController.refocus();
		onready?.();
	}

	function onMapRecovering(): void {
		const focused = document.activeElement;
		const ownedFocus = focused instanceof HTMLElement && heroEl?.contains(focused) ? focused : null;
		recoveryFocusTarget =
			ownedFocus && !ownedFocus.closest('[data-map-runtime]') ? ownedFocus : null;
		ownedFocus?.blur();
		recovering = true;
		recoveryCameraIntent = focusController.pending ? { kind: 'url' } : null;
		onrecovering?.();
	}

	function onMapIdle(): void {
		hasFirstIdle = true;
		const focused = recoveryFocusTarget;
		recoveryFocusTarget = null;
		onidle?.();
		if (focused) {
			void tick().then(() => {
				if (
					!recovering &&
					focused.isConnected &&
					heroEl?.contains(focused) &&
					document.activeElement === document.body &&
					!focused.closest('[inert]')
				) {
					focused.focus({ preventScroll: true });
				}
			});
		}
	}

	function onMapFailure(failure: MapStageFailure | null): void {
		mapFailure = failure;
		onfailure?.(failure);
	}

	$effect(() => {
		const vehicles = live.vehicles?.vehicles ?? [];
		if (motionMode.current !== 'smooth' || vehicles.length === 0) return;
		untrack(() => shapeCache.prefetch(vehicles));
	});

	const shapeFor = shapeCache.shapeFor;

	const fixFor: FixResolver = (id) => {
		const v = live.index.byVehicleId.get(id);
		if (!v) return null;
		return {
			reportedUtc: v.reported_utc,
			updatedUtc: v.updated_utc,
			speedMps: v.speed_kmh != null ? v.speed_kmh / 3.6 : null,
		};
	};

	function readMapFeed(): MapRuntimeFeed {
		const reduceMotion = $prefersReducedMotion;
		const smoothMotion = motionMode.current === 'smooth';
		const animate = hasFirstIdle && motionFeedAnimate({ smoothMotion, reduceMotion });
		const serverNow = untrack(() => clock.serverNow);
		const filter = filters.state;
		const stale = live.vehiclesIsStale;
		const vehicleItems = live.vehicles?.vehicles ?? [];
		const vehicleTickKey = live.vehiclesGeneratedUtc;
		return {
			routes: {
				items: routeLineRoutes,
				selected: selectedRouteLine,
			},
			vehicles: {
				items: vehicleItems,
				filter,
				alertIds: alertVehicleIds,
				selectedId: selectedVehicleId,
				serverNow,
				ttlS: liveTtl,
				tickKey: vehicleTickKey,
				stale,
				fixFor,
				shapeFor: animate ? shapeFor : undefined,
				serverNowFn: () => untrack(() => clock.serverNowContinuousMs()),
				animate,
			},
			stops: {
				items: stopList,
				filter,
				alertIds: session.alertStopIds,
				selectedId: selectedStopId,
			},
			nearTarget: {
				target: nearMeController.origin,
			},
		};
	}

	$effect(() => {
		const el = heroEl;
		if (!el) return;
		const open = detailOpen && desktop.current;
		const dispose = publishRailOffset(el, detailWidthPx, open, detailCollapsed, detailDragging);
		return () => releaseMapOwner(dispose);
	});

	function toggleDetailCollapsed(): void {
		detailCollapsed = !detailCollapsed;
	}
</script>

{#snippet mapBody()}
	<MapStage
		class="map-hero-stage"
		basemapLoader={({ signal }) => getBasemap({ signal })}
		theme={theme.current}
		center={framing.center}
		bounds={framing.bounds}
		maxBounds={framing.maxBounds}
		fitPadding={mapFitPadding}
		onready={onMapReady}
		onrecovering={onMapRecovering}
		onidle={onMapIdle}
		onstyleload={runtime.styleLoad}
		onthemerepaint={runtime.repaint}
		onerror={onMapFailure}
		onbeforeremove={runtime.release}
		customAttribution={manifest.attribution}
		locale={{
			'Map.Title': t.mapCanvasLabel,
			'AttributionControl.ToggleAttribution': t.attributionToggle,
		}}
		label={t.mapLabel}
	/>
{/snippet}

{#snippet detailPanel()}
	<!-- prettier-ignore -->

	<RightPanel
		locale={locale}
		identity={detailIdentity}
		footer={detailFooter}
		surfaceKey={detailSurfaceKey}
		canGoBack={selectionStack.length > 0}
		onback={goBackDetail}
		onclose={closeDetail}
		collapsed={detailCollapsed}
		ontogglecollapse={toggleDetailCollapsed}
		resizable
	>
		{#if selectedDetail}
			<MapSelectionDetail
				detail={selectedDetail}
				alertsStale={live.familyStates.alerts.health.notice !== null}
				alertsAgeSeconds={live.familyStates.alerts.health.ageSeconds}
				locale={locale}
				timeZone={v1.manifest.tz}
				notReporting={selectedVehicleAbsence}
				selectionPresence={selectionPresence}
				selectionSourceHealth={selectionSourceHealth}
				onrefresh={live.refresh}
				onselect={selectFromDetail}
				onpreview={(next) => void session.setHovered(next)}
				onfilter={applyDetailFilter}
				onalertselect={selectAlertRelated}
			/>
		{/if}
	</RightPanel>
{/snippet}

{#snippet detailIdentity()}
	<!-- prettier-ignore -->

	<MapSelectionDetail
		detail={selectedDetail}
		locale={locale}
		presentation="identity"
	/>
{/snippet}

{#snippet detailFooter()}
	<!-- prettier-ignore -->

	<MapSelectionDetail
		detail={selectedDetail}
		locale={locale}
		presentation="action"
		onfilter={applyDetailFilter}
	/>
{/snippet}

{#snippet motionHeader(collapsed: boolean)}
	<MapMotionControl {locale} copy={t} {collapsed} />
{/snippet}
{#snippet mapControls(opts?: { collapsible?: boolean })}
	<MapFilters
		store={filters}
		{alertsAvailable}
		{locale}
		routes={session.routesIndex}
		stops={session.stops}
		collapsible={opts?.collapsible ?? true}
		controlsMode={true}
		header={motionHeader}
	/>
{/snippet}

{#snippet mapRetry()}
	{#if mapFailure}
		<Button type="button" size="sm" class="min-h-11" onclick={() => void mapFailure?.retry()}>
			{t.mapRetry}
		</Button>
	{/if}
{/snippet}

{#snippet mapSurface()}
	<div class="map-surface">
		<MapSurfaceCanvasLayer {mapBody} />

		{#if mapFailure}
			<div class="map-stage-error">
				<StateNotice
					title={t.mapErrorTitle}
					body={t.mapErrorBody}
					glyph="!"
					tone="error"
					presentation="card"
					role="alert"
					aria-live="assertive"
					action={mapRetry}
				/>
			</div>
		{:else}
			<MapOverlayChrome
				{locale}
				{t}
				generatedUtc={live.generatedUtc}
				ageSeconds={live.ageSeconds}
				isStale={live.isStale}
				isPartialStale={live.isPartialStale}
				degraded={liveDegraded}
				{selectedFamilyFailureMessage}
				bind:nearMeOpen={nearMeController.open}
				bind:nearMeQuery={nearMeController.query}
				nearMeLoading={nearMeController.loading}
				nearMeError={nearMeController.error}
				nearMeOrigin={nearMeController.origin}
				{nearbyStops}
				onuselocation={nearMeController.useLocation}
				onsearch={nearMeController.search}
				onsuggestion={nearMeController.selectSuggestion}
				onstopselect={selectNearbyStop}
				onclear={nearMeController.clear}
				isDesktop={desktop.current}
				filtersStore={filters}
				{detailOpen}
				{liveEdgeState}
				{liveEdgeMessage}
				{hoverPeek}
				controls={mapControls}
			/>
		{/if}
	</div>
{/snippet}

<div
	class="map-hero"
	data-selection-presence={selectionPresence}
	data-selection-source-health={selectionSourceHealth}
	data-motion-stale={live.vehiclesIsStale}
	data-motion-tick-key={runtime.processedMotion?.tickKey}
	data-motion-vehicle-count={runtime.processedMotion?.vehicleCount}
	bind:this={heroEl}
	bind:clientWidth={mapWidthPx}
>
	{@render mapSurface()}

	{#if desktop.current && detailOpen}
		<MapDetailOverlay
			bind:widthPx={detailWidthPx}
			bind:collapsed={detailCollapsed}
			bind:dragging={detailDragging}
			resizeAria={detailResizeAria}
			{detailPanel}
		/>
	{/if}

	{#if detailOpen && !desktop.current}
		<MapMobileDetailSheet
			bind:open={
				() => session.detailOpen,
				(next) => {
					if (next) session.detailOpen = true;
					else closeDetail();
				}
			}
			{locale}
			identity={detailIdentity}
			timeZone={v1.manifest.tz}
			footer={detailFooter}
			surfaceKey={detailSurfaceKey}
			canGoBack={selectionStack.length > 0}
			onback={goBackDetail}
			{selectedDetail}
			alertsStale={live.familyStates.alerts.health.notice !== null}
			alertsAgeSeconds={live.familyStates.alerts.health.ageSeconds}
			notReporting={selectedVehicleAbsence}
			{selectionPresence}
			{selectionSourceHealth}
			onrefresh={live.refresh}
			onselect={selectFromDetail}
			onpreview={(next) => void session.setHovered(next)}
			onfilter={applyDetailFilter}
			onalertselect={selectAlertRelated}
		/>
	{/if}
</div>

<style>
	.map-hero {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--background);
		--app-right-detail-offset: var(--size-detail-panel);
		--map-detail-offset: 0rem;
		--map-mobile-control-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		--z-map-behind: -1;
		--z-map-canvas: 1;
		--z-map-popover-behind: 2;
		--z-map-scrim: 5;
		--z-map-overlay: 10;
		--z-map-filter: 12;
		--z-map-banner-content: 13;
		--z-map-detail: 24;
		--z-map-detail-panel: 32;
	}

	.map-surface {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}

	.map-stage-error {
		position: absolute;
		z-index: var(--z-map-detail);
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: color-mix(in srgb, var(--background) 88%, transparent);
	}

	.map-stage-error :global(.state-notice) {
		width: min(100%, 30rem);
	}
</style>

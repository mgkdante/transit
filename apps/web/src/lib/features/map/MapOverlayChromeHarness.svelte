<!--
  Test-only harness for MapOverlayChrome — wires the REAL unified Controls snippet
  (MapFilters in controlsMode + the inline MapMotionControl header) into the chrome
  exactly as MapHero does, so the desktop-overlays-render-the-shared-controls
  contract can be asserted without standing up the whole MapHero. Not a route
  component; it exists purely to give MapOverlayChrome.svelte.test.ts a real
  `controls` snippet plus sensible defaults for the live/near-me/peek props.
-->
<script lang="ts">
	import type { FilterStore, Chip } from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import type { RouteIndexEntry, StopIndexEntry } from '$lib/v1';
	import type { Alert } from '$lib/v1/schemas';
	import type { LatLon, WithDistance } from '$lib/components/map';
	import type { GeocodePrecision } from '$lib/geocode/types';
	import type { MapSelection, MapSelectionDetail } from './mapSelection';
	import MapFilters from './MapFilters.svelte';
	import MapMotionControl from './MapMotionControl.svelte';
	import MapOverlayChrome from './MapOverlayChrome.svelte';
	import { copy as MAP_COPY } from './map.copy';

	type NearMeOrigin = LatLon & { label: string; precision?: GeocodePrecision };

	interface Props {
		store: FilterStore;
		locale: Locale;
		routes?: readonly RouteIndexEntry[];
		stops?: readonly StopIndexEntry[];
		// Live-store reads.
		generatedUtc?: string | null;
		ageSeconds?: number | null;
		isStale?: boolean;
		// Near-me.
		nearMeOrigin?: NearMeOrigin | null;
		nearbyStops?: readonly WithDistance<StopIndexEntry>[];
		// Layout gate for the peek.
		isDesktop?: boolean;
		detailOpen?: boolean;
		// Live-edge.
		liveEdgeState?: 'unavailable' | 'no-vehicles' | null;
		liveEdgeMessage?: string | null;
		// Hover peek.
		hoverDetail?: MapSelectionDetail | null;
		hoverVehicleAbsence?: { ageS: number } | null;
		// Spies.
		onstopselect?: (stop: WithDistance<StopIndexEntry>) => void;
		onselect?: (selection: MapSelection) => void;
		onfilter?: (chip: Chip) => void;
		onalertselect?: (alert: Alert) => void;
	}

	let {
		store,
		locale,
		routes = [],
		stops = [],
		generatedUtc = '2026-06-15T00:00:00Z',
		ageSeconds = 12,
		isStale = false,
		nearMeOrigin = null,
		nearbyStops = [],
		isDesktop = true,
		detailOpen = false,
		liveEdgeState = null,
		liveEdgeMessage = null,
		hoverDetail = null,
		hoverVehicleAbsence = null,
		onstopselect = () => {},
		onselect = () => {},
		onfilter = () => {},
		onalertselect = () => {},
	}: Props = $props();

	const t = $derived(MAP_COPY[locale]);

	let nearMeOpen = $state(false);
	let nearMeQuery = $state('');
</script>

{#snippet motionHeader()}
	<MapMotionControl {locale} copy={t} />
{/snippet}
{#snippet mapControls(opts?: { collapsible?: boolean; onselect?: () => void })}
	<MapFilters
		{store}
		{locale}
		{routes}
		{stops}
		collapsible={opts?.collapsible ?? true}
		controlsMode={true}
		header={motionHeader}
		onselect={opts?.onselect}
	/>
{/snippet}

<MapOverlayChrome
	{locale}
	{t}
	{generatedUtc}
	{ageSeconds}
	{isStale}
	bind:nearMeOpen
	bind:nearMeQuery
	nearMeLoading={false}
	nearMeError={null}
	{nearMeOrigin}
	{nearbyStops}
	onuselocation={() => {}}
	onsearch={() => {}}
	onsuggestion={() => {}}
	{onstopselect}
	onclear={() => {}}
	{isDesktop}
	filtersStore={store}
	{detailOpen}
	{liveEdgeState}
	{liveEdgeMessage}
	{hoverDetail}
	{hoverVehicleAbsence}
	{onselect}
	{onfilter}
	{onalertselect}
	controls={mapControls}
/>

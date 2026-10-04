<script lang="ts">
	import type { FilterStore } from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import type { RouteIndexEntry, StopIndexEntry } from '$lib/v1';
	import { setV1Context } from '$lib/v1/boot';
	import { ManifestSchema } from '$lib/v1/schemas';
	import type { LatLon, WithDistance } from '$lib/components/map';
	import type { GeocodePrecision } from '$lib/geocode/types';
	import type { MapHoverPeek } from '../mapHoverPeek';
	import MapFilters from '../MapFilters.svelte';
	import MapMotionControl from '../MapMotionControl.svelte';
	import MapOverlayChrome from '../MapOverlayChrome.svelte';
	import { mapCopy } from '../map.copy';

	type NearMeOrigin = LatLon & { label: string; precision?: GeocodePrecision };

	interface Props {
		store: FilterStore;
		locale: Locale;
		routes?: readonly RouteIndexEntry[];
		stops?: readonly StopIndexEntry[];
		generatedUtc?: string | null;
		ageSeconds?: number | null;
		isStale?: boolean;
		degraded?: boolean;
		selectedFamilyFailureMessage?: string | null;
		nearMeOrigin?: NearMeOrigin | null;
		nearbyStops?: readonly WithDistance<StopIndexEntry>[];
		isDesktop?: boolean;
		detailOpen?: boolean;
		liveEdgeState?: 'unavailable' | 'no-vehicles' | null;
		liveEdgeMessage?: string | null;
		hoverPeek?: MapHoverPeek | null;
		onstopselect?: (stop: WithDistance<StopIndexEntry>) => void;
	}

	let {
		store,
		locale,
		routes = [],
		stops = [],
		generatedUtc = '2026-06-15T00:00:00Z',
		ageSeconds = 12,
		isStale = false,
		degraded = false,
		selectedFamilyFailureMessage = null,
		nearMeOrigin = null,
		nearbyStops = [],
		isDesktop = true,
		detailOpen = false,
		liveEdgeState = null,
		liveEdgeMessage = null,
		hoverPeek = null,
		onstopselect = () => {},
	}: Props = $props();

	const manifest = ManifestSchema.parse({
		provider: 'stm',
		display_name: 'STM',
		city: 'Montréal',
		tz: 'America/Toronto',
		bbox: [-74.2, 45.2, -73.2, 45.9],
		attribution: 'Fixture',
		dataset_version: 'fixture',
		labels: {},
		files: { live: { generated_utc: '2026-06-15T00:00:00Z' } },
		surfaces: [],
	});
	setV1Context(() => ({ manifest, labels: {}, lang: locale }));
	const t = $derived(mapCopy(locale, 'Montréal'));

	let nearMeOpen = $state(false);
	let nearMeQuery = $state('');
</script>

{#snippet motionHeader()}
	<MapMotionControl {locale} copy={t} />
{/snippet}
{#snippet mapControls(opts?: { collapsible?: boolean })}
	<MapFilters
		{store}
		{locale}
		{routes}
		{stops}
		collapsible={opts?.collapsible ?? true}
		controlsMode={true}
		header={motionHeader}
	/>
{/snippet}

<MapOverlayChrome
	{locale}
	{t}
	{generatedUtc}
	{ageSeconds}
	{isStale}
	{degraded}
	{selectedFamilyFailureMessage}
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
	{hoverPeek}
	controls={mapControls}
/>

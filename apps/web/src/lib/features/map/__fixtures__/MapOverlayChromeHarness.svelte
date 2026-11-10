<script lang="ts">
	import type { LivePresentation } from '#lib/v1/live/livePresentation.ts';
	import { presentationFixture } from '#lib/v1/live/__fixtures__/presentation.ts';
	import type { FilterStore } from '#lib/filters/index.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import type { RouteIndexEntry, StopIndexEntry } from '#lib/v1/index.ts';
	import { setV1Context } from '#lib/v1/boot.ts';
	import { ManifestSchema } from '#lib/v1/schemas/index.ts';
	import type { LatLon, WithDistance } from '#lib/components/map/index.ts';
	import type { GeocodePrecision } from '#lib/geocode/types.ts';
	import type { MapHoverPeek } from '../mapHoverPeek';
	import type { MapSelection } from '../selectionSession/mapSelection';
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
		presentation?: LivePresentation;
		nearMeOrigin?: NearMeOrigin | null;
		nearbyStops?: readonly WithDistance<StopIndexEntry>[];
		isDesktop?: boolean;
		detailOpen?: boolean;
		hoverPeek?: MapHoverPeek | null;
		detailSelection?: MapSelection | null;
		onstopselect?: (stop: WithDistance<StopIndexEntry>) => void;
	}

	let {
		store,
		locale,
		routes = [],
		stops = [],
		presentation = presentationFixture(),
		nearMeOrigin = null,
		nearbyStops = [],
		isDesktop = true,
		detailOpen = false,
		hoverPeek = null,
		detailSelection = null,
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
	{presentation}
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
	{hoverPeek}
	{detailSelection}
	controls={mapControls}
/>

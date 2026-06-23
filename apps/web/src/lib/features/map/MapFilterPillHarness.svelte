<!--
  Test-only harness for MapFilterPill — wires the REAL unified Controls snippet
  (MapFilters in controlsMode + the inline MapMotionControl header) into the pill
  exactly as MapHero does, so the drawer-renders-the-shared-controls contract can
  be asserted without standing up the whole MapHero. Not a route component; it
  exists purely to give MapFilterPill.svelte.test.ts a real `controls` snippet.
-->
<script lang="ts">
	import type { FilterStore } from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import type { RouteIndexEntry, StopIndexEntry } from '$lib/v1';
	import MapFilters from './MapFilters.svelte';
	import MapFilterPill from './MapFilterPill.svelte';
	import MapMotionControl from './MapMotionControl.svelte';
	import { copy as MAP_COPY } from './map.copy';

	interface Props {
		store: FilterStore;
		locale: Locale;
		routes?: readonly RouteIndexEntry[];
		stops?: readonly StopIndexEntry[];
		hidden?: boolean;
	}

	let { store, locale, routes = [], stops = [], hidden = false }: Props = $props();
	const t = $derived(MAP_COPY[locale]);
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

<MapFilterPill {store} {locale} {hidden} controls={mapControls} />

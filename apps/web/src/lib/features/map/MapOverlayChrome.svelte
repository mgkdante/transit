<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import type { FilterStore } from '$lib/filters';
	import type { LatLon, WithDistance } from '$lib/components/map';
	import type { GeocodePrecision, GeocodeSuggestion } from '$lib/geocode/types';
	import type { StopIndexEntry } from '$lib/v1/schemas';
	import type { MapCopy } from './map.copy';
	import type { MapHoverPeek as MapHoverPeekModel } from './mapHoverPeek';
	import MapHeadTitle from './MapHeadTitle.svelte';
	import MapNearMeControl from './MapNearMeControl.svelte';
	import MapFilterPill from './MapFilterPill.svelte';
	import MapFreshness from './MapFreshness.svelte';
	import MapFeedStallBanner, { deriveMapFeedBannerState } from './MapFeedStallBanner.svelte';
	import MapHoverPeek from './MapHoverPeek.svelte';

	type NearMeOrigin = LatLon & { label: string; precision?: GeocodePrecision };

	interface Props {
		locale: Locale;
		t: MapCopy;
		generatedUtc: string | null;
		ageSeconds: number | null;
		isStale: boolean;
		degraded?: boolean;
		selectedFamilyFailureMessage?: string | null;
		nearMeOpen: boolean;
		nearMeQuery: string;
		nearMeLoading: boolean;
		nearMeError: string | null;
		nearMeOrigin: NearMeOrigin | null;
		nearbyStops: readonly WithDistance<StopIndexEntry>[];
		onuselocation: () => void;
		onsearch: (event: SubmitEvent) => void | Promise<void>;
		onsuggestion: (result: GeocodeSuggestion) => void | Promise<void>;
		onstopselect: (stop: WithDistance<StopIndexEntry>) => void;
		onclear: () => void;
		isDesktop: boolean;
		filtersStore: FilterStore;
		detailOpen: boolean;
		liveEdgeState: 'unavailable' | 'no-vehicles' | null;
		liveEdgeMessage: string | null;
		hoverPeek: MapHoverPeekModel | null;
		controls: Snippet<[{ collapsible?: boolean } | undefined]>;
	}

	let {
		locale,
		t,
		generatedUtc,
		ageSeconds,
		isStale,
		degraded = false,
		selectedFamilyFailureMessage = null,
		nearMeOpen = $bindable(),
		nearMeQuery = $bindable(),
		nearMeLoading,
		nearMeError,
		nearMeOrigin,
		nearbyStops,
		onuselocation,
		onsearch,
		onsuggestion,
		onstopselect,
		onclear,
		isDesktop,
		filtersStore,
		detailOpen,
		liveEdgeState,
		liveEdgeMessage,
		hoverPeek,
		controls,
	}: Props = $props();

	let desktopControlsMounted = $state(false);
	$effect(() => {
		if (isDesktop) desktopControlsMounted = true;
	});

	const feedBannerState = $derived(
		deriveMapFeedBannerState({
			selectedFamilyFailureMessage,
			isStale,
			liveEdgeState,
			liveEdgeMessage,
		}),
	);
	const ageLabel = $derived(feedBannerState === 'global-stall' ? t.feedNotRespondingShort : null);
</script>

<div
	data-slot="map-freshness-owner"
	data-active-placement={isDesktop ? 'floating' : 'head'}
	data-not-responding={ageLabel ? 'true' : 'false'}
>
	<MapHeadTitle
		{locale}
		kicker={t.kicker}
		heading={t.heading}
		{generatedUtc}
		{ageSeconds}
		{ageLabel}
		{isStale}
		{degraded}
	/>
	<MapFreshness
		placement="floating"
		{generatedUtc}
		{ageSeconds}
		{ageLabel}
		{isStale}
		{degraded}
		{locale}
	/>
</div>

<MapNearMeControl
	bind:open={nearMeOpen}
	bind:query={nearMeQuery}
	{locale}
	copy={t}
	loading={nearMeLoading}
	error={nearMeError}
	origin={nearMeOrigin}
	stops={nearbyStops}
	{onuselocation}
	{onsearch}
	{onsuggestion}
	{onstopselect}
	{onclear}
/>

{#if isDesktop || desktopControlsMounted}
	<div class="map-overlay map-filter-panel">
		{@render controls(undefined)}
	</div>
{/if}

<MapFilterPill store={filtersStore} {locale} hidden={detailOpen} {controls} />

<MapFeedStallBanner
	{generatedUtc}
	{ageSeconds}
	{isStale}
	{locale}
	{selectedFamilyFailureMessage}
	{liveEdgeState}
	{liveEdgeMessage}
	state={feedBannerState}
/>

{#if hoverPeek && isDesktop && !nearMeOpen}
	<div class="map-overlay map-peek">
		<MapHoverPeek peek={hoverPeek} {locale} />
	</div>
{/if}

<style>
	.map-overlay {
		position: absolute;
		z-index: var(--z-map-overlay);
	}
	.map-filter-panel {
		top: calc(var(--chrome-offset) + 4rem);
		left: calc(var(--app-left-rail-offset, 0rem) + 1rem);
	}

	.map-peek {
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		bottom: var(--map-near-clearance, 8.6rem);
		z-index: var(--z-map-detail);
		max-width: min(
			20rem,
			calc(100% - var(--map-detail-offset, 0rem) - var(--app-left-rail-offset, 0rem) - 18rem)
		);
		padding: 0.875rem;
		background: color-mix(in srgb, var(--card) 92%, transparent);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(12px) saturate(1.1);
		-webkit-backdrop-filter: blur(12px) saturate(1.1);
		pointer-events: none;
	}
	.map-peek :global(.map-hover-peek) {
		min-width: 0;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.mf-chip) {
			transition: none;
		}
	}

	@media (max-width: 1023.98px) {
		.map-filter-panel {
			display: none;
		}
		.map-peek {
			display: none;
		}
	}
</style>

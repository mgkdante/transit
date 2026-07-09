<!--
  MapOverlayChrome — the desktop floating chrome layer that lives inside .map-surface.

  SINGLE RESPONSIBILITY: compose every floating overlay that rides over the canvas —
  the title (MapHeadTitle), the near-me control, the desktop Controls panel (the
  shared `controls` snippet), the floating freshness chip, the feed-stall banner,
  the live-edge notice, and the desktop hover peek. ZERO state mutation: every
  handler + snippet is passed in by the orchestrator (MapHero), which owns all the
  state. The right-edge chrome reads --map-detail-offset so it clears the open
  detail overlay. Owns the scoped CSS for the overlays it places (filter panel,
  peek, live-edge, the reduced-motion .mf-chip rule, and the mobile panel/peek
  hides). The .map-surface container itself stays in MapHero; this renders INSIDE it.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import type { FilterStore, Chip } from '$lib/filters';
	import type { LatLon, WithDistance } from '$lib/components/map';
	import type { GeocodePrecision, GeocodeSuggestion } from '$lib/geocode/types';
	import type { StopIndexEntry, Alert } from '$lib/v1/schemas';
	import type { MapCopy } from './map.copy';
	import type { MapSelection } from './mapSelection';
	import type { MapSelectionDetail as MapSelectionDetailModel } from './mapSelection';
	import MapHeadTitle from './MapHeadTitle.svelte';
	import MapNearMeControl from './MapNearMeControl.svelte';
	import MapFilterPill from './MapFilterPill.svelte';
	import MapFreshness from './MapFreshness.svelte';
	import MapFeedStallBanner from './MapFeedStallBanner.svelte';
	import MapSelectionDetail from './MapSelectionDetail.svelte';

	type NearMeOrigin = LatLon & { label: string; precision?: GeocodePrecision };

	interface Props {
		locale: Locale;
		t: MapCopy;
		// Live-store reads for the head + floating freshness + feed-stall chips.
		generatedUtc: string | null;
		ageSeconds: number | null;
		isStale: boolean;
		// Near-me surface — state (bindable open/query) + handlers, owned by MapHero.
		nearMeOpen: boolean;
		nearMeQuery: string;
		nearMeLoading: boolean;
		nearMeError: string | null;
		nearMeOrigin: NearMeOrigin | null;
		nearbyStops: readonly WithDistance<StopIndexEntry>[];
		onuselocation: () => void;
		onsearch: (event: SubmitEvent) => void | Promise<void>;
		onsuggestion: (result: GeocodeSuggestion, sessionToken: string) => void | Promise<void>;
		onstopselect: (stop: WithDistance<StopIndexEntry>) => void;
		onclear: () => void;
		// Layout snapshot — gates the desktop-only hover peek.
		isDesktop: boolean;
		// Filter spine — drives the mobile MapFilterPill count + the detailOpen hide.
		filtersStore: FilterStore;
		detailOpen: boolean;
		// Live-edge notice.
		liveEdgeState: 'unavailable' | 'no-vehicles' | null;
		liveEdgeMessage: string | null;
		// Hover peek detail + its honest-null per-bus note.
		hoverDetail: MapSelectionDetailModel | null;
		hoverVehicleAbsence: { ageS: number } | null;
		// Detail-derived handlers shared by the peek.
		onselect: (selection: MapSelection) => void;
		onfilter: (chip: Chip) => void;
		onalertselect: (alert: Alert) => void;
		// The unified Controls render contract (desktop panel + mobile drawer).
		controls: Snippet<[{ collapsible?: boolean; onselect?: () => void } | undefined]>;
	}

	let {
		locale,
		t,
		generatedUtc,
		ageSeconds,
		isStale,
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
		hoverDetail,
		hoverVehicleAbsence,
		onselect,
		onfilter,
		onalertselect,
		controls,
	}: Props = $props();
</script>

<MapHeadTitle
	{locale}
	kicker={t.kicker}
	heading={t.heading}
	{generatedUtc}
	{ageSeconds}
	{isStale}
/>

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

<!-- Left: the unified Controls panel (URL-driven filters + the motion toggle).
     The motion-mode switch (raw vs almost-real-time, bound to the motionMode
     store) is pinned to the TOP of the panel via the shared `mapControls`
     snippet; the combinable state filters sit below. Desktop renders it here;
     mobile renders the SAME snippet inside MapFilterPill's drawer (one source
     of truth, no divergent call sites). There is no separate floating chip,
     so nothing reflows when the toggle swaps raw⇄smooth. -->
<div class="map-overlay map-filter-panel">
	{@render controls(undefined)}
</div>

<MapFilterPill store={filtersStore} {locale} hidden={detailOpen} {controls} />

<MapFreshness placement="floating" {generatedUtc} {ageSeconds} {isStale} {locale} />

<!-- Feed-stall banner: a calm top-of-map caution shown ONLY when the WHOLE live
     feed has genuinely stalled (live.isStale — age past the 3x-ttl budget). The
     pipeline stamps every vehicle's updated_utc with the uniform snapshot capture
     time, so THIS banner is a GLOBAL feed signal, never one stuck bus — which is why
     the per-vehicle silence FADE (that keyed off the uniform updated_utc) was
     dropped. A per-bus not-reporting "!" badge was RE-ADDED, but off each bus's OWN
     reported_utc (its GTFS-RT GPS fix time), which IS per-vehicle — see liveTtl /
     toVehicleFeatures. Informational (a polite status), non-blocking, absent in
     normal operation. -->
<MapFeedStallBanner {generatedUtc} {ageSeconds} {isStale} {locale} />

<!-- Live-feed edge notice: a small, non-blocking pill centred near the top of
     the canvas when the live feed is unreachable or currently has no vehicles.
     It floats OVER the map (pointer-events: none) so the basemap, stops, and
     near-me stay fully usable; it is not a boundary and never blanks the canvas. -->
{#if liveEdgeMessage}
	<div
		class="map-overlay map-live-edge"
		data-state={liveEdgeState}
		role="status"
		aria-live="polite"
	>
		{liveEdgeMessage}
	</div>
{/if}

{#if hoverDetail && isDesktop}
	<div class="map-overlay map-peek" aria-live="polite">
		<MapSelectionDetail
			detail={hoverDetail}
			{locale}
			compact
			notReporting={hoverVehicleAbsence}
			{onselect}
			{onfilter}
			{onalertselect}
		/>
	</div>
{/if}

<style>
	.map-overlay {
		position: absolute;
		z-index: var(--z-map-overlay);
	}
	.map-filter-panel {
		/* Below the chrome (--chrome-offset knob) + the title band, matching the
		   original ~66px offset from the title top. */
		top: calc(var(--chrome-offset) + 4rem);
		left: calc(var(--app-left-rail-offset, 0rem) + 1rem);
	}

	.map-peek {
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		bottom: 1.15rem;
		z-index: var(--z-map-detail);
		max-width: min(20rem, calc(100% - 2rem));
		padding: 0.875rem;
		background: color-mix(in srgb, var(--card) 92%, transparent);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		/* Map GL escape hatch (§C4 P4): blur(12px) — the card is ~92% opaque so the
		   blur barely shows; kept modest since this peek floats over the constantly-
		   repainting live canvas where a heavier blur is pure compositing cost. */
		backdrop-filter: blur(12px) saturate(1.1);
		-webkit-backdrop-filter: blur(12px) saturate(1.1);
		pointer-events: none;
	}
	/* Live-feed edge notice: a calm, centred pill near the top of the canvas. Token-
	   driven (card surface + hairline + blur, like the rest of the floating chrome),
	   non-interactive (it states a fact; it does not block the map). Centred between
	   the left rail and the right detail offset so it never hides behind a pane. */
	.map-live-edge {
		/* Clears the floating chrome via the single --chrome-offset knob. */
		top: var(--chrome-offset);
		left: calc(var(--app-left-rail-offset, 0rem) / 2 + var(--map-detail-offset, 0rem) / 2);
		right: 0;
		margin-inline: auto;
		z-index: var(--z-map-filter);
		width: max-content;
		max-width: min(26rem, calc(100% - 2rem));
		padding: 0.375rem 0.875rem;
		text-align: center;
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--card) 88%, transparent);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		/* Map GL escape hatch (§C4 P4): blur(12px), floats over the live canvas. */
		backdrop-filter: blur(12px) saturate(1.1);
		-webkit-backdrop-filter: blur(12px) saturate(1.1);
		pointer-events: none;
	}
	/* The feed-down state warms the WHOLE border with the caution hue (a data verdict),
	   echoing the stale-freshness chrome; the text still carries the meaning. */
	.map-live-edge[data-state='unavailable'] {
		border-color: color-mix(in srgb, var(--dataviz-status-late) 48%, var(--border-rule) 52%);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.mf-chip) {
			transition: none;
		}
	}

	/* Below the single map breakpoint (1024px = layout.isDesktop) the unified
	   Controls panel hides and the floating Controls pill takes over (it gates
	   itself to < 1024px). Keeping the panel-hide on the SAME 1024 line as the
	   pill-hide and the JS `layout.isDesktop` snapshot means all three agree — no
	   dead 760px band where the panel and pill could both show or both vanish.
	   .map-peek is already `layout.isDesktop`-gated in markup; the hide here is
	   belt-and-braces. */
	@media (max-width: 1023.98px) {
		.map-filter-panel {
			display: none;
		}
		.map-peek {
			display: none;
		}
	}
</style>

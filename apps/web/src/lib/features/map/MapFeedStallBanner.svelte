<!--
  MapFeedStallBanner — the map's one live announcement owner.

  Always mounted, empty at rest, and prioritized:
  selected-family failure > global stall > live edge. The global stall still
  means the oldest active retained generation crossed the 3x-ttl budget. Vehicle
  motion uses its own vehicles-only staleness and is not controlled here.

  Calm CAUTION, not alarm: it is informational (role="status" + aria-live=polite,
  NOT alert), states a fact, and the rest of the map (basemap, stops, near-me)
  stays fully usable behind it (pointer-events: none). It mirrors the stale
  freshness chrome — the caution hue warms the border; the text carries meaning.

  The global-stall age comes from the SAME aggregate freshness the floating
  freshness chip uses (generatedUtc + the ticking ageSeconds), formatted through
  the shared relative-time helper so it reads "2 minutes ago" / "il y a 2 minutes"
  and ticks in lockstep with the rest of the chrome.
-->
<script lang="ts" module>
	export type MapFeedBannerState =
		| 'selected-family-failure'
		| 'global-stall'
		| 'unavailable'
		| 'no-vehicles'
		| 'idle';

	export function deriveMapFeedBannerState({
		selectedFamilyFailureMessage,
		isStale,
		liveEdgeState,
		liveEdgeMessage,
	}: {
		selectedFamilyFailureMessage: string | null;
		isStale: boolean;
		liveEdgeState: 'unavailable' | 'no-vehicles' | null;
		liveEdgeMessage: string | null;
	}): MapFeedBannerState {
		if (selectedFamilyFailureMessage) return 'selected-family-failure';
		if (isStale) return 'global-stall';
		if (liveEdgeMessage && liveEdgeState) return liveEdgeState;
		return 'idle';
	}
</script>

<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ageSeconds as ageFromUtc, formatRelativeSeconds } from '$lib/utils/time';
	import { sharedClock } from '$lib/stores';
	import { copy as MAP_COPY } from './map.copy';

	interface Props {
		/** ISO 8601 (UTC) timestamp of the last live build, or null when unknown. */
		generatedUtc: string | null;
		/**
		 * Pre-computed ticking age in seconds from the live store. OPTIONAL — when
		 * omitted the banner derives the age itself from `generatedUtc` off the
		 * shared clock (so the readout still ticks).
		 */
		ageSeconds?: number | null;
		/** True once the whole live feed is past its freshness budget. */
		isStale: boolean;
		/** UI language for the intrinsic label. */
		locale: Locale;
		/** Highest-priority selected-family failure, already localized. */
		selectedFamilyFailureMessage?: string | null;
		/** Lowest-priority live-edge recovery/absence state. */
		liveEdgeState?: 'unavailable' | 'no-vehicles' | null;
		/** Lowest-priority live-edge recovery/absence message. */
		liveEdgeMessage?: string | null;
		/** Shared precedence result supplied by MapOverlayChrome. */
		state?: MapFeedBannerState;
	}

	let {
		generatedUtc,
		ageSeconds = undefined,
		isStale,
		locale,
		selectedFamilyFailureMessage = null,
		liveEdgeState = null,
		liveEdgeMessage = null,
		state = undefined,
	}: Props = $props();

	const t = $derived(MAP_COPY[locale]);

	// Keep the shared clock alive while the banner is on screen so the relative
	// age ticks in lockstep with every other time label in the chrome.
	$effect(() => sharedClock.subscribe());

	// The effective age: the live store's ticking age wins; otherwise derive it
	// from generatedUtc off the shared SERVER clock. Both re-derive every tick.
	const effectiveAge = $derived<number | null>(
		ageSeconds !== undefined
			? ageSeconds
			: generatedUtc
				? (() => {
						const age = ageFromUtc(generatedUtc, sharedClock.serverNow);
						return Number.isNaN(age) ? null : Math.max(0, age);
					})()
				: null,
	);
	const relative = $derived(
		effectiveAge == null ? '' : formatRelativeSeconds(effectiveAge, locale),
	);
	const stallMessage = $derived(t.feedNotResponding(relative));
	const resolvedState = $derived(
		state ??
			deriveMapFeedBannerState({
				selectedFamilyFailureMessage,
				isStale,
				liveEdgeState,
				liveEdgeMessage,
			}),
	);
	const message = $derived(
		resolvedState === 'selected-family-failure'
			? (selectedFamilyFailureMessage ?? '')
			: resolvedState === 'global-stall'
				? stallMessage
				: resolvedState === 'idle'
					? ''
					: (liveEdgeMessage ?? ''),
	);
</script>

<!-- M1 #34: one stable live region owns every map-live announcement. Keeping it
     mounted makes priority changes update one assistive-technology surface. -->
<div
	class="map-overlay map-live-edge"
	class:map-feed-stall={resolvedState === 'global-stall'}
	data-slot={resolvedState === 'global-stall' ? 'map-feed-stall' : undefined}
	data-state={resolvedState}
	role="status"
	aria-live="polite"
>
	{message}
</div>

<style>
	.map-overlay {
		position: absolute;
		z-index: var(--z-map-overlay);
	}
	/* Shared top-centre announcement. Centred between the left rail and the right
	   detail offset
	   (the same offset the rest of the floating chrome tracks) so it never hides
	   behind a pane. Token-driven (card surface + hairline + blur, like the rest of
	   the floating chrome); non-interactive — it states a fact, it does not block
	   the map. Sits just below the floating freshness/edge row. */
	.map-live-edge {
		/* Below the floating chrome (--chrome-offset knob) + the edge row it trails. */
		top: var(--chrome-offset);
		left: calc(var(--app-left-rail-offset, 0rem) / 2 + var(--map-detail-offset, 0rem) / 2);
		right: 0;
		margin-inline: auto;
		z-index: var(--z-map-banner-content);
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
	.map-live-edge[data-state='idle'] {
		width: 0;
		max-width: 0;
		padding: 0;
		border: 0;
		box-shadow: none;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}
	.map-live-edge[data-state='unavailable'],
	.map-live-edge[data-state='selected-family-failure'],
	.map-live-edge[data-state='global-stall'] {
		border-color: color-mix(in srgb, var(--dataviz-status-late) 48%, var(--border-rule) 52%);
	}
	.map-feed-stall {
		top: calc(var(--chrome-offset) + 2.5rem);
	}

	/* M6f-2 F14: the banner used to sit ON the control row's own anchor
	   (--map-mobile-control-bottom, left 0.75rem) — the controls peel's exact
	   origin — which only worked because the peel was being hidden. The peel now
	   survives a stall, so the banner STACKS ABOVE the row: one 44px control
	   height plus the 10px gap this file already uses. Clear of both peels, it
	   spans the full row width instead of dodging near-me. */
	@media (max-width: 1023.98px) {
		.map-feed-stall {
			top: auto;
			bottom: calc(var(--map-mobile-control-bottom) + 44px + 10px);
			left: 0.75rem;
			right: 0.75rem;
			margin-inline: 0;
			width: auto;
			max-width: none;
		}
	}
</style>

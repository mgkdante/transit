<!--
  MapFeedStallBanner — top-of-map "live feed not responding" notice.

  Shown ONLY when the WHOLE live feed has genuinely stalled (`isStale` — the live
  store's age past its 3x-ttl budget, 90s at the 30s live ttl). The pipeline
  stamps every vehicle's `updated_utc` with the uniform snapshot capture time, so
  staleness is a GLOBAL snapshot-freshness signal: this banner can flag the whole
  feed going quiet, never one stuck bus. (That is why the former per-vehicle
  silence fade + per-bus "!" marker were removed — they could only ever express
  the same global signal, and flickered on normal poll jitter.)

  Calm CAUTION, not alarm: it is informational (role="status" + aria-live=polite,
  NOT alert), states a fact, and the rest of the map (basemap, stops, near-me)
  stays fully usable behind it (pointer-events: none). It mirrors the stale
  freshness chrome — the caution hue warms the border; the text carries meaning.

  The last-update age comes from the SAME live-store freshness the floating
  freshness chip uses (generatedUtc + the ticking ageSeconds), formatted through
  the shared relative-time helper so it reads "2 minutes ago" / "il y a 2 minutes"
  and ticks in lockstep with the rest of the chrome.
-->
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
	}

	let { generatedUtc, ageSeconds = undefined, isStale, locale }: Props = $props();

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
	const message = $derived(t.feedNotResponding(relative));
</script>

{#if isStale}
	<div
		class="map-overlay map-feed-stall"
		data-slot="map-feed-stall"
		role="status"
		aria-live="polite"
	>
		{message}
	</div>
{/if}

<style>
	.map-overlay {
		position: absolute;
		z-index: var(--z-map-overlay);
	}
	/* Top-CENTRE banner. Centred between the left rail and the right detail offset
	   (the same offset the rest of the floating chrome tracks) so it never hides
	   behind a pane. Token-driven (card surface + hairline + blur, like the rest of
	   the floating chrome); non-interactive — it states a fact, it does not block
	   the map. Sits just below the floating freshness/edge row. */
	.map-feed-stall {
		/* Below the floating chrome (--chrome-offset knob) + the edge row it trails. */
		top: calc(var(--chrome-offset) + 2.5rem);
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
		/* Calm caution: the whole border warms with the caution hue (a data verdict),
		   echoing the stale-freshness chrome — never an alarm red fill. */
		border: 1px solid color-mix(in srgb, var(--dataviz-status-late) 48%, var(--border-rule) 52%);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		/* Map GL escape hatch (§C4 P4): blur(12px), floats over the live canvas. */
		backdrop-filter: blur(12px) saturate(1.1);
		-webkit-backdrop-filter: blur(12px) saturate(1.1);
		pointer-events: none;
	}

	@media (max-width: 768px) {
		.map-feed-stall {
			top: auto;
			bottom: calc(8.5rem + env(safe-area-inset-bottom, 0px));
			left: 0.75rem;
			right: 0.75rem;
			margin-inline: 0;
			width: auto;
			max-width: none;
		}
	}
</style>

<!--
  MapHeadTitle — the top-left title block.

  SINGLE RESPONSIBILITY (pure presentation): a mono kicker overline + the
  head-placement freshness chip riding above a confident heading with the brand
  dot, anchored to the canvas edge by a hairline accent rule. Owns no map state;
  every value (locale, copy, freshness) is passed in. Rendered by MapOverlayChrome.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import MapFreshness from './MapFreshness.svelte';

	interface Props {
		locale: Locale;
		kicker: string;
		heading: string;
		generatedUtc: string | null;
		ageSeconds: number | null;
		isStale: boolean;
	}

	let { locale, kicker, heading, generatedUtc, ageSeconds, isStale }: Props = $props();
</script>

<!-- Top-left: map title. A mono kicker overline + live freshness ride above a
     confident heading; a hairline accent rule anchors the block to the edge. -->
<div class="map-overlay map-head">
	<div class="map-kicker-row">
		<p class="map-kicker">{kicker}</p>
		<MapFreshness placement="head" {generatedUtc} {ageSeconds} {isStale} {locale} />
	</div>
	<div class="map-title-row">
		<h1 class="map-heading">{heading}<span class="map-dot">.</span></h1>
	</div>
</div>

<style>
	.map-overlay {
		position: absolute;
		z-index: var(--z-map-overlay);
	}
	.map-head {
		/* Clears the floating chrome via the single --chrome-offset knob: the map
		   stage now starts at viewport top (chrome floats over it), so the title
		   parks below the chrome instead of the old fixed 60px-band assumption. */
		top: var(--chrome-offset);
		left: calc(var(--app-left-rail-offset, 0rem) + 1rem);
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		max-width: calc(
			100% - var(--app-left-rail-offset, 0rem) - var(--map-detail-offset, 0rem) - 2rem
		);
	}
	.map-kicker-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.map-kicker {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.map-title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.map-heading {
		margin: 0;
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-heading);
		letter-spacing: var(--tracking-tight);
		line-height: 0.95;
		color: var(--foreground);
		/* Faint legibility lift so the heading survives over busy basemap tiles;
		   the colour-mix keeps it theme-correct (dark halo on dark, light on light). */
		text-shadow: 0 1px 16px color-mix(in srgb, var(--background) 70%, transparent);
	}
	.map-dot {
		color: var(--primary);
	}

	@media (max-width: 1023.98px) {
		.map-head {
			/* Clear the floating chrome (single --chrome-offset knob) on mobile too. */
			top: var(--chrome-offset);
			left: 0.75rem;
			right: 0.75rem;
			max-width: calc(100% - 1.5rem);
		}
		.map-heading {
			font-size: var(--text-subheading);
		}
	}
</style>

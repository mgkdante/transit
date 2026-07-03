<!--
  MapFreshness — the map's positioning shell around the shared FreshnessStamp.

  The map is a full-bleed live surface, so its freshness readout floats over the
  canvas (desktop) or tucks into the kicker row (mobile) — positioning the chip
  can't do itself. This wrapper owns ONLY that placement chrome (the floating pill
  background, the right-offset that tracks the detail panel, the responsive
  head/floating swap); the readout itself is the site-wide FreshnessStamp
  (variant="live"), so the map shares the exact same chip as every other surface.

  Replaces the former MapLiveFreshness (which wrapped the now-removed LiveFreshness).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { FreshnessStamp } from '$lib/components/surface';

	interface Props {
		generatedUtc: string | null;
		ageSeconds: number | null;
		isStale: boolean;
		locale: Locale;
		placement: 'head' | 'floating';
	}

	let { generatedUtc, ageSeconds, isStale, locale, placement }: Props = $props();

	const hasFreshness = $derived(generatedUtc != null || ageSeconds != null);
</script>

{#if hasFreshness}
	<div class="map-freshness" data-placement={placement} data-stale={isStale}>
		<FreshnessStamp variant="live" {generatedUtc} {ageSeconds} {isStale} {locale} />
	</div>
{/if}

<style>
	.map-freshness[data-placement='head'] {
		display: none;
	}

	.map-freshness[data-placement='floating'] {
		position: absolute;
		z-index: var(--z-map-overlay);
		/* Clears the floating chrome via the single --chrome-offset knob. */
		top: var(--chrome-offset);
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		display: inline-flex;
		align-items: center;
		padding: 0.375rem 0.75rem 0.375rem 0.75rem;
		background: color-mix(in srgb, var(--card) 86%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 80%, var(--primary) 20%);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		/* Map GL escape hatch (§C4 P4): blur(12px), floats over the live canvas. */
		backdrop-filter: blur(12px) saturate(1.1);
		-webkit-backdrop-filter: blur(12px) saturate(1.1);
		transition:
			right var(--duration-normal) var(--ease-out),
			border-color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default);
	}

	/* Stale feed: warm the chrome with the caution hue so the at-rest border
	   echoes the dot's verdict — the inner dot/text still carry the meaning. */
	.map-freshness[data-placement='floating'][data-stale='true'] {
		border-color: color-mix(in srgb, var(--dataviz-status-late) 38%, var(--border) 62%);
		background: color-mix(in srgb, var(--dataviz-status-late) 7%, var(--card) 86%);
	}

	.map-freshness[data-placement='floating']:hover {
		border-color: color-mix(in srgb, var(--primary) 32%, var(--border) 68%);
	}

	.map-freshness[data-placement='floating'][data-stale='true']:hover {
		border-color: color-mix(in srgb, var(--dataviz-status-late) 52%, var(--border) 48%);
	}

	.map-freshness[data-placement='floating'] :global(.freshness-stamp) {
		gap: 0.375rem;
		font-size: var(--text-caption);
		line-height: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.map-freshness[data-placement='floating'] {
			transition: none;
		}
	}

	@media (max-width: 768px) {
		.map-freshness[data-placement='floating'] {
			display: none;
		}

		.map-freshness[data-placement='head'] {
			display: inline-flex;
			align-items: center;
			flex: none;
			gap: 0.25rem;
			margin-left: auto;
			padding: 0.25rem 0.5rem;
			font-size: var(--text-micro);
			line-height: 1;
			white-space: nowrap;
			background: color-mix(in srgb, var(--card) 90%, transparent);
			border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
			border-radius: var(--radius-pill);
			box-shadow: var(--shadow-card);
			/* Map GL escape hatch (§C4 P4): blur(12px), floats over the live canvas. */
			backdrop-filter: blur(12px) saturate(1.1);
			-webkit-backdrop-filter: blur(12px) saturate(1.1);
		}

		.map-freshness[data-placement='head'][data-stale='true'] {
			border-color: color-mix(in srgb, var(--dataviz-status-late) 40%, var(--border) 60%);
			background: color-mix(in srgb, var(--dataviz-status-late) 8%, var(--card) 90%);
		}

		.map-freshness[data-placement='head'] :global(.freshness-stamp) {
			gap: 0.375rem;
			font-size: var(--text-micro);
			line-height: 1;
		}

		.map-freshness[data-placement='head'] :global(.freshness-stamp-label) {
			letter-spacing: var(--tracking-eyebrow);
		}
	}
</style>

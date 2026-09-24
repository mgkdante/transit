<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import MapFreshness from './MapFreshness.svelte';

	interface Props {
		locale: Locale;
		kicker: string;
		heading: string;
		generatedUtc: string | null;
		ageSeconds: number | null;
		/** Replaces the relative age when the feed is not responding (M6f-2 F14). */
		ageLabel?: string | null;
		isStale: boolean;
		degraded?: boolean;
	}

	let {
		locale,
		kicker,
		heading,
		generatedUtc,
		ageSeconds,
		ageLabel = null,
		isStale,
		degraded = false,
	}: Props = $props();
</script>

<div class="map-overlay map-head">
	<div class="map-kicker-row">
		<p class="map-kicker">{kicker}</p>
		<MapFreshness
			placement="head"
			{generatedUtc}
			{ageSeconds}
			{ageLabel}
			{isStale}
			{degraded}
			{locale}
		/>
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
		align-self: flex-start;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.25rem 0.5rem;
		background: var(--card);
		border-radius: var(--radius-sm);
	}
	.map-heading {
		margin: 0;
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-heading);
		letter-spacing: var(--tracking-tight);
		line-height: 0.95;
		color: var(--foreground);
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
	@media (max-width: 1023.98px) {
		.map-title-row {
			order: -1;
		}
		.map-kicker {
			display: none;
		}
	}
</style>

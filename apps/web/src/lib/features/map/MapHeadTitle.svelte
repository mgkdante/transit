<script lang="ts">
	import type { StampPresentation } from '#lib/v1/live/livePresentation.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import MapFreshness from './MapFreshness.svelte';

	interface Props {
		locale: Locale;
		heading: string;
		presentation: StampPresentation;
	}

	let { locale, heading, presentation }: Props = $props();
</script>

<div class="map-overlay map-head">
	<div class="map-title-row">
		<h1 class="map-heading">{heading}<span class="map-dot">.</span></h1>
	</div>
	<MapFreshness placement="head" {presentation} {locale} />
</div>

<style>
	.map-overlay {
		position: absolute;
		z-index: var(--z-map-overlay);
	}
	.map-head {
		top: var(--chrome-offset);
		left: calc(var(--app-left-rail-offset, 0rem) + 1rem);
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		max-width: calc(
			100% - var(--app-left-rail-offset, 0rem) - var(--map-detail-offset, 0rem) - 2rem
		);
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

	@media (--desktop-max) {
		.map-head {
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

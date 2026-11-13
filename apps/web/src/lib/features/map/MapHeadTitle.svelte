<script lang="ts">
	import type { StampPresentation } from '#lib/v1/live/livePresentation.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import MapFreshness from './MapFreshness.svelte';

	interface Props {
		locale: Locale;
		heading: string;
		/** What colour and shape mean. Below desktop width the legend's first line carries it. */
		lead: string;
		presentation: StampPresentation;
		/** Rendered height of the title block, so the controls below it can clear it. */
		height?: number;
	}

	let { locale, heading, lead, presentation, height = $bindable(0) }: Props = $props();
</script>

<div class="map-overlay map-head" bind:offsetHeight={height}>
	<MapFreshness placement="head" {presentation} {locale} />
	<div class="map-title-row">
		<h1 class="map-heading">{heading}<span class="map-dot">.</span></h1>
	</div>
	<p class="map-lead" data-slot="map-lead">{lead}</p>
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
	/* The controls column is 300px wide; the line stays inside it, clear of the centred banners. */
	.map-lead {
		align-self: flex-start;
		max-width: 300px;
		margin: 0;
		padding: 0.25rem 0.5rem;
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
		background: var(--card);
		border-radius: var(--radius-sm);
	}

	@media (--desktop-max) {
		.map-head {
			top: var(--chrome-offset);
			left: auto;
			right: 0.75rem;
			width: fit-content;
			max-width: calc(100% - 1.5rem);
			align-items: flex-end;
			gap: 0.5rem;
		}
		.map-title-row,
		.map-head > :global(.map-freshness[data-placement='head']) {
			align-self: flex-end;
			max-width: 100%;
			padding: 0.625rem 0.75rem;
			background: color-mix(in srgb, var(--card) 92%, transparent);
			border: 1px solid var(--border-hairline);
			border-radius: var(--radius-md);
			box-shadow: var(--shadow-card);
			-webkit-backdrop-filter: blur(var(--glass-blur-sm));
			backdrop-filter: blur(var(--glass-blur-sm));
		}
		.map-title-row {
			justify-content: flex-end;
			text-align: right;
		}
		.map-heading {
			font-size: var(--text-subheading);
		}
		.map-lead {
			display: none;
		}
	}
</style>

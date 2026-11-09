<script lang="ts">
	import type { LivePresentation } from '#lib/v1/live/livePresentation.ts';
	let { presentation }: { presentation: LivePresentation } = $props();
	const resolvedState = $derived(presentation.bannerState);
</script>

<div
	class="map-overlay map-live-edge"
	class:map-feed-stall={resolvedState === 'global-stall' || resolvedState === 'partial-stall'}
	data-slot={resolvedState === 'global-stall' || resolvedState === 'partial-stall'
		? 'map-feed-stall'
		: undefined}
	data-state={resolvedState}
	role="status"
	aria-live="polite"
>
	{presentation.notice.message}
</div>

<style>
	.map-overlay {
		position: absolute;
		z-index: var(--z-map-overlay);
	}
	.map-live-edge {
		top: calc(var(--chrome-offset) + 2.5rem);
		left: calc(var(--app-left-rail-offset, 0rem) + 18rem);
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		margin-inline: auto;
		z-index: var(--z-map-banner-content);
		width: max-content;
		max-width: min(
			26rem,
			calc(100% - var(--app-left-rail-offset, 0rem) - var(--map-detail-offset, 0rem) - 19rem)
		);
		padding: 0.375rem 0.875rem;
		text-align: center;
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--card) 88%, transparent);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		-webkit-backdrop-filter: blur(var(--glass-blur-sm));
		backdrop-filter: blur(var(--glass-blur-sm));
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
	@media (--desktop-max) {
		.map-live-edge:is(
			[data-state='unavailable'],
			[data-state='selected-family-failure'],
			[data-state='no-vehicles']
		) {
			top: calc(var(--chrome-offset) + 4rem);
			left: 0.75rem;
			right: 0.75rem;
			margin-inline: 0;
			width: auto;
			max-width: none;
		}
		.map-feed-stall {
			top: auto;
			/* Above the collapsed map credits (24px), which sit one control row up. */
			bottom: calc(var(--map-mobile-control-bottom) + 2.75rem + 0.75rem + 24px + 10px);
			left: 0.75rem;
			right: 0.75rem;
			margin-inline: 0;
			width: auto;
			max-width: none;
		}
	}
</style>

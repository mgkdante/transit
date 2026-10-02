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
		generatedUtc: string | null;
		ageSeconds?: number | null;
		isStale: boolean;
		locale: Locale;
		selectedFamilyFailureMessage?: string | null;
		liveEdgeState?: 'unavailable' | 'no-vehicles' | null;
		liveEdgeMessage?: string | null;
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

	$effect(() => sharedClock.subscribe());

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
	@media (max-width: 1023.98px) {
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
			bottom: calc(var(--map-mobile-control-bottom) + 44px + 10px);
			left: 0.75rem;
			right: 0.75rem;
			margin-inline: 0;
			width: auto;
			max-width: none;
		}
	}
</style>

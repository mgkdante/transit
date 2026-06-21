<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { LiveFreshness } from '$lib/components/surface';

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
	<div class="map-live-freshness" data-placement={placement} data-stale={isStale}>
		<LiveFreshness {generatedUtc} {ageSeconds} {isStale} {locale} />
	</div>
{/if}

<style>
	.map-live-freshness[data-placement='head'] {
		display: none;
	}

	.map-live-freshness[data-placement='floating'] {
		position: absolute;
		z-index: 10;
		top: 1rem;
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		display: inline-flex;
		align-items: center;
		padding: 0.4rem 0.75rem 0.4rem 0.7rem;
		background: color-mix(in srgb, var(--card) 86%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 80%, var(--primary) 20%);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(10px) saturate(1.1);
		transition:
			right 180ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
			border-color var(--duration-fast, 150ms) var(--ease-default, cubic-bezier(0.4, 0, 0.2, 1)),
			background-color var(--duration-fast, 150ms) var(--ease-default, cubic-bezier(0.4, 0, 0.2, 1));
	}

	/* Stale feed: warm the chrome with the caution hue so the at-rest border
	   echoes the dot's verdict — the inner dot/text still carry the meaning. */
	.map-live-freshness[data-placement='floating'][data-stale='true'] {
		border-color: color-mix(in srgb, var(--dataviz-status-late) 38%, var(--border) 62%);
		background: color-mix(in srgb, var(--dataviz-status-late) 7%, var(--card) 86%);
	}

	.map-live-freshness[data-placement='floating']:hover {
		border-color: color-mix(in srgb, var(--primary) 32%, var(--border) 68%);
	}

	.map-live-freshness[data-placement='floating'][data-stale='true']:hover {
		border-color: color-mix(in srgb, var(--dataviz-status-late) 52%, var(--border) 48%);
	}

	.map-live-freshness[data-placement='floating'] :global(.live-freshness) {
		gap: 0.45rem;
		font-size: var(--text-caption);
		line-height: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.map-live-freshness[data-placement='floating'] {
			transition: none;
		}
	}

	@media (max-width: 760px) {
		.map-live-freshness[data-placement='floating'] {
			display: none;
		}

		.map-live-freshness[data-placement='head'] {
			display: inline-flex;
			align-items: center;
			flex: none;
			gap: 0.25rem;
			margin-left: auto;
			padding: 0.24rem 0.5rem;
			font-size: var(--text-micro);
			line-height: 1;
			white-space: nowrap;
			background: color-mix(in srgb, var(--card) 90%, transparent);
			border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
			border-radius: var(--radius-pill);
			box-shadow: var(--shadow-card);
			backdrop-filter: blur(8px) saturate(1.1);
		}

		.map-live-freshness[data-placement='head'][data-stale='true'] {
			border-color: color-mix(in srgb, var(--dataviz-status-late) 40%, var(--border) 60%);
			background: color-mix(in srgb, var(--dataviz-status-late) 8%, var(--card) 90%);
		}

		.map-live-freshness[data-placement='head'] :global(.live-freshness) {
			gap: 0.3rem;
			font-size: var(--text-micro);
			line-height: 1;
		}

		.map-live-freshness[data-placement='head'] :global(.live-freshness-label) {
			letter-spacing: var(--tracking-eyebrow);
		}
	}
</style>

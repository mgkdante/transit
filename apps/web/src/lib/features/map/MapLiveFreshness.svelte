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
	<div class="map-live-freshness" data-placement={placement}>
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
		padding: 0.4rem 0.7rem;
		background: color-mix(in srgb, var(--card) 88%, transparent);
		border: 1px solid var(--border);
		border-radius: 999px;
		backdrop-filter: blur(6px);
		transition: right 180ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
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
			flex: none;
			gap: 0.25rem;
			margin-left: auto;
			padding: 0.22rem 0.42rem;
			font-size: var(--text-micro);
			line-height: 1;
			white-space: nowrap;
			background: color-mix(in srgb, var(--card) 92%, transparent);
			border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
			border-radius: var(--radius-pill);
			backdrop-filter: blur(8px);
		}

		.map-live-freshness[data-placement='head'] :global(.live-freshness) {
			gap: 0.25rem;
			font-size: var(--text-micro);
			line-height: 1;
		}

		.map-live-freshness[data-placement='head'] :global(.live-freshness-label) {
			letter-spacing: 0.05em;
		}
	}
</style>

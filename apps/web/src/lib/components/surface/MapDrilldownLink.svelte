<script lang="ts">
	export interface MapDrilldownLinkProps {
		href: string;
		label: string;
		ariaLabel: string;
	}

	let { href, label, ariaLabel }: MapDrilldownLinkProps = $props();
</script>

<a {href} class="map-drilldown-link" aria-label={ariaLabel} data-sveltekit-preload-data="hover">
	{label}
</a>

<style>
	.map-drilldown-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--size-tap-min);
		padding: 0.25rem 0.65rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: color-mix(in srgb, var(--primary) 60%, var(--foreground));
		text-decoration: none;
		background: color-mix(in srgb, var(--primary) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 28%, var(--border) 72%);
		border-radius: var(--radius-pill);
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	.map-drilldown-link:hover {
		color: var(--foreground);
		background: color-mix(in srgb, var(--primary) 16%, transparent);
		border-color: color-mix(in srgb, var(--primary) 45%, var(--border) 55%);
	}
	.map-drilldown-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.map-drilldown-link {
			transition: none;
		}
	}
</style>

<!--
  MapDrilldownLink — the shared "view on map" pill anchor (slice-9.4).

  The lines/stops index rows and the line/stop detail heads each carried a
  near-identical primary-tinted pill (.line-map-link / .stop-map-link /
  .route-map-action / .stop-map-action) that deep-links to the live map filtered
  to one entity. This carries that affordance once: a hover-preloaded pill
  anchor over a caller-supplied href + visible label + accessible name.

  Tokens, no hex; --primary is interactive-only (this IS an interactive
  affordance). Reduced-motion-guarded transitions; focus-visible ring.
-->
<script lang="ts">
	export interface MapDrilldownLinkProps {
		/** Target href (callers pass mapHrefFor(...)). */
		href: string;
		/** Visible pill text. */
		label: string;
		/** Accessible name (e.g. "View route 161 on map"). */
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
		min-height: 2rem;
		padding: 0.25rem 0.65rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--primary);
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

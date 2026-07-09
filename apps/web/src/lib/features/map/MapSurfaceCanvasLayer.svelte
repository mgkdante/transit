<!--
  MapSurfaceCanvasLayer — the full-bleed GL canvas base layer + its framing vignette.

  SINGLE RESPONSIBILITY: render the ONE MapStage mount (owned by the orchestrator
  via the `mapBody` snippet) plus the token-driven edge vignette, inside the
  hero's `.map-surface` container. The GL context, camera wiring (basemapLoader /
  theme / center / bounds / fitPadding / onready / onstyleload) all live in the
  parent's `mapBody` snippet, so this child owns NO map state — it only places the
  canvas base layer + the vignette and owns their scoped CSS. Because the map is
  the BASE layer (z-1) and the vignette feathers over it (z-5), the floating chrome
  (z-10+) reads cleanly; the canvas is full-bleed and is the only GL-size driver
  (MapStage's own ResizeObserver), never a panel.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The orchestrator's mapBody snippet — holds the single <MapStage .../> call
		 * with all its basemapLoader/theme/center/bounds/fitPadding/onready/onstyleload
		 * wiring, so the GL context + camera stay owned by MapHero. */
		mapBody: Snippet;
	}

	let { mapBody }: Props = $props();
</script>

{@render mapBody()}

<!-- Edge framing: a token-driven vignette so the full-bleed canvas reads as a
     deliberate composition (panes float over it) rather than a raw GL square. -->
<div class="map-vignette" aria-hidden="true"></div>

<style>
	/* The map stage canvas is the BASE layer of the surface. Targeted globally
	   (the `.map-surface` container is the parent in MapHero, not in this child's
	   own template) so the full-bleed inset:0 placement matches byte-for-byte. */
	:global(.map-surface .map-hero-stage) {
		position: absolute;
		inset: 0;
		z-index: var(--z-map-canvas);
		border-radius: 0;
	}

	/* Full-bleed framing: an inset vignette grounds the floating panes against the
	   live canvas and feathers the top/edges so overlay text stays legible over
	   busy basemap tiles, without recolouring the map. Tuned per theme via the
	   --foreground token so it darkens on dark and lightly mutes on cool-slate. */
	.map-vignette {
		position: absolute;
		inset: 0;
		z-index: var(--z-map-scrim);
		pointer-events: none;
		background:
			linear-gradient(
				to bottom,
				color-mix(in srgb, var(--background) 34%, transparent) 0%,
				transparent 18%,
				transparent 86%,
				color-mix(in srgb, var(--background) 24%, transparent) 100%
			),
			radial-gradient(
				120% 90% at 50% 42%,
				transparent 58%,
				color-mix(in srgb, var(--foreground) 7%, transparent) 100%
			);
	}
</style>

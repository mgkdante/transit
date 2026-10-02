<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		mapBody: Snippet;
	}

	let { mapBody }: Props = $props();
</script>

{@render mapBody()}

<div class="map-vignette" aria-hidden="true"></div>

<style>
	:global(.map-surface .map-hero-stage) {
		position: absolute;
		inset: 0;
		z-index: var(--z-map-canvas);
		border-radius: 0;
	}

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

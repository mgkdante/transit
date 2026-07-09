<!--
  /map (+ /fr/map) — thin mount of the Family A live vehicle map hero.

  THIN by contract (slice-9.3): imports the feature screen and mounts it in the
  AppShell `main` zone. No data load, no logic — MapHero owns the map + live
  store; locale comes from getLocale() context, so this route needs no +page.ts.
-->
<script lang="ts">
	import { MapHero } from '$lib/features/map';
</script>

<svelte:head>
	<!-- Basemap origin (MapLibre glyph PBFs) — warm DNS+TLS on the /map LCP path.
	     Scoped to this route (moved out of app.html) so non-map pages don't pay a
	     wasted connection warmup to protomaps.github.io. -->
	<link rel="preconnect" href="https://protomaps.github.io" crossorigin="anonymous" />
	<link rel="dns-prefetch" href="https://protomaps.github.io" />
</svelte:head>

<MapHero />

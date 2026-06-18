<!--
  /map (+ /fr/map) — thin mount of the Family A live vehicle map hero.

  THIN by contract (slice-9.3): imports the feature screen and mounts it in the
  AppShell `main` zone. No data load, no logic — MapHero owns the map + live
  store; locale comes from getLocale() context, so this route needs no +page.ts.
-->
<script lang="ts">
	import { MapHero } from '$lib/features/map';
</script>

<MapHero />

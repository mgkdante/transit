<!--
  /hotspots (+ /fr/hotspots) — thin mount of the Hotspots accountability surface.

  THIN by contract (slice-9.x): this page only imports the feature screen and
  mounts it inside the AppShell `main` zone. No data load, no logic, no markup —
  the screen owns presentation; locale comes from getLocale() context, so this
  index surface needs no +page.ts.
-->
<script lang="ts">
	import HotspotsBoard from '$lib/features/hotspots/HotspotsBoard.svelte';
</script>

<HotspotsBoard />

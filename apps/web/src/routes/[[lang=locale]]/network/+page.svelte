<!--
  /network (+ /fr/network) — thin mount of the Network-health surface.

  THIN by contract (slice-9.3): this page only imports the feature screen and
  mounts it inside the AppShell `main` zone. No data load, no logic, no markup —
  the screen owns presentation; locale comes from getLocale() context, so this
  index surface needs no +page.ts.
-->
<script lang="ts">
	import NetworkHealth from '$lib/features/network/NetworkHealth.svelte';
</script>

<NetworkHealth />

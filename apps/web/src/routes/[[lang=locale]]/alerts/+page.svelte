<!--
  /alerts (+ /fr/alerts) — thin mount of the Alert History surface ("Avis").

  THIN by contract (slice-9.x): this page only imports the feature screen and
  mounts it. No data load, no logic, no markup — the screen owns presentation;
  locale comes from getLocale() context, so this index surface needs no +page.ts.
-->
<script lang="ts">
	import AlertHistory from '$lib/features/alerts/AlertHistory.svelte';
</script>

<AlertHistory />

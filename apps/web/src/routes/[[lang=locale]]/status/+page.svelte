<!--
  /status (+ /fr/status) — thin mount of the data-health surface.

  THIN by contract (slice-9.3 spine): this page only imports the feature screen
  and mounts it inside the AppShell `main` zone. The screen fetches provenance.json
  client-side (createResource), so the surface needs no +page.ts — locale comes
  from getLocale() context.

  NOTE: distinct from the /health liveness probe (routes/health/+server.ts), which
  is a JSON endpoint for uptime monitors. This is the CITIZEN-facing honesty page;
  the two never collide ( /status vs /health ).
-->
<script lang="ts">
	import HealthStatus from '$lib/features/health/HealthStatus.svelte';
</script>

<HealthStatus />

<!--
  /status (+ /fr/status) — thin mount of the data-health surface.

  THIN by contract (slice-9.3 spine): this page only forwards request-scoped
  honesty seeds to the feature screen. Locale comes from getLocale() context.

  NOTE: distinct from the /health liveness probe (routes/health/+server.ts), which
  is a JSON endpoint for uptime monitors. This is the CITIZEN-facing honesty page;
  the two never collide ( /status vs /health ).
-->
<script lang="ts">
	import HealthStatus from '$lib/features/health/HealthStatus.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<HealthStatus
	provenanceSeed={data.provenanceSeed ?? undefined}
	dataHealthSeed={data.dataHealthSeed ?? undefined}
	historicAvailabilitySeed={data.historicAvailabilitySeed ?? undefined}
/>

<!--
  Stop detail route — thin mount (slice-9.3).

  Resolves /stop/{id} (and /fr/stop/{id}) and mounts the StopDetail feature
  screen, passing the server-resolved stop identity seed. The screen owns all presentation +
  the live/static/historic /v1 reads; the locale comes from getLocale() context.
  Keep this file a pure mount — no logic, no markup, no copy.
-->
<script lang="ts">
	import StopDetail from '$lib/features/stops/StopDetail.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<StopDetail id={data.seed.id} seed={data.seed} stopSeed={data.stopSeed ?? undefined} />

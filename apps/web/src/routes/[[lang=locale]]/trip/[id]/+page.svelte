<!--
  Trip detail route — thin mount (slice-9.4).

  Resolves /trip/{id} (and /fr/trip/{id}) and mounts the TripDetail feature
  screen, passing the trip id from +page.ts. The screen owns all presentation +
  the live getTrips() read; the locale comes from getLocale() context. Keep this
  file a pure mount — no logic, no markup, no copy.

  A trip is an EPHEMERAL live entity (ids rotate), so this route is marked
  noindex in the root layout (resolveRouteSeo + ephemeral-path detection) and is
  intentionally absent from the static sitemap PATHS.
-->
<script lang="ts">
	import TripDetail from '$lib/features/trips/TripDetail.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<TripDetail id={data.id} />

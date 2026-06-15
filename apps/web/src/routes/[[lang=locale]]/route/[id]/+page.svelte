<!--
  /route/[id] — the per-line detail surface (slice-9.3).

  THIN mount: the feature screen (RouteDetail) owns all composition + data load
  and reads the active locale from getLocale() context. This page only forwards
  the route id resolved by +page.ts (kept as a thin id+lang passthrough).
  Everything beyond the mount lives in $lib/features/lines.
-->
<script lang="ts">
	import RouteDetail from '$lib/features/lines/RouteDetail.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<RouteDetail id={data.id} />

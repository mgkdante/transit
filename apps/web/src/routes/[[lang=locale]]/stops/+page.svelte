<!--
  Stops index route — thin mount (slice-9.3).

  Resolves /stops (and /fr/stops) and mounts the StopsIndex feature screen, which
  owns all presentation + data. No +page.ts: the locale comes from getLocale()
  context inside the screen, and the (large) stops index is loaded client-side via
  createResource. Keep this file a pure mount — no logic, no markup, no copy.
-->
<script lang="ts">
	import StopsIndex from '$lib/features/stops/StopsIndex.svelte';
</script>

<StopsIndex />

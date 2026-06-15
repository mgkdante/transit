<!--
  /search (and /fr/search) — thin route shell for the Search surface.

  THIN by contract: import the feature screen and mount it. No logic, no data,
  no markup beyond the mount. The locale comes from getLocale() context inside
  the screen, so this index surface needs no +page.ts.
-->
<script lang="ts">
	import SearchSurface from '$lib/features/search/SearchSurface.svelte';
</script>

<SearchSurface />

<!--
  /lines — the Lines index surface (slice-9.3).

  THIN mount: the feature screen (LinesIndex) owns all composition + data load
  and reads the active locale from getLocale() context, so this page needs no
  +page.ts and no props. Everything beyond the mount lives in
  $lib/features/lines.
-->
<script lang="ts">
	import LinesIndex from '$lib/features/lines/LinesIndex.svelte';
</script>

<LinesIndex />

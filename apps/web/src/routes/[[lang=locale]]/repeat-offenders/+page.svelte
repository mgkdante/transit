<!--
  /repeat-offenders (+ /fr/repeat-offenders) — thin mount of the Repeat-offenders
  ("récidivistes") accountability surface.

  THIN by contract (slice-9.x): this page only imports the feature screen and
  mounts it inside the AppShell `main` zone. No data load, no logic, no markup —
  the screen owns presentation; locale comes from getLocale() context, so this
  index surface needs no +page.ts.
-->
<script lang="ts">
	import RepeatOffenders from '$lib/features/repeat-offenders/RepeatOffenders.svelte';
</script>

<RepeatOffenders />

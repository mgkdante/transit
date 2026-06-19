<!--
  /metrics (+ /fr/metrics) — thin mount of the in-app metric explainer.

  THIN by contract (slice-9.3 spine): this page only imports the feature screen
  and mounts it inside the AppShell `main` zone. The content is static, so the
  surface needs no +page.ts — locale comes from getLocale() context.
-->
<script lang="ts">
	import MetricsExplainer from '$lib/features/metrics/MetricsExplainer.svelte';
</script>

<MetricsExplainer />

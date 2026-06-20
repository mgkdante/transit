<!--
  /receipt (+ /fr/receipt) — thin mount of the Accountability-receipt surface.

  THIN by contract (slice-9.3 pattern): this page only imports the feature screen
  and mounts it. No data load, no logic, no markup — the screen owns presentation;
  locale comes from getLocale() context, so this index surface needs no +page.ts.
-->
<script lang="ts">
	import AccountabilityReceipt from '$lib/features/receipt/AccountabilityReceipt.svelte';
</script>

<AccountabilityReceipt />

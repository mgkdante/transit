<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { Resource } from '$lib/v1/resource.svelte';
	import ResourceBoundary from '../ResourceBoundary.svelte';

	let {
		failed,
		retained,
		lang,
	}: { failed: Resource<string>; retained: Resource<string>; lang: Locale } = $props();
</script>

<section aria-label="Stop information">
	<ResourceBoundary resource={failed} {lang}>
		{#snippet children(value)}<p>{value}</p>{/snippet}
	</ResourceBoundary>
</section>
<section aria-label="Departures">
	<ResourceBoundary resource={retained} {lang}>
		{#snippet children(value)}<p>{value}</p>{/snippet}
	</ResourceBoundary>
</section>

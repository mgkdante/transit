<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { createLiveStore } from '#lib/v1/live/store.svelte.ts';
	import { outOfServiceCount, vehicleServiceCopy } from '#lib/v1/live/vehicleService.ts';
	import type { Manifest } from '#lib/v1/schemas/index.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	let { manifest, locale }: { manifest: Manifest; locale: Locale } = $props();
	const live = untrack(() => createLiveStore(manifest, { families: ['vehicles'] }));
	const count = $derived(live.vehicles ? outOfServiceCount(live.vehicles.vehicles) : null);
	onMount(() => {
		live.start();
		return () => live.stop();
	});
</script>

<p>{vehicleServiceCopy[locale].count} {count ?? '—'}</p>

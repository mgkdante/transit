<script lang="ts">
	import { onMount } from 'svelte';
	import { ManifestSchema } from '#lib/v1/schemas/index.ts';
	import { createLiveStore } from '../store.svelte';
	import FreshnessStamp from '#lib/components/surface/FreshnessStamp.svelte';
	import MapFeedStallBanner from '#lib/features/map/MapFeedStallBanner.svelte';

	const manifest = ManifestSchema.parse({
		provider: 'stm',
		display_name: 'STM',
		dataset_version: 'health-test',
		attribution: 'Test',
		bbox: [-74, 45, -73, 46],
		labels: {},
		surfaces: [],
		files: { live: { generated_utc: '2026-06-21T12:00:00Z', ttl_s: 30 } },
	});
	const live = createLiveStore(manifest, { families: ['vehicles', 'alerts'] });
	onMount(() => {
		live.start();
		return () => live.stop();
	});
</script>

<FreshnessStamp
	generatedUtc={live.generatedUtc}
	ageSeconds={live.ageSeconds}
	isStale={live.isStale}
	locale="en"
/>
<MapFeedStallBanner
	generatedUtc={live.generatedUtc}
	ageSeconds={live.ageSeconds}
	isStale={live.isStale}
	locale="en"
/>

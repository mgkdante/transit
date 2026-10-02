<script lang="ts">
	import StopDetail from '$lib/features/stops/StopDetail.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<StopDetail id={data.seed.id} seed={data.seed} stopSeed={data.stopSeed ?? undefined} />

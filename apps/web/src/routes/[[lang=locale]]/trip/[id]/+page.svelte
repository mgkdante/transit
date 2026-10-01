<script lang="ts">
	import TripDetail from '$lib/features/trips/TripDetail.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<TripDetail id={data.id} />

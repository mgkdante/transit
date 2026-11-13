<script lang="ts">
	import HotspotsBoard from '#lib/features/hotspots/HotspotsBoard.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<HotspotsBoard manifest={data.v1?.manifest} />

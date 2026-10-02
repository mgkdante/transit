<script lang="ts">
	import RouteDetail from '$lib/features/lines/RouteDetail.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<RouteDetail
	id={data.seed.id}
	seed={data.seed}
	routeSeed={data.routeSeed ?? undefined}
	reliabilitySeed={data.reliabilitySeed ?? undefined}
	lineHistorySeed={data.lineHistorySeed ?? undefined}
	initialClusters={data.initialClusters}
	initialImportFailed={data.initialImportFailed}
	preparedArticleTime={data.preparedArticleTime}
/>

<script lang="ts">
	import { page } from '$app/stores';
	import LinesIndex from '$lib/features/lines/LinesIndex.svelte';
	import MapHero from '$lib/features/map/MapHero.svelte';

	const isMap = $derived(/^\/(?:fr\/)?map\/?$/u.test($page.url.pathname));
</script>

<main id="main" class:overflow-hidden={isMap} class:overflow-y-auto={!isMap}>
	{#if isMap}
		<MapHero />
	{:else}
		<LinesIndex />
	{/if}
</main>

<script lang="ts">
	import { page } from '$app/state';
	import LinesIndex from '#lib/features/lines/LinesIndex.svelte';
	import MapHero from '#lib/features/map/MapHero.svelte';

	const isMap = $derived(/^\/(?:fr\/)?map\/?$/u.test(page.url.pathname));
</script>

<main id="main-flow" class:overflow-hidden={isMap} class:h-dvh={isMap} class:min-h-dvh={!isMap}>
	{#if isMap}
		<MapHero />
	{:else}
		<LinesIndex />
	{/if}
</main>

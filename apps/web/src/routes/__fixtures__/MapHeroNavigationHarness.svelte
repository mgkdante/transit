<script lang="ts">
	import LinesIndex from '$lib/features/lines/LinesIndex.svelte';
	import MapHero from '$lib/features/map/MapHero.svelte';

	let { route }: { route: 'map' | 'lines' } = $props();
</script>

{#if route === 'map'}
	<MapHero />
{:else}
	<LinesIndex />
{/if}

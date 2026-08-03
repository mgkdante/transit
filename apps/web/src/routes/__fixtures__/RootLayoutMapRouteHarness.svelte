<script lang="ts">
	import RootLayout from '../+layout.svelte';
	import MapRoute from '../[[lang=locale]]/map/+page.svelte';
	import type { LayoutData } from '../$types';

	let { data }: { data: LayoutData } = $props();
</script>

<RootLayout {data}><MapRoute /></RootLayout>

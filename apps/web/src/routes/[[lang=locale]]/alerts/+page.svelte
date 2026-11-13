<script lang="ts">
	import AlertHistory from '#lib/features/alerts/AlertHistory.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<AlertHistory manifest={data.v1?.manifest} />

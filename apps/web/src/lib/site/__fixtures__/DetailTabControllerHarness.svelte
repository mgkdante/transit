<script lang="ts">
	import { untrack } from 'svelte';
	import { createDetailTabController } from '../detailTabController.svelte';

	let { url }: { url: URL } = $props();
	const controller = createDetailTabController(untrack(() => url));
	$effect(() => controller.syncFromUrl(url));
</script>

<div data-testid="detail-tab-controller" data-active={controller.active}>
	<button type="button" onclick={() => (controller.active = 'detail')}>Detail</button>
	<button type="button" onclick={() => (controller.active = 'schedule')}>Schedule</button>
	<button type="button" onclick={() => (controller.active = 'reliability')}>Reliability</button>
</div>

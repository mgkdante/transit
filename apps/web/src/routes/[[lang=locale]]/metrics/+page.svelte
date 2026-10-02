<script lang="ts">
	import MetricsExplainer from '$lib/features/metrics/MetricsExplainer.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<MetricsExplainer metricBodies={data.metricBodies} />

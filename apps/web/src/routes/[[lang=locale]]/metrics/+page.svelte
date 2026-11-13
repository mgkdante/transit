<script lang="ts">
	import MetricsExplainer from '#lib/features/metrics/MetricsExplainer.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<MetricsExplainer manifest={data.v1?.manifest} sqlHtml={data.sqlHtml} />

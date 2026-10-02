<script lang="ts">
	import HealthStatus from '$lib/features/health/HealthStatus.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<HealthStatus
	provenanceSeed={data.provenanceSeed ?? undefined}
	dataHealthSeed={data.dataHealthSeed ?? undefined}
	historicAvailabilitySeed={data.historicAvailabilitySeed ?? undefined}
/>

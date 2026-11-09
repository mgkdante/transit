<script lang="ts">
	import { getV1Context } from '#lib/v1/boot.ts';
	const v1 = getV1Context();
	import HealthStatus from '#lib/features/health/HealthStatus.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<HealthStatus
	manifest={v1.manifest}
	provenanceSeed={data.provenanceSeed ?? undefined}
	dataHealthSeed={data.dataHealthSeed ?? undefined}
	historicAvailabilitySeed={data.historicAvailabilitySeed ?? undefined}
/>

<script lang="ts">
	import { NetworkSurface } from '#lib/features/network/reliability/index.ts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<NetworkSurface
	networkSeed={data.networkSeed ?? undefined}
	trendSeed={data.trendSeed ?? undefined}
	provenanceSeed={data.provenanceSeed ?? undefined}
/>

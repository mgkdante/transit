<!--
  /network (+ /fr/network) — thin mount of the Network-health surface.

  THIN by contract (slice-9.3): this page only forwards request-scoped seeds to
  the feature screen. The screen owns presentation and client refreshes; locale
  comes from getLocale() context.
-->
<script lang="ts">
	import { NetworkSurface } from '$lib/features/network/reliability';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<NetworkSurface
	networkSeed={data.networkSeed ?? undefined}
	trendSeed={data.trendSeed ?? undefined}
	provenanceSeed={data.provenanceSeed ?? undefined}
/>

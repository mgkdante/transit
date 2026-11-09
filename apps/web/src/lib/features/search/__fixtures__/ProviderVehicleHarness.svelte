<script lang="ts">
	import { setContext } from 'svelte';
	import { setLocaleContext, type Locale } from '#lib/i18n/index.ts';
	import type { Vehicle } from '#lib/v1/index.ts';
	import { hasOccupancy } from '#lib/site/transitDisplay.ts';
	import { copy } from '../search.copy';
	import VehicleResultRow from '../VehicleResultRow.svelte';
	let { provider, locale, vehicle }: { provider: string; locale: Locale; vehicle: Vehicle } =
		$props();
	setLocaleContext(
		() => locale,
		() => provider,
	);
	setContext(Symbol.for('transit.v1.context'), () => ({ manifest: { provider } }));
</script>

<VehicleResultRow
	{vehicle}
	{locale}
	nextStopName={provider === 'stm' ? 'Station Berri-UQAM' : 'RIDEAU / CUMBERLAND'}
	copy={copy[locale].vehicle}
	statusLabel="Unknown"
	occupancyLabel={null}
	occupancyAvailable={hasOccupancy(provider, [vehicle])}
/>

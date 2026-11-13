<script lang="ts">
	import { setContext } from 'svelte';
	import { setLocaleContext, type Locale } from '#lib/i18n/index.ts';
	import type { Vehicle } from '#lib/v1/index.ts';
	import { hasOccupancy } from '#lib/site/transitDisplay.ts';
	import { setLineDirectory } from '#lib/site/transitDisplayContext.ts';
	import { createLineDirectory } from '#lib/site/lineDirectory.ts';
	import { routeNameFallback } from '#lib/site/absence.ts';
	import { copy } from '../search.copy';
	import VehicleResultRow from '../VehicleResultRow.svelte';
	let { provider, locale, vehicle }: { provider: string; locale: Locale; vehicle: Vehicle } =
		$props();
	setLocaleContext(
		() => locale,
		() => provider,
	);
	setContext(Symbol.for('transit.v1.context'), () => ({ manifest: { provider } }));
	setLineDirectory(() =>
		createLineDirectory([{ id: '1-373', short: '1', type: 1 }], {
			line: (id) => routeNameFallback(id, locale),
		}),
	);
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

<script lang="ts">
	import { providerHasAlerts } from '#lib/v1/providers.ts';
	import { getLocale, type Locale } from '#lib/i18n/index.ts';
	import { Surface } from '@yesid/ui/layout';
	import HomeExplore from '#lib/features/home/HomeExplore.svelte';
	import HomeInvite from '#lib/features/home/HomeInvite.svelte';
	import HomePulse from '#lib/features/home/HomePulse.svelte';
	import HomeSearch from '#lib/features/home/HomeSearch.svelte';
	import { homeCadence, homeCopy } from '#lib/features/home/home.copy.ts';
	import type { PageData } from './$types';

	let { data }: { data: Pick<PageData, 'provider' | 'v1'> } = $props();
	const locale: Locale = getLocale();
	const city = $derived(
		data.provider?.labels[locale].city ??
			data.v1?.manifest.city ??
			data.v1?.manifest.provider ??
			'',
	);
	const operator = $derived(
		data.provider?.labels[locale].operator ?? data.v1?.manifest.display_name ?? city,
	);
	const copy = $derived({
		...homeCopy[locale],
		cadence: homeCadence(locale, data.v1?.manifest.files.live.ttl_s),
		headline: homeCopy[locale].headline.replace('{city}', city),
		auditBody: homeCopy[locale].auditBody.replace('{city}', city),
		auditMore: homeCopy[locale].auditMore.replace('{operator}', operator),
		audience: homeCopy[locale].audience.replace('{operator}', operator),
	});
</script>

<Surface>
	<HomeExplore {locale} {copy} alertsAvailable={providerHasAlerts(data.provider)}>
		{#snippet pulse()}
			<HomePulse {locale} {city} manifest={data.v1?.manifest ?? null} />
			<HomeSearch {locale} />
		{/snippet}
	</HomeExplore>
	<HomeInvite {locale} />
</Surface>

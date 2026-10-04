<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { Surface } from '$lib/components/layout';
	import HomeExplore from '$lib/features/home/HomeExplore.svelte';
	import { homeCopy } from '$lib/features/home/home.copy';
	import type { PageData } from './$types';

	let { data }: { data: Pick<PageData, 'provider' | 'v1'> } = $props();
	const locale: Locale = getLocale();
	const city = $derived(
		data.provider?.labels[locale].city ??
			data.v1?.manifest.city ??
			data.v1?.manifest.provider ??
			'',
	);
	const copy = $derived({
		...homeCopy[locale],
		auditKicker: homeCopy[locale].auditKicker.replace('{city}', city),
		headline: homeCopy[locale].headline.replace('{city}', city),
	});
</script>

<Surface>
	<HomeExplore {locale} {copy} />
</Surface>

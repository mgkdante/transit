<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { Surface } from '$lib/components/layout';
	import HomeExplore from '$lib/features/home/HomeExplore.svelte';
	import { homeCopy } from '$lib/features/home/home.copy';

	const locale: Locale = getLocale();
	const copy = homeCopy[locale];
</script>

<Surface>
	<HomeExplore {locale} {copy} />
</Surface>

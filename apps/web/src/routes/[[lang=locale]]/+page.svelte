<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { getV1Context } from '$lib/v1/boot';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '@yesid/ui/separator';
	import HomeHero from '$lib/features/home/HomeHero.svelte';
	import HomeWhat from '$lib/features/home/HomeWhat.svelte';
	import HomeExplore from '$lib/features/home/HomeExplore.svelte';
	import { homeCopy } from '$lib/features/home/home.copy';

	// The locale + booted manifest are stable for this component's lifetime (the
	// root layout boots the v1 context once, before the page tree renders).
	const locale: Locale = getLocale();
	const manifest = getV1Context().manifest;
	const copy = homeCopy(locale, manifest);
</script>

<Surface pad="hub" class="hub">
	<HomeHero {locale} {manifest} {copy} />
	<Separator variant="hazard" hazardSize="sm" maxWidth="100%" />
	<HomeWhat {locale} {copy} />
	<HomeExplore {locale} {copy} />
</Surface>

<script lang="ts">
	import { dev as runtimeDev } from '$app/environment';
	import { DEFAULT_LOCALE, SUPPORTED_LOCALES, localizeHref, type Locale } from '$lib/i18n';
	import { websiteJsonLd } from '$lib/seo/jsonld';

	interface SeoHeadProps {
		title: string;
		description: string;
		path?: string;
		locale: Locale;
		siteOrigin?: string;
		siteName?: string;
		themeColor?: string;
		noIndex?: boolean;
		suppressCanonical?: boolean;
		singleLocale?: boolean;
		jsonLd?: unknown[];
		twitterSite?: string;
		twitterCreator?: string;
		author?: string;
		dev?: boolean;
	}

	let {
		title,
		description,
		path = '/',
		locale,
		siteOrigin = 'https://transit.yesid.dev',
		siteName = 'Transit Analytics',
		themeColor = '#141414',
		noIndex = false,
		suppressCanonical = false,
		singleLocale = false,
		jsonLd = [],
		twitterSite,
		twitterCreator,
		author,
		dev = runtimeDev,
	}: SeoHeadProps = $props();

	const fullTitle = $derived(title === siteName ? title : `${title} · ${siteName}`);
	const canonical = $derived(`${siteOrigin}${localizeHref(path, locale)}`);
	const ogImage = $derived(`${siteOrigin}/og/${locale}.png`);
	const ogImageAlt = $derived(`${siteName}: ${title}`);

	const ogLocale = $derived(`${locale}_CA`);
	const altLocales = $derived(SUPPORTED_LOCALES.filter((l) => l !== locale).map((l) => `${l}_CA`));

	const ldNodes = $derived([websiteJsonLd({ siteOrigin, siteName, locale }), ...jsonLd]);

	$effect(() => {
		if (!dev) return;
		if (fullTitle.length > 60) {
			console.warn(
				`[SeoHead] title > 60 chars (${fullTitle.length}), may truncate in search. path: ${path}`,
			);
		}
		if (!description.trim()) {
			console.warn(`[SeoHead] description is blank. path: ${path}`);
		} else if (description.length > 160) {
			console.warn(
				`[SeoHead] description > 160 chars (${description.length}); consider more concise copy. path: ${path}`,
			);
		}
	});
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />
	{#if !suppressCanonical}
		<link rel="canonical" href={canonical} />
	{/if}
	{#if author}
		<meta name="author" content={author} />
	{/if}

	<meta name="theme-color" content={themeColor} />
	<meta name="color-scheme" content="dark light" />

	{#if noIndex}
		<meta name="robots" content="noindex,nofollow" />
	{/if}

	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:image:alt" content={ogImageAlt} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:type" content="image/png" />
	<meta property="og:url" content={canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={siteName} />
	<meta property="og:locale" content={ogLocale} />
	{#each altLocales as alt (alt)}
		<meta property="og:locale:alternate" content={alt} />
	{/each}

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={fullTitle} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={ogImage} />
	<meta name="twitter:image:alt" content={ogImageAlt} />
	{#if twitterSite}
		<meta name="twitter:site" content={twitterSite} />
	{/if}
	{#if twitterCreator}
		<meta name="twitter:creator" content={twitterCreator} />
	{/if}

	{#if !singleLocale && !suppressCanonical}
		{#each SUPPORTED_LOCALES as l (l)}
			<link rel="alternate" hreflang={l} href={`${siteOrigin}${localizeHref(path, l)}`} />
		{/each}
		<link
			rel="alternate"
			hreflang="x-default"
			href={`${siteOrigin}${localizeHref(path, DEFAULT_LOCALE)}`}
		/>
	{/if}

	{#each ldNodes as node (node)}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON-LD: app-built nodes, < escaped, no user HTML -->
		{@html '<script type="application/ld+json">' +
			JSON.stringify(node).replace(/</g, '\\u003c') +
			'</scr' +
			'ipt>'}
	{/each}
</svelte:head>

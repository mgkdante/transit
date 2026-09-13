<script lang="ts">
	import { dev as runtimeDev } from '$app/environment';
	import { DEFAULT_LOCALE, SUPPORTED_LOCALES, localizeHref, type Locale } from '$lib/i18n';
	import { websiteJsonLd } from '$lib/seo/jsonld';

	interface SeoHeadProps {
		/** Page title (already localized by the caller). Site name is appended. */
		title: string;
		/** Localized summary of the page's purpose. */
		description: string;
		/** Canonical PAGE path, locale-less (e.g. '/lines/165'). Defaults to '/'. */
		path?: string;
		/** Active request locale. Drives canonical prefix + og:image selection. */
		locale: Locale;
		/** Absolute site origin (no trailing slash). */
		siteOrigin?: string;
		/** Public-facing site name, appended to <title> and used as og:site_name. */
		siteName?: string;
		/** theme-color meta. Defaults to the dark --background board color. */
		themeColor?: string;
		/** Emit robots noindex,nofollow (utility / staging surfaces). */
		noIndex?: boolean;
		/** Suppress the self-referential canonical link (soft-404 / error renders —
		 *  a broken URL must not advertise itself as canonical). */
		suppressCanonical?: boolean;
		/** Suppress hreflang alternates (single-locale surfaces). */
		singleLocale?: boolean;
		/** Pre-built schema.org JSON-LD nodes to emit alongside the always-on
		 *  WebSite+SearchAction node (e.g. a per-entity BreadcrumbList). */
		jsonLd?: unknown[];
		/** Twitter publishing account @handle (twitter:site). Omitted when unset. */
		twitterSite?: string;
		/** Twitter content-author @handle (twitter:creator). Omitted when unset. */
		twitterCreator?: string;
		/** Human-readable author byline (meta name="author"). Omitted when unset. */
		author?: string;
		/** Test seam to force the dev-warning path. */
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

	// og:locale uses BCP-47-ish underscore form (Montréal market → _CA).
	const ogLocale = $derived(`${locale}_CA`);
	const altLocales = $derived(SUPPORTED_LOCALES.filter((l) => l !== locale).map((l) => `${l}_CA`));

	const ldNodes = $derived([websiteJsonLd({ siteOrigin, siteName, locale }), ...jsonLd]);

	// The description length hint encourages concise copy; it is not a search-engine limit.
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

	<!-- Suppressing an error page's canonical also suppresses alternates to that broken URL. -->
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

	<!-- Escape `<` so JSON cannot close the script element; split its closing tag for the Svelte lexer. -->
	{#each ldNodes as node (node)}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON-LD: app-built nodes, < escaped, no user HTML -->
		{@html '<script type="application/ld+json">' +
			JSON.stringify(node).replace(/</g, '\\u003c') +
			'</scr' +
			'ipt>'}
	{/each}
</svelte:head>

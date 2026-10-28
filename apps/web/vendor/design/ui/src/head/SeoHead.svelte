<!--
  A page's head tags: title, description, canonical and hreflang, Open Graph, Twitter, robots and
  JSON-LD. The app passes resolved values and keeps its locale and URL policy.
-->
<script lang="ts" module>
	export interface SeoHeadAlternate {
		hreflang: string;
		href: string;
	}

	export interface SeoHeadImage {
		url: string;
		alt: string;
		width?: number;
		height?: number;
	}

	export interface SeoHeadProps {
		title: string;
		description: string;
		siteName: string;
		/** Absolute. Leave it out on error pages: no canonical, `og:url` or hreflang. */
		canonical?: string;
		/** Absolute hreflang links, x-default included when the app wants one. */
		alternates?: readonly SeoHeadAlternate[];
		/** `og:locale`, such as `en_CA`. */
		ogLocale: string;
		ogLocaleAlternates?: readonly string[];
		image: SeoHeadImage;
		type?: string;
		noIndex?: boolean;
		twitter?: { site?: string; creator?: string };
		author?: string;
		/** The server value; the theme store repaints it from `--background` once the app runs. */
		themeColor?: string;
		jsonLd?: readonly object[];
	}
</script>

<script lang="ts">
	import { serializeJsonLd } from '@yesid/seo-kit/jsonld';
	import tokens from '@yesid/tokens/tokens.json';

	let {
		title,
		description,
		siteName,
		canonical,
		alternates = [],
		ogLocale,
		ogLocaleAlternates = [],
		image,
		type = 'website',
		noIndex = false,
		twitter = {},
		author,
		themeColor = tokens.color.dark.background.$value,
		jsonLd = [],
	}: SeoHeadProps = $props();
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	{#if canonical}
		<link rel="canonical" href={canonical} />
		{#each alternates as alternate (alternate.hreflang)}
			<link rel="alternate" hreflang={alternate.hreflang} href={alternate.href} />
		{/each}
	{/if}
	{#if author}
		<meta name="author" content={author} />
	{/if}
	<meta name="theme-color" content={themeColor} />
	<meta name="color-scheme" content="dark light" />
	{#if noIndex}
		<meta name="robots" content="noindex,nofollow" />
	{/if}

	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:image" content={image.url} />
	<meta property="og:image:alt" content={image.alt} />
	<meta property="og:image:width" content={String(image.width ?? 1200)} />
	<meta property="og:image:height" content={String(image.height ?? 630)} />
	{#if canonical}
		<meta property="og:url" content={canonical} />
	{/if}
	<meta property="og:type" content={type} />
	<meta property="og:site_name" content={siteName} />
	<meta property="og:locale" content={ogLocale} />
	{#each ogLocaleAlternates as alternate (alternate)}
		<meta property="og:locale:alternate" content={alternate} />
	{/each}

	<meta name="twitter:card" content="summary_large_image" />
	{#if twitter.site}
		<meta name="twitter:site" content={twitter.site} />
	{/if}
	{#if twitter.creator}
		<meta name="twitter:creator" content={twitter.creator} />
	{/if}
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={image.url} />
	<meta name="twitter:image:alt" content={image.alt} />

	{#if jsonLd.length > 0}
		{@html `<script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>`}
	{/if}
</svelte:head>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import type { ChromeSearchResult, ChromeSearchScope } from '$lib/search/chromeSearch';
	import type { TransitModeKey } from '$lib/search/stopMode';
	import type { SvelteSet } from 'svelte/reactivity';
	import type { BilingualLabel } from '$lib/content/nav';
	import NavPill from './NavPill.svelte';

	interface AppShellProps {
		locale?: Locale;
		url?: URL;
		providerName?: string;
		providerShortName?: string;
		search?: string;
		onsearch?: (value: string) => void;
		searchResults?: readonly ChromeSearchResult[];
		onresultselect?: (result: ChromeSearchResult) => void;
		searchScope?: ChromeSearchScope;
		searchModes?: SvelteSet<TransitModeKey>;

		mainLabel?: BilingualLabel;

		main?: Snippet;

		class?: string;
	}

	let {
		locale: localeProp,
		url,
		providerName,
		providerShortName,
		search = $bindable(''),
		onsearch,
		searchResults = [],
		onresultselect,
		searchScope = 'all',
		searchModes,
		mainLabel,
		main,
		class: className,
	}: AppShellProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);
	const mainAriaLabel = $derived(
		mainLabel
			? mainLabel[locale === 'fr' ? 'fr' : 'en']
			: locale === 'fr'
				? 'Carte du réseau'
				: 'Network map',
	);
</script>

<div
	class={cn(
		'app-shell-root circuit-grid flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground',
		className,
	)}
	data-slot="app-shell"
>
	<div class="app-shell-chrome" data-slot="app-shell-chrome">
		<NavPill
			{locale}
			{url}
			{providerName}
			{providerShortName}
			bind:search
			{onsearch}
			{searchResults}
			{onresultselect}
			{searchScope}
			{searchModes}
		/>
	</div>

	<div class="app-shell-row min-h-0 flex-1 overflow-hidden" data-slot="app-shell-row">
		<main
			class="app-shell-main relative min-w-0 flex-1 overflow-hidden bg-transparent"
			aria-label={mainAriaLabel}
			data-slot="map-stage"
		>
			{#if main}{@render main()}{/if}
		</main>
	</div>
</div>

<style>
	.app-shell-root {
		--chrome-offset: calc(1rem + env(safe-area-inset-top, 0px) + var(--pill-h) + 0.5rem);
		position: relative;
	}

	.app-shell-chrome {
		position: absolute;
		inset-block-start: 0;
		inset-inline: 0;
		z-index: var(--z-nav);
	}

	.app-shell-row {
		position: relative;
	}

	:global(.app-shell-root:has([data-slot='footer'][data-in-view='true']))
		:global(
			:is([data-slot='surface-rail-mobile'], [data-testid='toc-pill']):not(:focus-within):not(
					:has([aria-expanded='true'])
				)
		) {
		opacity: 0;
		pointer-events: none;
	}

	.app-shell-main {
		position: absolute;
		inset: 0;
	}
</style>

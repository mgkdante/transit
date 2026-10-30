<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import type { ChromeSearchResult, ChromeSearchScope } from '$lib/search/chromeSearch';
	import type { TransitModeKey } from '$lib/search/stopMode';
	import type { SvelteSet } from 'svelte/reactivity';
	import NavPill from './NavPill.svelte';
	import type { PublicProvider } from '$lib/v1/providers';

	interface AppShellProps {
		locale?: Locale;
		url?: URL;
		providerId?: string;
		providers?: PublicProvider[];
		search?: string;
		onsearch?: (value: string) => void;
		searchResults?: readonly ChromeSearchResult[];
		onresultselect?: (result: ChromeSearchResult) => void;
		searchScope?: ChromeSearchScope;
		searchModes?: SvelteSet<TransitModeKey>;

		main?: Snippet;

		class?: string;
	}

	let {
		locale: localeProp,
		url,
		providerId,
		providers,
		search = $bindable(''),
		onsearch,
		searchResults = [],
		onresultselect,
		searchScope = 'all',
		searchModes,
		main,
		class: className,
	}: AppShellProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);
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
			{providerId}
			{providers}
			bind:search
			{onsearch}
			{searchResults}
			{onresultselect}
			{searchScope}
			{searchModes}
		/>
	</div>

	<div class="app-shell-row min-h-0 flex-1 overflow-hidden" data-slot="app-shell-row">
		<div
			class="app-shell-main relative min-w-0 flex-1 overflow-hidden bg-transparent"
			data-slot="map-stage"
		>
			{#if main}{@render main()}{/if}
		</div>
	</div>
</div>

<style>
	.app-shell-root {
		--chrome-gap: 0.5rem;
		--chrome-offset: calc(1rem + env(safe-area-inset-top, 0px) + var(--pill-h) + var(--chrome-gap));
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

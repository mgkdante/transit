<script lang="ts">
	import type { NavigationLifecycle } from '@yesid/ui/brand';
	import type { Snippet } from 'svelte';
	import { cn } from '#lib/utils/index.ts';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '#lib/i18n/index.ts';
	import type { ChromeSearchResult, ChromeSearchScope } from '#lib/search/chromeSearch.ts';
	import type { TransitModeKey } from '#lib/search/stopMode.ts';
	import type { SvelteSet } from 'svelte/reactivity';
	import NavPill from './NavPill.svelte';
	import type { PublicProvider } from '#lib/v1/providers.ts';

	interface AppShellProps {
		navigation: NavigationLifecycle;
		fullViewport?: boolean;
		locale?: Locale;
		url?: URL;
		providerId?: string;
		providers?: PublicProvider[];
		discoveryError?: boolean;
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
		navigation,
		fullViewport = false,
		locale: localeProp,
		url,
		providerId,
		providers,
		discoveryError,
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
		'app-shell-root circuit-grid flex w-full flex-col bg-background text-foreground',
		fullViewport ? 'h-dvh overflow-hidden' : 'min-h-dvh',
		className,
	)}
	data-full-viewport={fullViewport}
	data-slot="app-shell"
>
	<div class="app-shell-chrome" data-slot="app-shell-chrome">
		<NavPill
			{navigation}
			{locale}
			{url}
			{providerId}
			{providers}
			{discoveryError}
			bind:search
			{onsearch}
			{searchResults}
			{onresultselect}
			{searchScope}
			{searchModes}
		/>
	</div>

	<div class="app-shell-row min-h-0 flex-1" data-slot="app-shell-row">
		<div class="app-shell-main relative min-w-0 flex-1 bg-transparent" data-slot="map-stage">
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
		position: fixed;
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

	.app-shell-root[data-full-viewport='true'] .app-shell-row {
		overflow: hidden;
	}

	.app-shell-root[data-full-viewport='true'] .app-shell-main {
		overflow: hidden;
		position: absolute;
		inset: 0;
	}
</style>

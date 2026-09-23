<!-- Persistent navigation and the caller-owned main surface.
     Feature owners compose RightPanel or BottomSheet when a selection opens. -->
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
		/** Active locale, threaded to every chrome zone (prop wins over context). */
		locale?: Locale;
		/** Full current URL — passed to the NavPill language switch. */
		url?: URL;
		/** Active provider display name (manifest.display_name), threaded to the NavPill. */
		providerName?: string;
		/** Snappy provider brand (manifest.short_name) — preferred for the compact chip. */
		providerShortName?: string;
		/** Bindable search value for the NavPill field. */
		search?: string;
		/** Fired when the NavPill search is submitted. */
		onsearch?: (value: string) => void;
		searchResults?: readonly ChromeSearchResult[];
		onresultselect?: (result: ChromeSearchResult) => void;
		/** Active surface scope — drives the scoped NavPill placeholder hint. */
		searchScope?: ChromeSearchScope;
		/** Transit modes picked in the NavPill dropdown; the layout owns the set. */
		searchModes?: SvelteSet<TransitModeKey>;

		/**
		 * Bilingual accessible name for the `<main>` landmark, surface-appropriate
		 * (e.g. Lines / Daily receipt). The shell renders ONE persistent `<main>`
		 * across routes, so without this every surface would announce the same stale
		 * "Network map". Omitted → the network-map label (the map is the backdrop).
		 */
		mainLabel?: BilingualLabel;

		/** The MapStage content — the map fills this zone. */
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
	// Surface-appropriate `<main>` landmark name. Falls back to the network-map
	// label (EN/FR) so an omitted prop preserves the prior behavior verbatim.
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
	<!-- Chrome floats OVER the row (not a flex-reserved band): the row fills the
	     full viewport height and content scrolls UNDER the chrome edge-to-edge, so
	     the map is truly full-bleed and the single --chrome-offset knob (measured
	     from the viewport top) correctly places every sticky rail + heading anchor.
	     Non-full-bleed pages reclaim the space with a top pad (see +layout #main).
	     The chrome is the floating NavPill; it publishes --pill-h per breakpoint. -->
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

	<!-- The main row stays mounted across viewport changes. -->
	<div class="app-shell-row min-h-0 flex-1 overflow-hidden" data-slot="app-shell-row">
		<!-- Transparent base: the blueprint grid painted on .app-shell-root (circuit-
		     grid) shows through the document surfaces (solid cards occlude it — the
		     occlusion law). The map stays opaque because .map-hero paints its own
		     solid --background, so /map is grid-free by construction. -->
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
	/* THE single vertical-chrome knob. Every sticky top + every heading anchor
	   offset derives from this one value — no more scattered 5.5rem / 5rem / 7rem
	   literals or the unset --nav-height fallback (the old three-system split).
	   = the pill's top inset (1rem + notch) + the pill height + a 0.5rem breath.
	   --pill-h is published per breakpoint by NavPill (deterministic: content 44px
	   + 2·padV + 2·2px border), so this calc tracks the real floating pill height
	   at every width with no JS measurement. */
	.app-shell-root {
		--chrome-offset: calc(1rem + env(safe-area-inset-top, 0px) + var(--pill-h) + 0.5rem);
		position: relative;
	}

	/* The chrome floats OVER the row: absolute at the top, full width, above the
	   rail/detail overlays via --z-nav. Removing it from the flex flow lets the row
	   fill the whole viewport (map full-bleed) and makes #main's scroll-container
	   top coincide with the viewport top — so --chrome-offset (viewport-measured)
	   places sticky rails correctly. Hosts the floating NavPill. */
	.app-shell-chrome {
		position: absolute;
		inset-block-start: 0;
		inset-inline: 0;
		z-index: var(--z-nav);
	}

	/* The row fills the viewport; the map stage is full-bleed with nothing offsetting
	   it from the left (the site nav lives entirely in the floating NavPill now). */
	.app-shell-row {
		position: relative;
	}

	/* Keep active controls and keyboard focus available while the footer is in view. */
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

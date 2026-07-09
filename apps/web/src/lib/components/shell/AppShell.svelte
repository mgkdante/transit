<!--
  AppShell — the application chrome, ONE STABLE DOM correct on the first (SSR)
  paint. The persistent chrome (the floating NavPill) is rendered UNCONDITIONALLY,
  so it is in the very first server-rendered frame and never flashes in or re-mounts
  on navigation.

    ┌ NavPill (floats, publishes --pill-h; carries ALL nav — Map/Lines/Stops/    ┐
    │ Network + Audit via the hamburger) ──────────────────────────────────────  │
    │  <main> map stage (full bleed under the floating chrome)                    │
    │ the detail surface overlays right.                                          │
    └─────────────────────────────────────────────────────────────────────────── ┘

  The site nav lives ENTIRELY in the NavPill now — the old left-nav rail is gone.
  DESKTOP vs MOBILE for the detail surface is a JS open/close decision (`detailOpen`),
  never a breakpoint re-branch of the chrome. The detail surface floats over the
  map's right slice on desktop and rides the BottomSheet on mobile.

  `layout.isDesktop` survives only for the genuine route-vs-panel JS decision in
  `$lib/nav` (openSurface) — the detail surface's desktop-overlay vs mobile-sheet
  presentation. The map is truly full-bleed: nothing offsets it from the left.

  Named snippet props: `main` (map stage), `detail` (RightPanel / BottomSheet body),
  plus optional `detailFooter`. The zones render whatever the page passes, with
  quiet empty states from the child components.

  Adapted from the yesid.dev +layout.svelte chrome composition — re-themed to
  the transit board, gsap/lenis/seo/marketing stripped. Tokens only; surfaces
  SOLID. The shell fills the viewport (h-dvh) and never scrolls as a whole —
  each zone scrolls internally.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import type { ChromeSearchResult, ChromeSearchScope } from '$lib/search/chromeSearch';
	import type { BilingualLabel } from '$lib/content/nav';
	// `layout.isDesktop` is consulted ONLY for the detail surface's desktop-overlay
	// vs mobile-sheet presentation — the genuine route-vs-panel intent decision. The
	// PERSISTENT chrome (the floating NavPill) never reads it, so the first paint is
	// correct without JS. See the detail block + `$lib/nav`.
	import { layout } from '$lib/nav';
	import NavPill from './NavPill.svelte';
	import RightPanel from './RightPanel.svelte';
	import BottomSheet from './BottomSheet.svelte';

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

		/** Whether the detail surface (RightPanel / BottomSheet) is shown (bindable). */
		detailOpen?: boolean;
		/** Title for the detail surface header. */
		detailTitle?: string;
		/** Stable key for the active surface — re-keys the detail body on swap. */
		surfaceKey?: string;
		/** Fired when the detail surface is dismissed. */
		ondetailclose?: () => void;

		/**
		 * Bilingual accessible name for the `<main>` landmark, surface-appropriate
		 * (e.g. Lines / Daily receipt). The shell renders ONE persistent `<main>`
		 * across routes, so without this every surface would announce the same stale
		 * "Network map". Omitted → the network-map label (the map is the backdrop).
		 */
		mainLabel?: BilingualLabel;

		/** The MapStage content — the map fills this zone. */
		main?: Snippet;
		/** RightPanel / BottomSheet body — the swapped surface detail. */
		detail?: Snippet;
		/** Sticky footer for the detail surface. */
		detailFooter?: Snippet;

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
		detailOpen = $bindable(false),
		detailTitle,
		surfaceKey = 'empty',
		ondetailclose,
		mainLabel,
		main,
		detail,
		detailFooter,
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

	function closeDetail() {
		detailOpen = false;
		ondetailclose?.();
	}
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
		/>
	</div>

	<!-- ONE stable row, server-rendered, correct on first paint. The map stage +
	     the detail surface are ALWAYS in the DOM; the map is full-bleed with nothing
	     offsetting it from the left (the site nav lives entirely in the NavPill). -->
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

		<!-- Detail surface — selected-entity content, never first-paint chrome. It is
		     absent until a selection opens it (`detailOpen`), so branching its
		     PRESENTATION (desktop floating overlay vs mobile bottom sheet) on
		     `layout.isDesktop` causes no load-time flash: nothing is selected at first
		     paint. This is the genuine route-vs-panel intent decision the layout store
		     is reserved for — distinct from the persistent rail/header/footer chrome,
		     which is CSS-responsive above. -->
		{#if layout.isDesktop}
			{#if detailOpen}
				<div class="app-shell-detail-overlay" data-slot="app-shell-detail-overlay">
					<RightPanel
						{locale}
						title={detailTitle}
						{surfaceKey}
						onclose={closeDetail}
						footer={detailFooter}
					>
						{#if detail}{@render detail()}{/if}
					</RightPanel>
				</div>
			{/if}
		{:else}
			<BottomSheet
				bind:open={detailOpen}
				{locale}
				title={detailTitle}
				{surfaceKey}
				footer={detailFooter}
			>
				{#if detail}{@render detail()}{/if}
			</BottomSheet>
		{/if}
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

	.app-shell-main {
		position: absolute;
		inset: 0;
	}

	/* The desktop detail dock is the sheet's desktop form (the mobile BottomSheet
	   uses --z-sheet); it rides the same elevation band, below the floating pill
	   (--z-nav). */
	.app-shell-detail-overlay {
		position: absolute;
		inset-block: 0;
		right: 0;
		z-index: var(--z-sheet);
		pointer-events: auto;
	}
</style>

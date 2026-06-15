<!--
  AppShell — the responsive 3-zone application chrome.

  DESKTOP (≥1024px, `layout.isDesktop`):
    ┌──────────────────────── TopBar (h60) ────────────────────────┐
    │ LeftRail (w300) │      MapStage (flex)      │ RightPanel(w360)│
    └──────────────────────────────────────────────────────────────┘
    LeftRail + RightPanel are fixed-width; MapStage flexes to fill. The
    RightPanel is shown only when `detailOpen` — on close the stage reclaims it.

  MOBILE (<1024px):
    TopBar + a full-bleed <main> (the map fills the viewport) + a BottomSheet
    that slides up for the selected surface. The rail/detail snippets feed the
    sheet on mobile (rail content is folded into the sheet's body in 9.2, which
    carries no Family data — the page decides what to render).

  Consumes `$lib/nav`'s `layout` runes store (boolean `isDesktop`, the
  (min-width:1024px) media match) to pick the layout — never a local matchMedia,
  so every shell zone agrees on the breakpoint with the rest of the app.

  Named snippet props: `rail` (LeftRail body), `main` (MapStage), `detail`
  (RightPanel / BottomSheet body), plus optional `detailFooter`. No Family data
  is wired in 9.2 — the zones render whatever the page passes, with quiet empty
  states from the child components.

  Adapted from the yesid.dev +layout.svelte chrome composition — re-themed to
  the transit board, gsap/lenis/seo/marketing stripped. Tokens only; surfaces
  SOLID. The shell fills the viewport (h-dvh) and never scrolls as a whole —
  each zone scrolls internally.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import { layout } from '$lib/nav';
	import TopBar from './TopBar.svelte';
	import LeftRail from './LeftRail.svelte';
	import RightPanel from './RightPanel.svelte';
	import BottomSheet from './BottomSheet.svelte';

	interface AppShellProps {
		/** Active locale, threaded to every chrome zone (prop wins over context). */
		locale?: Locale;
		/** Full current URL — passed to the TopBar language switch. */
		url?: URL;
		/** Active alert count for the TopBar bell badge. */
		alertCount?: number;
		/** Bindable search value for the TopBar field. */
		search?: string;
		/** Fired when the TopBar search is submitted. */
		onsearch?: (value: string) => void;
		/** Fired when the TopBar alerts bell is activated. */
		onalerts?: () => void;

		/** Whether the detail surface (RightPanel / BottomSheet) is shown (bindable). */
		detailOpen?: boolean;
		/** Title for the detail surface header. */
		detailTitle?: string;
		/** Stable key for the active surface — re-keys the detail body on swap. */
		surfaceKey?: string;
		/** Fired when the detail surface is dismissed. */
		ondetailclose?: () => void;

		/** Heading for the desktop LeftRail. */
		railHeading?: string;

		/** LeftRail body (desktop) / folded into the sheet body on mobile. */
		rail?: Snippet;
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
		alertCount = 0,
		search = $bindable(''),
		onsearch,
		onalerts,
		detailOpen = $bindable(false),
		detailTitle,
		surfaceKey = 'empty',
		ondetailclose,
		railHeading,
		rail,
		main,
		detail,
		detailFooter,
		class: className,
	}: AppShellProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	// The single source of truth for the layout breakpoint (shared app-wide).
	const isDesktop = $derived(layout.isDesktop);

	function closeDetail() {
		detailOpen = false;
		ondetailclose?.();
	}
</script>

<div
	class={cn('flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground', className)}
	data-slot="app-shell"
>
	<!-- TopBar spans the full width on every breakpoint. -->
	<TopBar {locale} {url} {alertCount} bind:search {onsearch} {onalerts} />

	{#if isDesktop}
		<!-- DESKTOP: 3-zone row. Rail + Detail fixed-width; stage flexes. -->
		<div class="flex min-h-0 flex-1 overflow-hidden" data-slot="app-shell-row">
			<LeftRail {locale} heading={railHeading}>
				{#if rail}{@render rail()}{/if}
			</LeftRail>

			<main
				class="relative min-w-0 flex-1 overflow-hidden bg-surface-0"
				aria-label={locale === 'fr' ? 'Carte du réseau' : 'Network map'}
				data-slot="map-stage"
			>
				{#if main}{@render main()}{/if}
			</main>

			{#if detailOpen}
				<RightPanel
					{locale}
					title={detailTitle}
					{surfaceKey}
					onclose={closeDetail}
					footer={detailFooter}
				>
					{#if detail}{@render detail()}{/if}
				</RightPanel>
			{/if}
		</div>
	{:else}
		<!-- MOBILE: full-bleed map + bottom sheet for the selected surface. -->
		<main
			class="relative min-h-0 flex-1 overflow-hidden bg-surface-0"
			aria-label={locale === 'fr' ? 'Carte du réseau' : 'Network map'}
			data-slot="map-stage"
		>
			{#if main}{@render main()}{/if}
		</main>

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

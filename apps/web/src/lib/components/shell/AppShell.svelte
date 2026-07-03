<!--
  AppShell — the application chrome, ONE STABLE DOM correct on the first (SSR)
  paint. The persistent chrome (NavPill + LeftRail) is rendered UNCONDITIONALLY,
  so it is in the very first server-rendered frame and never flashes in, re-mounts
  on navigation, or repaints mobile→desktop after hydration.

    ┌ NavPill (floats, publishes --pill-h) ┐
    │  <main> map stage (full bleed under the floating chrome)      │
    │ LeftRail overlays left; the detail surface overlays right.    │
    └──────────────────────────────────────────────────────────────┘

  DESKTOP vs MOBILE is a CSS-ONLY distinction driven by `@media (min-width:1024px)`
  — NOT a `{#if layout.isDesktop}` structural re-branch. The same DOM serves both
  form factors:
    · the LeftRail rides a fixed-width overlay column that the media query reveals
      at ≥1024px and folds to the NavPill hamburger menu below it (the rail content
      stays in the DOM, presentation is CSS);
    · the detail surface floats over the map's right slice on desktop and rides the
      BottomSheet on mobile, both gated only on `detailOpen` (a JS open/close
      decision, never the breakpoint).

  WHY no JS-isDesktop gating for chrome EXISTENCE: SSR has no `window`/`matchMedia`,
  so `layout.isDesktop` is `false` on the server. Gating the rail's existence on it
  emitted the mobile layout server-side, then repainted to desktop after hydration
  — the load-time flash. The media query resolves the layout in the FIRST paint
  with no JS, so the rail is present and correct before hydration. `layout.isDesktop`
  survives only for the genuine route-vs-panel JS decision in `$lib/nav` (openSurface).

  Named snippet props: `rail` (LeftRail body), `main` (map stage), `detail`
  (RightPanel / BottomSheet body), plus optional `detailFooter`. The zones render
  whatever the page passes, with quiet empty states from the child components.

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
	// PERSISTENT chrome (rail/header/footer) is CSS-responsive and never reads it, so
	// the first paint is correct without JS. See the detail block + `$lib/nav`.
	import { layout } from '$lib/nav';
	import NavPill from './NavPill.svelte';
	import LeftRail from './LeftRail.svelte';
	import RightPanel from './RightPanel.svelte';
	import BottomSheet from './BottomSheet.svelte';
	import {
		readStoredLeftRailWidth,
		writeStoredLeftRailWidth,
		clampLeftRailWidth,
		MIN_LEFT_RAIL_WIDTH,
		MAX_LEFT_RAIL_WIDTH,
	} from './leftRailWidth';

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

		/** Heading for the desktop LeftRail. */
		railHeading?: string;
		/**
		 * Bilingual accessible name for the `<main>` landmark, surface-appropriate
		 * (e.g. Lines / Daily receipt). The shell renders ONE persistent `<main>`
		 * across routes, so without this every surface would announce the same stale
		 * "Network map". Omitted → the network-map label (the map is the backdrop).
		 */
		mainLabel?: BilingualLabel;

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
		railHeading,
		mainLabel,
		rail,
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

	// The expanded vs icon-only rail width. CSS picks the live `--app-left-rail-offset`
	// off `data-rail-collapsed` so the value is correct in the FIRST paint (no JS
	// flip): the rail renders at its expanded width server-side and only narrows when
	// the user collapses it. The map chrome offsets off the SAME variable.
	let leftRailCollapsed = $state(false);

	// The expanded rail width is DRAGGABLE: a thin right-edge handle resizes the
	// overlay (and the map chrome offset, which follows `--app-left-rail-offset`)
	// WITHOUT ever touching the map canvas — the map sizes off its own container,
	// never the rail width. The chosen width persists across reloads (px scalar in
	// localStorage). The row element owns the `--app-rail-width-expanded` CSS var the
	// drag writes; CSS swaps to the collapsed strip width on `data-rail-collapsed`,
	// so collapse still snaps to the icon column regardless of the dragged width.
	let rowEl = $state<HTMLDivElement | null>(null);
	let railWidthPx = $state(readStoredLeftRailWidth());
	let railDragging = $state(false);
	let railDragStartX = 0;
	let railDragStartWidth = 0;

	const railResizeAria = $derived(
		locale === 'fr' ? 'Redimensionner la navigation' : 'Resize navigation',
	);

	function closeDetail() {
		detailOpen = false;
		ondetailclose?.();
	}

	// Collapse/expand is a pure local toggle now (no paneforge pane to drive): it
	// flips `data-rail-collapsed`, which the CSS reads to swap the rail width + its
	// icon-only treatment. The map chrome follows via `--app-left-rail-offset`.
	function toggleLeftRailCollapsed(): void {
		leftRailCollapsed = !leftRailCollapsed;
	}

	// Seed the live CSS var from the persisted width once mounted, so the dragged
	// width is restored on a reload. SSR paints the 16rem CSS default (no JS), so
	// there is no flash: we only overwrite the var client-side when a stored value
	// exists. Kept in a derived setter so the var tracks `railWidthPx` after a drag.
	$effect(() => {
		rowEl?.style.setProperty('--app-rail-width-expanded', `${railWidthPx}px`);
	});

	// Pointer-drag the rail's right edge. Capturing pointer events on the handle keeps
	// the drag tracking even if the cursor leaves it; each move writes a CLAMPED width
	// straight into the CSS var (so the overlay + map offset follow live), and we
	// persist on release. The map canvas is untouched throughout — it never reads the
	// rail width. Collapsed → the handle is not rendered, so this only runs expanded.
	function onRailHandlePointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		railDragging = true;
		railDragStartX = event.clientX;
		railDragStartWidth = railWidthPx;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function onRailHandlePointerMove(event: PointerEvent): void {
		if (!railDragging) return;
		const next = clampLeftRailWidth(railDragStartWidth + (event.clientX - railDragStartX));
		railWidthPx = next;
	}

	function onRailHandlePointerUp(event: PointerEvent): void {
		if (!railDragging) return;
		railDragging = false;
		(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
		writeStoredLeftRailWidth(railWidthPx);
	}

	// Keyboard resize for the separator (a11y parity with paneforge handles): arrows
	// nudge the width, Home/End jump to the floor/ceiling. Persists on each commit.
	function onRailHandleKeyDown(event: KeyboardEvent): void {
		const STEP = 16;
		let next: number;
		switch (event.key) {
			case 'ArrowLeft':
				next = railWidthPx - STEP;
				break;
			case 'ArrowRight':
				next = railWidthPx + STEP;
				break;
			case 'Home':
				next = MIN_LEFT_RAIL_WIDTH;
				break;
			case 'End':
				next = MAX_LEFT_RAIL_WIDTH;
				break;
			default:
				return;
		}
		event.preventDefault();
		railWidthPx = clampLeftRailWidth(next);
		writeStoredLeftRailWidth(railWidthPx);
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

	<!-- ONE stable row, server-rendered, correct on first paint. The map stage,
	     the LeftRail overlay, and the detail surface are ALWAYS in the DOM; the
	     @media query (NOT a JS isDesktop structural branch) decides desktop-rail vs
	     mobile-burger presentation, so the rail never flashes in or re-mounts. -->
	<div
		bind:this={rowEl}
		class="app-shell-row min-h-0 flex-1 overflow-hidden"
		data-slot="app-shell-row"
		data-rail-collapsed={leftRailCollapsed ? 'true' : 'false'}
		data-rail-dragging={railDragging ? 'true' : undefined}
	>
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

		<!-- LeftRail — ALWAYS rendered (server-side, in the first paint). The overlay
		     column is hidden below 1024px (the NavPill hamburger owns mobile nav) and
		     revealed at ≥1024px purely by CSS — never by a JS isDesktop flip, so the
		     rail is present + correct before hydration. pointer-events are confined to
		     the rail itself so the map stays interactive through the overlay. -->
		<div class="app-shell-rail-overlay" data-slot="app-shell-rail-overlay">
			{#if rail}
				<LeftRail
					{locale}
					{url}
					heading={railHeading}
					collapsed={leftRailCollapsed}
					ontogglecollapse={toggleLeftRailCollapsed}
				>
					{@render rail()}
				</LeftRail>
			{:else}
				<LeftRail
					{locale}
					{url}
					heading={railHeading}
					collapsed={leftRailCollapsed}
					ontogglecollapse={toggleLeftRailCollapsed}
				/>
			{/if}

			<!-- Right-edge resize handle — a thin separator that DRAGS the rail's
			     expanded width into the `--app-rail-width-expanded` CSS var (overlay +
			     map offset follow; the map canvas never reads it, so it is never
			     resized). role="separator" + aria-orientation + keyboard nudges match
			     a paneforge handle's a11y. Absent while collapsed (the icon strip is
			     fixed-width, not draggable). -->
			{#if !leftRailCollapsed}
				<!-- WAI-ARIA window-splitter: a focusable separator with pointer + keyboard
				     resize. svelte's a11y lint does not model `separator` as interactive, so
				     the focusable/handler warnings are suppressed for this intentional widget. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="app-shell-rail-handle"
					data-slot="app-shell-rail-handle"
					role="separator"
					aria-orientation="vertical"
					aria-label={railResizeAria}
					aria-valuemin={MIN_LEFT_RAIL_WIDTH}
					aria-valuemax={MAX_LEFT_RAIL_WIDTH}
					aria-valuenow={railWidthPx}
					tabindex="0"
					onpointerdown={onRailHandlePointerDown}
					onpointermove={onRailHandlePointerMove}
					onpointerup={onRailHandlePointerUp}
					onpointercancel={onRailHandlePointerUp}
					onkeydown={onRailHandleKeyDown}
				></div>
			{/if}
		</div>

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

	/* The rail width the map chrome offsets against. CSS owns it (not a JS-driven
	   percent) so it is correct in the FIRST paint and follows the collapse toggle
	   without a reactive flip. MOBILE default 0px: the rail overlay is hidden below
	   1024px (the NavPill hamburger owns nav there), so the map chrome sits flush left. */
	.app-shell-row {
		position: relative;
		--app-rail-width-expanded: 16rem;
		--app-rail-width-collapsed: 4.85rem;
		--app-left-rail-offset: 0px;
	}

	.app-shell-main {
		position: absolute;
		inset: 0;
	}

	/* Non-map surfaces pad their content clear of the rail; the map hero offsets its
	   floating chrome instead (it owns the full bleed under the overlay rail). */
	.app-shell-main:not(:has(:global(.map-hero))) {
		padding-left: var(--app-left-rail-offset, 0px);
	}

	/* Rail overlay — ALWAYS in the DOM, hidden below the desktop breakpoint by CSS
	   (never a JS isDesktop flip). It floats over the left of the map stage; only the
	   rail itself takes pointer events, so the map underneath stays interactive. */
	.app-shell-rail-overlay {
		position: absolute;
		inset-block: 0;
		left: 0;
		z-index: var(--z-rail);
		display: none;
		width: var(--app-rail-width-expanded);
		max-width: 100%;
		pointer-events: auto;
		transition: width var(--duration-normal) var(--ease-out);
	}

	/* Suppress the width transition WHILE dragging so the rail tracks the pointer
	   1:1 (the 180ms ease would otherwise lag the handle); it re-applies for the
	   collapse/expand snap. */
	.app-shell-row[data-rail-dragging='true'] .app-shell-rail-overlay {
		transition: none;
	}

	/* The drag handle — a thin col-resize strip flush to the rail's right edge,
	   matching the map detail handle tone (idle --border, hover/active --primary).
	   The hit target is wider than the 1px visible line via padding-free 6px width
	   so it is easy to grab without a fat seam. */
	.app-shell-rail-handle {
		position: absolute;
		inset-block: 0;
		right: 0;
		width: 6px;
		z-index: 1;
		cursor: col-resize;
		background: var(--border);
		opacity: 0;
		transition:
			opacity var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
		touch-action: none;
	}

	.app-shell-rail-overlay:hover .app-shell-rail-handle,
	.app-shell-rail-handle:hover,
	.app-shell-rail-handle:focus-visible,
	.app-shell-row[data-rail-dragging='true'] .app-shell-rail-handle {
		opacity: 1;
	}

	.app-shell-rail-handle:hover,
	.app-shell-rail-handle:focus-visible,
	.app-shell-row[data-rail-dragging='true'] .app-shell-rail-handle {
		background: var(--primary);
	}

	.app-shell-rail-handle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	/* DESKTOP (≥1024px): reveal the rail and feed its live width to the map chrome via
	   --app-left-rail-offset. The collapsed icon-strip width is selected by the
	   data-rail-collapsed attribute the toggle flips — resolved in CSS, so the rail is
	   present + correct on the first paint and the map chrome tracks it with no reflow. */
	@media (min-width: 1024px) {
		.app-shell-row {
			--app-left-rail-offset: var(--app-rail-width-expanded);
		}

		.app-shell-row[data-rail-collapsed='true'] {
			--app-left-rail-offset: var(--app-rail-width-collapsed);
		}

		.app-shell-rail-overlay {
			display: block;
			width: var(--app-left-rail-offset);
		}
	}

	/* The desktop detail dock is the sheet's desktop form (the mobile BottomSheet
	   uses --z-sheet); it rides the same elevation band, above the rail overlay
	   and below the floating pill (--z-nav). */
	.app-shell-detail-overlay {
		position: absolute;
		inset-block: 0;
		right: 0;
		z-index: var(--z-sheet);
		pointer-events: auto;
	}

	@media (prefers-reduced-motion: reduce) {
		.app-shell-rail-overlay,
		.app-shell-rail-handle {
			transition: none;
		}
	}
</style>

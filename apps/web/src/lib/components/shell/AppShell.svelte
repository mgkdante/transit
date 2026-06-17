<!--
  AppShell — the responsive 3-zone application chrome.

  DESKTOP (≥1024px, `layout.isDesktop`):
    ┌──────────────────────── TopBar (h60) ────────────────────────┐
    │           MapStage (fixed row, full bleed under chrome)       │
    │ LeftRail overlays left; detail panels overlay right.          │
    └──────────────────────────────────────────────────────────────┘
    Rails do not resize the MapStage, so MapLibre does not visually drift when
    a rail is dragged, collapsed, or expanded.

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
	import type { PaneAPI } from 'paneforge';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import type { ChromeSearchResult } from '$lib/search/chromeSearch';
	import { layout } from '$lib/nav';
	import { ResizablePaneGroup, ResizablePane, ResizableHandle } from '$lib/components/ui/resizable';
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
		searchResults?: readonly ChromeSearchResult[];
		onresultselect?: (result: ChromeSearchResult) => void;
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
		searchResults = [],
		onresultselect,
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

	const LEFT_RAIL_COLLAPSED_SIZE = 5;
	const LEFT_RAIL_MIN_SIZE = 7;
	const LEFT_RAIL_DEFAULT_SIZE = 16;
	const LEFT_RAIL_COMPACT_THRESHOLD = 9;

	// The single source of truth for the layout breakpoint (shared app-wide).
	const isDesktop = $derived(layout.isDesktop);
	let leftRailCollapsed = $state(false);
	let leftRailSize = $state(LEFT_RAIL_DEFAULT_SIZE);
	let leftRailPane = $state<PaneAPI | undefined>();
	const leftRailOffset = $derived(`${leftRailSize}%`);

	function closeDetail() {
		detailOpen = false;
		ondetailclose?.();
	}

	function syncLeftRailVisualState(size: number): void {
		leftRailSize = size;
		leftRailCollapsed = size <= LEFT_RAIL_COMPACT_THRESHOLD;
	}

	function onLeftRailCollapse(): void {
		leftRailSize = LEFT_RAIL_COLLAPSED_SIZE;
		leftRailCollapsed = true;
	}

	function onLeftRailExpand(): void {
		syncLeftRailVisualState(leftRailPane?.getSize() ?? LEFT_RAIL_DEFAULT_SIZE);
	}

	function toggleLeftRailCollapsed(): void {
		if (leftRailCollapsed) {
			leftRailSize = LEFT_RAIL_DEFAULT_SIZE;
			leftRailPane?.resize(LEFT_RAIL_DEFAULT_SIZE);
			leftRailCollapsed = false;
		} else {
			leftRailSize = LEFT_RAIL_COLLAPSED_SIZE;
			leftRailPane?.collapse();
			leftRailCollapsed = true;
		}
	}
</script>

<div
	class={cn('flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground', className)}
	data-slot="app-shell"
>
	<!-- TopBar spans the full width on every breakpoint. -->
	<TopBar
		{locale}
		{url}
		{alertCount}
		bind:search
		{onsearch}
		{searchResults}
		{onresultselect}
		{onalerts}
	/>

	{#if isDesktop}
		<!-- DESKTOP: stable map stage; rails overlay it so MapLibre never shifts. -->
		<div class="app-shell-row min-h-0 flex-1 overflow-hidden" data-slot="app-shell-row">
			<main
				class="app-shell-main relative min-w-0 flex-1 overflow-hidden bg-surface-0"
				style={`--app-left-rail-offset: ${leftRailOffset};`}
				aria-label={locale === 'fr' ? 'Carte du réseau' : 'Network map'}
				data-slot="map-stage"
			>
				{#if main}{@render main()}{/if}
			</main>

			<ResizablePaneGroup direction="horizontal" class="app-shell-rail-overlay">
				<ResizablePane
					bind:this={leftRailPane}
					class="app-shell-left-rail-pane"
					defaultSize={LEFT_RAIL_DEFAULT_SIZE}
					minSize={LEFT_RAIL_MIN_SIZE}
					maxSize={24}
					collapsible
					collapsedSize={LEFT_RAIL_COLLAPSED_SIZE}
					onResize={(size) => syncLeftRailVisualState(size)}
					onCollapse={onLeftRailCollapse}
					onExpand={onLeftRailExpand}
				>
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
				</ResizablePane>

				<ResizableHandle withHandle class="app-shell-resize-handle app-shell-rail-resize-handle" />

				<ResizablePane defaultSize={84} minSize={0} class="app-shell-map-hit-through-pane">
					<div class="app-shell-map-hit-through" aria-hidden="true"></div>
				</ResizablePane>
			</ResizablePaneGroup>

			{#if detailOpen}
				<div class="app-shell-detail-overlay">
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

<style>
	.app-shell-row {
		position: relative;
	}

	.app-shell-main {
		position: absolute;
		inset: 0;
	}

	.app-shell-main:not(:has(:global(.map-hero))) {
		padding-left: var(--app-left-rail-offset, 0px);
	}

	:global(.app-shell-rail-overlay) {
		position: absolute;
		inset: 0;
		z-index: 30;
		pointer-events: none;
	}

	:global(.app-shell-left-rail-pane),
	:global(.app-shell-rail-resize-handle) {
		pointer-events: auto;
	}

	:global(.app-shell-map-hit-through-pane) {
		pointer-events: none;
	}

	.app-shell-map-hit-through {
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.app-shell-detail-overlay {
		position: absolute;
		inset-block: 0;
		right: 0;
		z-index: 32;
		pointer-events: auto;
	}

	:global(.app-shell-resize-handle) {
		width: 8px;
		background: var(--border);
		border-radius: var(--radius-sm);
		transition: background var(--duration-fast, 120ms) var(--ease-default, ease);
	}

	:global(.app-shell-resize-handle:hover),
	:global(.app-shell-resize-handle:focus-visible),
	:global(.app-shell-resize-handle[data-active='pointer']) {
		background: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.app-shell-resize-handle) {
			transition: none;
		}
	}
</style>

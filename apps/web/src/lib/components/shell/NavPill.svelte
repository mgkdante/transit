<!--
  NavPill — the floating capsule nav (replaces TopBar). A fixed, full-width,
  pointer-events-none rail centring an intrinsic-width pill (pointer-events-auto)
  that floats OVER the map/document, edge-to-edge, and NEVER reserves a chrome
  band — the single --chrome-offset knob (AppShell) reclaims the space on
  non-full-bleed pages.

  Content order (§C2.1, built exactly):
    BrandWordmark ("Transit" + orange dot → /) · divider · Map / Lines / Stops /
    Network · divider · search (≥lg compact in-pill field) · divider · Refresh +
    compact Search + ThemeToggle + LangSwitch +
    hamburger → the menu.

  The menu is a FLAT, unlabelled list of destinations (Map/Lines/Stops/Network
  on <lg · Metrics · Status · Hotspots · Receipt · Repeat
  offenders · Alerts) closing with a "Yesid" link OUT to yesid.dev (external ↗).
  No text group-headings — a quiet hairline is the only separator between the
  primary surfaces and the secondary ones at compact widths. It opens as one
  anchored dropdown at every width; compact widths retain the primary + search
  groups. The dropdown wears the shared .glass-chrome recipe (§C4 P4).

  --pill-h is set on :root per breakpoint by PLAIN CSS (no JS measurement): the
  pill height is deterministic (content 44px + 2·padV + 2·2px border). Stage-1's
  temporary 60px fallback in AppShell is removed — this owns the knob now.

  DOCTRINE: orange --primary is INTERACTIVE-only; the live dot is the ONE
  "system is live" affordance. Active link = --primary text + a 3×3 amber dot at
  bottom 4px — NO text-shadow glow (glow-never-text, §C2.1 ruling). Tokens or the
  measured yesid constants only; the pill chassis is SOLID-family glass.
-->
<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import { cn } from '$lib/utils';
	import {
		type Locale,
		DEFAULT_LOCALE,
		PUBLISHED_LOCALES,
		delocalizePath,
		getLocale,
		localizeHref,
		localizeUrl,
	} from '$lib/i18n';
	import type { ChromeSearchResult, ChromeSearchScope } from '$lib/search/chromeSearch';
	import { SURFACE_NAV, AUDIT_NAV, YESID_HOUSE_LINK, isSurfaceActive } from '$lib/content/nav';
	// F (motion wiring): the pill nav links carry a subtle magnetic cursor-pull
	// (≤3px). magnetic is MOTION-GATED — the vendored action no-ops under
	// prefers-reduced-motion and on touch devices. Never edited.
	import { magnetic } from '@yesid/motion';
	import BrandWordmark from './BrandWordmark.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import LangSwitch from './LangSwitch.svelte';

	interface NavPillProps {
		/** Active request locale; omitted → getLocale() context. */
		locale?: Locale;
		/** Full current URL — the language switch preserves path + query + hash. */
		url?: URL;
		/** Active provider display name (manifest.display_name). */
		providerName?: string;
		/** Snappy provider brand (manifest.short_name, e.g. "STM"). */
		providerShortName?: string;
		/** Current value of the multi-value search field (bindable). */
		search?: string;
		/** Fired when the search field is submitted (Enter). */
		onsearch?: (value: string) => void;
		/** Search matches shown under the chrome field. */
		searchResults?: readonly ChromeSearchResult[];
		/** Active surface scope — drives the scoped placeholder hint. */
		searchScope?: ChromeSearchScope;
		/** Fired when a search result is selected. */
		onresultselect?: (result: ChromeSearchResult) => void;
		/** Locales offered in the switcher; defaults to the published set. */
		availableLocales?: readonly Locale[];
		class?: string;
	}

	let {
		locale: localeProp,
		url = new URL('https://transit.local/'),
		providerName: _providerName,
		providerShortName: _providerShortName,
		search = $bindable(''),
		onsearch,
		searchResults = [],
		searchScope = 'all',
		onresultselect,
		availableLocales = PUBLISHED_LOCALES,
		class: className,
	}: NavPillProps = $props();

	// Prop wins (persistent chrome); fall back to context for isolated renders.
	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);
	const currentPath = $derived(delocalizePath(url.pathname));

	// --- Localized strings ---------------------------------------------------
	const searchPlaceholder = $derived(
		searchScope === 'route'
			? locale === 'fr'
				? 'Rechercher une ligne…'
				: 'Search a line…'
			: searchScope === 'stop'
				? locale === 'fr'
					? 'Rechercher un arrêt…'
					: 'Search a stop…'
				: locale === 'fr'
					? 'Rechercher une ligne, un arrêt ou une adresse…'
					: 'Search a line, stop, or address…',
	);
	const searchAria = $derived(
		searchScope === 'route'
			? locale === 'fr'
				? 'Rechercher une ligne'
				: 'Search a line'
			: searchScope === 'stop'
				? locale === 'fr'
					? 'Rechercher un arrêt'
					: 'Search a stop'
				: locale === 'fr'
					? 'Rechercher dans le réseau'
					: 'Search the network',
	);
	const openMenuAria = $derived(locale === 'fr' ? 'Ouvrir le menu' : 'Open menu');
	const closeMenuAria = $derived(locale === 'fr' ? 'Fermer le menu' : 'Close menu');
	const menuAria = $derived(locale === 'fr' ? 'Menu de navigation' : 'Navigation menu');
	const navAria = $derived(locale === 'fr' ? 'Navigation principale' : 'Primary navigation');
	// The menu is a FLAT, unlabelled list of destinations (no visible "Audit" /
	// "Explore" headings — simpler, less confusing). These strings survive only as
	// the group aria-labels so assistive tech can still tell the primary surfaces
	// (AUDIT_NAV is active-aware, so a route rename lands in one place) from the
	// accountability surfaces without a visible heading.
	const auditLabel = $derived(locale === 'fr' ? 'Vérification' : 'Audit');
	const primaryGroupLabel = $derived(locale === 'fr' ? 'Explorer' : 'Explore');
	// The parent-brand "Yesid" link out to yesid.dev — the final burger-menu row,
	// with an external ↗ affordance. NOT the pill's main click anymore.
	const yesidHouseLabel = $derived(YESID_HOUSE_LINK.label[locale]);
	const yesidHouseAria = $derived(
		locale === 'fr'
			? `${YESID_HOUSE_LINK.label.fr} (nouvel onglet)`
			: `${YESID_HOUSE_LINK.label.en} (opens in a new tab)`,
	);
	const compactLanguageTarget = $derived.by(() => {
		if (availableLocales.length < 2) return null;
		const index = Math.max(0, availableLocales.indexOf(locale));
		const target = availableLocales[(index + 1) % availableLocales.length];
		return {
			href: localizeUrl(url, target),
			label: target === 'fr' ? 'Français' : 'English',
			aria:
				locale === 'fr'
					? `Changer de langue : ${target === 'fr' ? 'Français' : 'English'}`
					: `Switch language: ${target === 'fr' ? 'Français' : 'English'}`,
		};
	});

	const navItems = $derived(
		SURFACE_NAV.map((item) => ({
			key: item.key,
			href: localizeHref(item.href, locale),
			label: item.label[locale],
			active: isSurfaceActive(item, currentPath),
		})),
	);
	const auditItems = $derived(
		AUDIT_NAV.map((item) => ({
			key: item.key,
			href: localizeHref(item.href, locale),
			label: item.label[locale],
			active: isSurfaceActive(item, currentPath),
		})),
	);

	let menuOpen = $state(false);
	// The hamburger toggle, so closing the menu (Escape / backdrop / nav-link) can
	// return focus to its trigger — the pill is now the only mobile nav escape.
	let menuToggle = $state<HTMLButtonElement>();
	let searchResultsOpen = $state(true);
	let rootEl = $state<HTMLElement>();
	// The pill capsule — measured so the anchored dropdown can pin its RIGHT edge to the
	// pill's right edge (the pill is intrinsic-width + centred, so its right edge is
	// near the viewport centre-right, not the far edge). We publish the pill's
	// right-inset-from-viewport as a CSS var the base menu rule consumes.
	let pillEl = $state<HTMLElement>();
	// First menu-item, so opening the menu can move keyboard focus INTO the dropdown
	// (the backdrop is no longer a focusable dismiss control).
	let menuEl = $state<HTMLElement>();

	const showSearchResults = $derived(
		searchResultsOpen && search.trim().length > 0 && searchResults.length > 0,
	);
	const showGoogleAttribution = $derived(
		showSearchResults && searchResults.some((result) => result.attribution === 'google'),
	);
	// The pill widens the moment the menu opens (per yesid's compact tier); no box
	// shadow while open so the dropdown reads as the elevated layer.
	const overlayActive = $derived(menuOpen);

	// Pin the dropdown's right edge to the pill's right edge at every width. The pill is
	// intrinsic-width + centred in a full-width rail, so its right edge sits near the
	// viewport centre-right; measuring it (viewport width − pill.right) gives the
	// inset-inline-end the dropdown should use, published as --nav-pill-right on the
	// rail. Recomputed whenever the menu opens or the viewport resizes.
	function syncPillAnchor(): void {
		if (typeof window === 'undefined' || !rootEl || !pillEl) return;
		const rect = pillEl.getBoundingClientRect();
		const rightInset = Math.max(0, Math.round(window.innerWidth - rect.right));
		rootEl.style.setProperty('--nav-pill-right', `${rightInset}px`);
	}
	function onPillTransitionEnd(event: TransitionEvent): void {
		if (
			!menuOpen ||
			event.target !== event.currentTarget ||
			!event.propertyName.startsWith('padding')
		) {
			return;
		}
		syncPillAnchor();
	}

	$effect(() => {
		if (!menuOpen) return;
		syncPillAnchor();
	});

	// Focus goes into the menu container on open; closeMenu() returns it to the
	// hamburger. Search is a persistent compact top-bar destination, not menu content.
	$effect(() => {
		if (!menuOpen || !menuEl) return;
		menuEl.focus();
	});

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		const value = search.trim();
		onsearch?.(value);
		if (value) {
			searchResultsOpen = false;
			menuOpen = false;
		}
	}

	function selectResult(result: ChromeSearchResult): void {
		onresultselect?.(result);
		searchResultsOpen = false;
		menuOpen = false;
	}

	function openSearchResults(): void {
		if (search.trim()) searchResultsOpen = true;
	}

	function handleSearchInput(): void {
		searchResultsOpen = true;
	}

	function toggleMenu(): void {
		menuOpen = !menuOpen;
	}

	// Close the menu and return focus to its trigger (Escape / backdrop / nav-link).
	function closeMenu(): void {
		if (!menuOpen) return;
		menuOpen = false;
		menuToggle?.focus();
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && showSearchResults) {
			searchResultsOpen = false;
			return;
		}
		if (e.key === 'Escape' && menuOpen) {
			e.stopPropagation();
			closeMenu();
		}
	}

	function onWindowPointerDown(event: PointerEvent): void {
		if (!rootEl || !(event.target instanceof Node)) return;
		if (!rootEl.contains(event.target)) searchResultsOpen = false;
	}

	function resultAria(result: ChromeSearchResult): string {
		const kind = resultKindLabel(result);
		return result.meta ? `${kind} ${result.label} ${result.meta}` : `${kind} ${result.label}`;
	}

	function resultKindLabel(result: ChromeSearchResult): string {
		if (result.kind === 'route') return locale === 'fr' ? 'Ligne' : 'Route';
		if (result.kind === 'stop') return locale === 'fr' ? 'Arrêt' : 'Stop';
		if (result.kind === 'address') return locale === 'fr' ? 'Adresse' : 'Address';
		return 'Bus';
	}
</script>

<svelte:window
	onkeydown={onKeydown}
	onpointerdown={onWindowPointerDown}
	onresize={() => {
		if (menuOpen) syncPillAnchor();
	}}
/>

<nav
	bind:this={rootEl}
	class={cn('nav-root', className)}
	aria-label={navAria}
	data-slot="nav-pill-root"
>
	<div
		bind:this={pillEl}
		class="nav-pill"
		class:nav-pill-compact={overlayActive}
		data-testid="nav-pill"
		data-slot="nav-pill"
		ontransitionend={onPillTransitionEnd}
	>
		<!-- BRAND: the "Transit" product wordmark (→ /). transit.yesid.dev is a
		     yesid.dev product, but here the pill wordmark is the PRODUCT home (the
		     parent-brand "Yesid" link lives in the menu), so it reads "Transit" with
		     the orange terminal dot and routes to the dashboard root. -->
		<BrandWordmark
			href={localizeHref('/', locale)}
			text="Transit"
			external={false}
			class="nav-wordmark"
		/>

		<span class="nav-divider nav-divider-collapsible" aria-hidden="true"></span>

		<!-- PRIMARY LINKS: Map / Lines / Stops / Network. Shown ≥lg; below lg the pill
		     drops them (they'd push the controls + hamburger off-screen) and the menu
		     dropdown carries them instead — the hamburger is the compact nav entry. -->
		<div class="nav-links" data-slot="nav-links">
			{#each navItems as item (item.key)}
				<a
					href={item.href}
					class="nav-pill-link"
					aria-current={item.active ? 'page' : undefined}
					use:magnetic={{ strength: 3, radius: 44 }}
				>
					{item.label}
				</a>
			{/each}
		</div>

		<span class="nav-divider nav-divider-collapsible" aria-hidden="true"></span>

		<!-- SEARCH: a compact in-pill field ≥lg; compact widths use the icon below. -->
		<form class="nav-search" role="search" onsubmit={submitSearch} data-slot="nav-search">
			<SearchIcon class="nav-search-icon" size={14} strokeWidth={1.8} aria-hidden="true" />
			<input
				type="search"
				name="network-search"
				bind:value={search}
				placeholder={searchPlaceholder}
				aria-label={searchAria}
				autocomplete="off"
				spellcheck="false"
				onfocus={openSearchResults}
				oninput={handleSearchInput}
				class="nav-search-input"
			/>
			{#if showSearchResults}
				<div class="nav-search-results" role="group" aria-label={searchAria}>
					{#each searchResults as result (`${result.kind}:${result.id}`)}
						<button
							type="button"
							class="nav-search-result"
							aria-label={resultAria(result)}
							onclick={() => selectResult(result)}
						>
							<span class="nav-search-main">
								<span class="nav-search-kind">{resultKindLabel(result)}</span>
								<span class="nav-search-label">{result.label}</span>
							</span>
							{#if result.meta}
								<small>{result.meta}</small>
							{/if}
						</button>
					{/each}
					{#if showGoogleAttribution}
						<div class="nav-google-attribution" aria-label="Powered by Google">
							<span>Powered by</span>
							<span class="nav-google-wordmark" aria-hidden="true">
								<span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span>
							</span>
						</div>
					{/if}
				</div>
			{/if}
		</form>

		<span class="nav-divider" aria-hidden="true"></span>

		<!-- CONTROLS: refresh · compact search · theme signal · language · menu. -->
		<div class="nav-controls" data-slot="nav-controls">
			<RefreshButton {locale} class="nav-control" />
			<a
				href={localizeHref('/search', locale)}
				class="tap-press nav-control nav-compact-search"
				aria-label={searchAria}
				data-slot="nav-compact-search"
			>
				<SearchIcon size={17} strokeWidth={1.8} aria-hidden="true" />
			</a>
			<ThemeToggle {locale} class="nav-control" />
			<LangSwitch {locale} {url} {availableLocales} class="nav-control" />

			<button
				bind:this={menuToggle}
				type="button"
				class="tap-press nav-menu-toggle"
				aria-label={menuOpen ? closeMenuAria : openMenuAria}
				aria-expanded={menuOpen}
				onclick={toggleMenu}
				data-slot="nav-menu-toggle"
			>
				<span class="nav-menu-line nav-menu-line-top"></span>
				<span class="nav-menu-line nav-menu-line-bottom"></span>
			</button>
		</div>
	</div>

	{#if menuOpen}
		<!-- Scrim + click-away dismiss. A real, LABELLED dismiss control (NOT
		     aria-hidden — an aria-hidden element that owns/contains focus trips the
		     "Blocked aria-hidden … retained focus" console error). tabindex=-1 keeps it
		     out of the tab sequence (keyboard dismisses via Escape); focus lives inside
		     the menu, so nothing focusable hides behind an aria-hidden ancestor. -->
		<button
			type="button"
			class="nav-menu-backdrop"
			tabindex="-1"
			aria-label={closeMenuAria}
			onclick={closeMenu}
		></button>

		<div
			bind:this={menuEl}
			class="nav-menu glass-chrome"
			tabindex="-1"
			role="dialog"
			aria-modal="false"
			aria-label={menuAria}
			data-testid="nav-menu"
			data-slot="nav-menu"
		>
			<!-- PRIMARY (compact only, <lg): the in-pill .nav-links row is hidden below lg,
			     so the dropdown carries Map/Lines/Stops/Network there. Hidden ≥lg by CSS —
			     the pill's own link row is the desktop entry. FLAT — no visible heading;
			     the group aria-label carries the wayfinding grouping for AT. -->
			<div
				class="nav-menu-primary-group"
				role="group"
				aria-label={primaryGroupLabel}
				data-slot="nav-menu-primary"
			>
				{#each navItems as item (item.key)}
					<a
						href={item.href}
						class="nav-menu-link"
						aria-current={item.active ? 'page' : undefined}
						onclick={closeMenu}
					>
						<span>{item.label}</span>
					</a>
				{/each}
			</div>

			<!-- AUDIT (accountability/meta) surfaces — a flat continuation of the
			     destination list, no visible heading; a quiet hairline (CSS) is the only
			     separator from the primaries. The group aria-label is AT-only. -->
			<div class="nav-menu-group" role="group" aria-label={auditLabel} data-slot="nav-menu-audit">
				{#each auditItems as item (item.key)}
					<a
						href={item.href}
						class="nav-menu-link"
						aria-current={item.active ? 'page' : undefined}
						onclick={closeMenu}
					>
						<span>{item.label}</span>
					</a>
				{/each}
			</div>

			{#if compactLanguageTarget}
				<!-- At phone widths narrower than 360px, five 44px top controls cannot fit.
				     The signpost moves here without removing the locale path from navigation. -->
				<a
					href={compactLanguageTarget.href}
					class="nav-menu-language"
					aria-label={compactLanguageTarget.aria}
					data-sveltekit-preload-data="hover"
					data-sveltekit-noscroll
					onclick={closeMenu}
				>
					{compactLanguageTarget.label}
				</a>
			{/if}

			<!-- Parent-brand "Yesid" link OUT to yesid.dev — the final menu row, with an
			     external ↗ affordance + rel="noopener". This replaces the old pill-click
			     house link (the pill wordmark now reads "Transit"). -->
			<a
				href={YESID_HOUSE_LINK.href}
				target="_blank"
				rel="noopener noreferrer"
				class="nav-menu-house"
				aria-label={yesidHouseAria}
				onclick={closeMenu}
			>
				<span class="nav-menu-house-wordmark"
					><span>{yesidHouseLabel}</span><span class="text-primary">.</span></span
				>
				<ArrowUpRightIcon size={15} strokeWidth={2} aria-hidden="true" />
			</a>
		</div>
	{/if}
</nav>

<style>
	/* --pill-h is the deterministic per-breakpoint pill height (content 44px +
	   2·padV + 2·2px border) published on :root by PLAIN CSS, so the single
	   --chrome-offset knob (AppShell) tracks it with no JS measurement. Desktop
	   pad 12 → 72px; ≤767 pad 8 → 64px; ≤479 pad 6 → 60px. */
	:root {
		--pill-h: 72px;
	}

	/* The fixed, full-width rail: pointer-events-none so the map/content underneath
	   stays interactive edge-to-edge; the pill re-enables events on itself. Top
	   inset folds in the notch safe-area. z = --z-nav (above the rail + detail
	   overlays; the map chrome caps under it). */
	.nav-root {
		position: fixed;
		inset-block-start: calc(1rem + env(safe-area-inset-top, 0px));
		inset-inline: 0;
		z-index: var(--z-nav);
		display: flex;
		flex-direction: column;
		align-items: center;
		pointer-events: none;
	}

	/* The pill — the yesid capsule chassis (SOLID-family glass): --radius-pill,
	   2px --border-brand, 92% background mix, blur(16px), --shadow-nav. Intrinsic
	   width (grows/shrinks with content), centred. pointer-events re-enabled. */
	.nav-pill {
		pointer-events: auto;
		position: relative;
		z-index: var(--z-nav);
		display: flex;
		align-items: center;
		gap: 0;
		max-width: calc(100vw - 1.5rem);
		padding: 12px 28px;
		background: color-mix(in srgb, var(--background) 92%, transparent);
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-nav);
		backdrop-filter: blur(16px) saturate(1.1);
		-webkit-backdrop-filter: blur(16px) saturate(1.1);
		transition:
			padding var(--duration-normal) var(--ease-default),
			box-shadow var(--duration-normal) var(--ease-default);
	}

	/* Menu-open (compact) tier: tighten to 12/20 and drop the shadow so the
	   dropdown reads as the elevated layer. */
	.nav-pill-compact {
		padding: 12px 20px;
		box-shadow: none;
	}

	/* Orange vertical delimiters — 2px × 18px, brand tint, 20px inline margin. */
	.nav-divider {
		flex: none;
		width: 2px;
		height: 18px;
		margin-inline: 20px;
		background: var(--border-brand);
	}

	/* Dividers that flank the below-lg-hidden primary links + search: collapse with
	   them so the compact pill keeps one brand→controls delimiter, not empty rules. */
	.nav-divider-collapsible {
		display: none;
	}

	/* The in-pill primary links are a ≥lg affordance: below lg they are removed (the
	   menu dropdown's Explore group carries them), so the controls + hamburger never get
	   pushed off the pill's right edge on a compact viewport. */
	.nav-links {
		display: none;
		align-items: center;
		gap: 28px;
	}

	/* Nav link — 15px/500, --secondary-foreground at rest, --primary active/hover.
	   The 44px hit area is guaranteed by min-height + centred flex. Active carries
	   a 3×3 amber dot at bottom 4px; NO text-shadow (glow-never-text). */
	.nav-pill-link {
		position: relative;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-family: var(--font-heading);
		font-size: 0.9375rem;
		font-weight: 500;
		line-height: 1;
		color: var(--secondary-foreground);
		text-decoration: none;
		white-space: nowrap;
		transition: color var(--duration-fast) var(--ease-default);
	}

	.nav-pill-link:hover,
	.nav-pill-link:focus-visible {
		color: var(--primary);
		outline: none;
	}

	.nav-pill-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	.nav-pill-link[aria-current='page'] {
		color: var(--primary);
	}

	/* The "you are here" dot — 3×3 amber, centred, 4px above the baseline edge. */
	.nav-pill-link[aria-current='page']::after {
		content: '';
		position: absolute;
		bottom: 4px;
		left: 50%;
		width: 3px;
		height: 3px;
		border-radius: var(--radius-pill);
		background: var(--accent);
		transform: translateX(-50%);
	}

	/* SEARCH — full field at ≥lg. Compact widths get a persistent icon in controls. */
	.nav-search {
		position: relative;
		display: none;
		align-items: center;
		min-width: 0;
	}

	.nav-search :global(.nav-search-icon) {
		position: absolute;
		left: 0.5rem;
		pointer-events: none;
		color: var(--muted-foreground);
	}

	.nav-search-input {
		width: clamp(11rem, 22vw, 20rem);
		min-width: 0;
		height: 36px;
		padding: 0 0.75rem 0 1.9rem;
		font-size: var(--text-small);
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 70%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-pill);
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}

	.nav-search-input::placeholder {
		color: var(--muted-foreground);
	}

	.nav-search-input:focus-visible {
		border-color: var(--primary);
		background: var(--muted);
		/* Carry the same amber ring every other control earns (SearchInput, nav
		   links) — the border-color shift alone was too quiet for a keyboard focus. */
		outline: none;
		box-shadow: 0 0 0 2px var(--ring);
	}

	.nav-controls {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* Every pill control is a ≥44px hit area by construction. */
	.nav-controls :global(.nav-control) {
		min-width: 44px;
		min-height: 44px;
	}

	/* The refresh control stays a compact icon in the pill: its "updated <relative>"
	   readout is a floating-chrome affordance, not pill content — suppress it so the
	   pill keeps its tight capsule width (the readout still rides the button title +
	   aria-label, so freshness stays reachable to AT). */
	.nav-controls :global(.nav-control .refresh-readout) {
		display: none;
	}

	.nav-compact-search {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		color: var(--secondary-foreground);
		background: transparent;
		border-radius: var(--radius-lg);
		text-decoration: none;
		transition:
			color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
	}
	.nav-compact-search:hover {
		color: var(--primary);
		background: var(--muted);
	}
	.nav-compact-search:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}

	/* Hamburger — morphs to an ✕ on open. 44×44 hit area, brand-tint lines. */
	.nav-menu-toggle {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 5px;
		width: 44px;
		height: 44px;
		min-width: 44px;
		min-height: 44px;
		padding: 4px;
		color: var(--secondary-foreground);
		background: transparent;
		border: none;
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-default);
	}

	.nav-menu-toggle:hover,
	.nav-menu-toggle:focus-visible {
		color: var(--foreground);
		outline: none;
	}

	.nav-menu-toggle:focus-visible {
		box-shadow: 0 0 0 2px var(--ring);
	}

	.nav-menu-line {
		display: block;
		height: 1.5px;
		border-radius: var(--radius-pill);
		background: currentColor;
		transition:
			transform var(--duration-normal) var(--ease-default),
			width var(--duration-normal) var(--ease-default);
		transform-origin: center;
	}

	.nav-menu-line-top {
		width: 16px;
	}

	.nav-menu-line-bottom {
		width: 11px;
	}

	.nav-menu-toggle[aria-expanded='true'] .nav-menu-line-top {
		width: 16px;
		transform: translateY(3.25px) rotate(45deg);
	}

	.nav-menu-toggle[aria-expanded='true'] .nav-menu-line-bottom {
		width: 16px;
		transform: translateY(-3.25px) rotate(-45deg);
	}

	/* MENU — one anchored dropdown at every width. Compact widths retain the
	   primary group; ≥1024 hides that duplicate because the pill owns
	   them. The transparent backdrop remains the click-away dismiss surface. */
	.nav-menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-menu);
		background: transparent;
		border: none;
		cursor: default;
		pointer-events: auto;
	}

	.nav-menu {
		pointer-events: auto;
		position: fixed;
		inset-block: auto;
		inset-block-start: calc(1rem + env(safe-area-inset-top, 0px) + var(--pill-h) + 8px);
		inset-inline-end: var(--nav-pill-right, 0.75rem);
		z-index: var(--z-nav);
		display: grid;
		align-content: start;
		gap: 0.375rem;
		width: min(19rem, calc(100vw - 1.5rem));
		max-height: min(
			calc(
				100dvh - var(--pill-h) - 3rem - env(safe-area-inset-top, 0px) -
					env(safe-area-inset-bottom, 0px)
			),
			42rem
		);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.65rem;
		border-radius: var(--radius-xl);
		/* .glass-chrome supplies background + hairline + blur + shadow. */
	}

	/* Preserve the existing tablet/desktop cap; every other dropdown declaration
	   now lives in the base rule so phones use the same presentation. */
	@media (min-width: 768px) {
		.nav-menu {
			max-height: min(calc(100dvh - var(--pill-h) - 3rem), 34rem);
		}
	}

	.nav-menu-primary-group,
	.nav-menu-group {
		display: grid;
		gap: 0.375rem;
	}

	.nav-menu-language {
		display: none;
		min-height: 44px;
		align-items: center;
		margin-top: 0.5rem;
		padding: 0.5rem;
		font-family: var(--font-heading);
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--foreground);
		text-decoration: none;
		border-top: 1px solid var(--border-subtle);
	}

	/* Audit sits under a hairline; Explore leads the compact dropdown. */
	.nav-menu-group {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-subtle);
	}

	/* The in-pill primary links + full search are hidden below lg; the dropdown's
	   Explore group is hidden at and above lg (the pill is the desktop entry). The
	   two dividers flanking the hidden links/search collapse with them so a compact
	   pill reads Brand · | · Controls, not three empty rules. */
	@media (min-width: 1024px) {
		.nav-links {
			display: flex;
		}
		.nav-divider-collapsible {
			display: block;
		}
		.nav-search {
			display: flex;
		}
		.nav-compact-search,
		.nav-menu-primary-group {
			display: none;
		}
		.nav-menu-group {
			margin-top: 0;
			padding-top: 0;
			border-top: 0;
		}
	}
	.nav-menu-link {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 44px;
		padding: 0.5rem 0.65rem;
		color: var(--foreground);
		background: var(--muted);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-decoration: none;
		transition:
			color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}

	.nav-menu-link:hover,
	.nav-menu-link:focus-visible,
	.nav-menu-link[aria-current='page'] {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
		border-color: color-mix(in srgb, var(--primary) 44%, var(--border) 56%);
		outline: none;
	}

	.nav-menu-link span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.nav-menu-house {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 44px;
		margin-top: 0.5rem;
		padding: 0.5rem 0.65rem;
		color: var(--foreground);
		background: color-mix(in srgb, var(--foreground) 4%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		text-decoration: none;
		transition:
			color var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}

	.nav-menu-house:hover,
	.nav-menu-house:focus-visible {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
		border-color: color-mix(in srgb, var(--primary) 44%, var(--border) 56%);
		outline: none;
	}

	/* The external ↗ affordance rides muted until the row is hover/focused. */
	.nav-menu-house :global(svg) {
		flex: none;
		color: var(--muted-foreground);
		transition: color var(--duration-fast) var(--ease-default);
	}

	.nav-menu-house:hover :global(svg),
	.nav-menu-house:focus-visible :global(svg) {
		color: var(--primary);
	}

	.nav-menu-house-wordmark {
		display: inline-flex;
		align-items: baseline;
		font-family: var(--font-heading);
		font-size: 18px;
		font-weight: 700;
		line-height: 1;
		white-space: nowrap;
	}

	/* SEARCH RESULTS — anchored under the in-pill field (≥lg). */
	.nav-search-results {
		position: absolute;
		z-index: var(--z-nav);
		top: calc(100% + 0.5rem);
		left: 0;
		width: min(max(100%, 28rem), calc(100vw - 2rem));
		display: grid;
		gap: 0.25rem;
		max-height: min(22rem, calc(100dvh - var(--pill-h) - 3rem));
		overflow-y: auto;
		padding: 0.375rem;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--background) 96%, transparent);
		border: 1px solid var(--border-brand);
		box-shadow: var(--shadow-nav);
		backdrop-filter: blur(16px) saturate(1.1);
		-webkit-backdrop-filter: blur(16px) saturate(1.1);
	}

	.nav-search-result {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 2.25rem;
		padding: 0.375rem 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--foreground);
		text-align: left;
		background: var(--muted);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.nav-search-result:hover,
	.nav-search-result:focus-visible {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
		border-color: color-mix(in srgb, var(--primary) 44%, var(--border) 56%);
		outline: none;
	}

	.nav-search-main {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		gap: 0.375rem;
	}

	.nav-search-kind {
		flex: none;
		padding: 0.125rem 0.375rem;
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 34%, transparent);
		border-radius: var(--radius-pill);
	}

	.nav-search-label {
		min-width: 0;
		white-space: normal;
		line-height: 1.25;
	}

	.nav-search-result small {
		flex: none;
		color: var(--muted-foreground);
	}

	.nav-google-attribution {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.375rem;
		min-height: 1.5rem;
		padding: 0.25rem 0.5rem 0.375rem;
		color: var(--muted-foreground);
		border-top: 1px solid var(--border-subtle);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}

	.nav-google-wordmark {
		display: inline-flex;
		align-items: baseline;
		font-family: var(--font-heading);
		font-size: var(--text-micro);
		font-weight: 700;
		letter-spacing: 0;
	}

	.nav-google-wordmark span:nth-child(1),
	.nav-google-wordmark span:nth-child(4) {
		color: #4285f4;
	}
	.nav-google-wordmark span:nth-child(2),
	.nav-google-wordmark span:nth-child(6) {
		color: #ea4335;
	}
	.nav-google-wordmark span:nth-child(3) {
		color: #fbbc05;
	}
	.nav-google-wordmark span:nth-child(5) {
		color: #34a853;
	}

	/* PADDING + PILL-HEIGHT TIERS — deterministic --pill-h = 44 + 2·padV + 2·2px. */
	@media (max-width: 1023.98px) {
		.nav-links {
			gap: 18px;
		}
	}

	@media (max-width: 767px) {
		:root {
			--pill-h: 64px;
		}
		.nav-pill {
			padding: 8px 16px;
		}
		.nav-pill-compact {
			padding: 8px 16px;
		}
		.nav-divider {
			margin-inline: 12px;
		}
	}

	@media (max-width: 479px) {
		:root {
			--pill-h: 60px;
		}
		.nav-pill {
			padding: 6px 8px;
		}
		.nav-pill-compact {
			padding: 6px 8px;
		}
		.nav-links {
			gap: 7px;
		}
		.nav-divider {
			margin-inline: 8px;
		}
	}

	@media (max-width: 359px) {
		.nav-controls {
			gap: 0;
		}
		.nav-divider {
			margin-inline: 4px;
		}
		.nav-controls :global([data-slot='lang-switch']) {
			display: none;
		}
		.nav-menu-language {
			display: flex;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-pill,
		.nav-menu-toggle,
		.nav-menu-line,
		.nav-search-input,
		.nav-compact-search,
		.nav-menu-link,
		.nav-menu-language,
		.nav-menu-house {
			transition: none;
		}
	}
</style>

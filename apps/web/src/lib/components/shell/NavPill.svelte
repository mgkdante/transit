<!--
  NavPill — the floating capsule nav (replaces TopBar). A fixed, full-width,
  pointer-events-none rail centring an intrinsic-width pill (pointer-events-auto)
  that floats OVER the map/document, edge-to-edge, and NEVER reserves a chrome
  band — the single --chrome-offset knob (AppShell) reclaims the space on
  non-full-bleed pages.

  Content order (§C2.1, built exactly):
    BrandWordmark · divider · Map / Lines / Stops / Network · divider ·
    search (≥lg compact in-pill field; <lg an icon → the menu sheet) · divider ·
    LangSwitch + ThemeToggle · hamburger → the Audit menu.

  The Audit menu (Metrics · Status · Hotspots · Receipt · Repeat offenders ·
  Alerts, + Search on <lg) opens as a full-height sheet ≤767px and an anchored
  dropdown ≥768px — both wear the shared .glass-chrome recipe (§C4 P4).

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
	import XIcon from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils';
	import {
		type Locale,
		DEFAULT_LOCALE,
		PUBLISHED_LOCALES,
		delocalizePath,
		getLocale,
		localizeHref,
	} from '$lib/i18n';
	import type { ChromeSearchResult, ChromeSearchScope } from '$lib/search/chromeSearch';
	import { SURFACE_NAV, AUDIT_NAV, isSurfaceActive } from '$lib/content/nav';
	import BrandWordmark from './BrandWordmark.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import LangSwitch from './LangSwitch.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';

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
	const closeSearchAria = $derived(locale === 'fr' ? 'Fermer la recherche' : 'Close search');
	const openMenuAria = $derived(locale === 'fr' ? 'Ouvrir le menu' : 'Open menu');
	const closeMenuAria = $derived(locale === 'fr' ? 'Fermer le menu' : 'Close menu');
	const menuAria = $derived(locale === 'fr' ? 'Menu de navigation' : 'Navigation menu');
	const navAria = $derived(locale === 'fr' ? 'Navigation principale' : 'Primary navigation');
	// The Audit group (accountability/meta surfaces) — same AUDIT_NAV the LeftRail
	// iterates, localized + active-aware, so a route rename lands in one place.
	const auditLabel = $derived(locale === 'fr' ? 'Vérification' : 'Audit');
	const searchGroupLabel = $derived(locale === 'fr' ? 'Recherche' : 'Search');
	// The primary surfaces (Map/Lines/Stops/Network) — the sheet counterpart of the
	// in-pill .nav-links row, which is hidden below lg. Without this, compact-width
	// mobile nav would be a dead-end (the hamburger only reached Audit + Search).
	const primaryGroupLabel = $derived(locale === 'fr' ? 'Explorer' : 'Explore');

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
	let sheetSearchInput = $state<HTMLInputElement>();
	// The hamburger toggle, so closing the menu (Escape / backdrop / nav-link) can
	// return focus to its trigger — the pill is now the only mobile nav escape.
	let menuToggle = $state<HTMLButtonElement>();
	let searchResultsOpen = $state(true);
	let rootEl = $state<HTMLElement>();

	const showSearchResults = $derived(
		searchResultsOpen && search.trim().length > 0 && searchResults.length > 0,
	);
	const showGoogleAttribution = $derived(
		showSearchResults && searchResults.some((result) => result.attribution === 'google'),
	);
	// The pill widens the moment the menu opens (per yesid's compact tier); no box
	// shadow while open so the dropdown reads as the elevated layer.
	const overlayActive = $derived(menuOpen);

	// Focus the sheet search field when the menu opens on a <lg viewport where the
	// in-pill field is hidden (the sheet carries the only search entry there).
	$effect(() => {
		if (!menuOpen || !sheetSearchInput) return;
		// Only autofocus when the sheet search is actually visible (<lg); a matchMedia
		// guard keeps desktop keyboard flow on the hamburger, not a hidden field.
		if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches) return;
		sheetSearchInput.focus();
		sheetSearchInput.select();
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

<svelte:window onkeydown={onKeydown} onpointerdown={onWindowPointerDown} />

<nav
	bind:this={rootEl}
	class={cn('nav-root', className)}
	aria-label={navAria}
	data-slot="nav-pill-root"
>
	<div
		class="nav-pill"
		class:nav-pill-compact={overlayActive}
		data-testid="nav-pill"
		data-slot="nav-pill"
	>
		<!-- BRAND: the yesid. house wordmark (→ /). transit.yesid.dev is a yesid.dev
		     product, but here the wordmark is the PRODUCT home (the house link lives
		     in the Audit menu), so it routes to the dashboard root. -->
		<BrandWordmark href={localizeHref('/', locale)} external={false} class="nav-wordmark" />

		<span class="nav-divider nav-divider-collapsible" aria-hidden="true"></span>

		<!-- PRIMARY LINKS: Map / Lines / Stops / Network. Shown ≥lg; below lg the pill
		     drops them (they'd push the controls + hamburger off-screen) and the menu
		     sheet carries them instead — the hamburger is the compact nav entry. -->
		<div class="nav-links" data-slot="nav-links">
			{#each navItems as item (item.key)}
				<a href={item.href} class="nav-pill-link" aria-current={item.active ? 'page' : undefined}>
					{item.label}
				</a>
			{/each}
		</div>

		<span class="nav-divider nav-divider-collapsible" aria-hidden="true"></span>

		<!-- SEARCH: a compact in-pill field ≥lg; below lg it collapses to an icon that
		     opens the menu sheet (which carries the search field there). -->
		<form class="nav-search" role="search" onsubmit={submitSearch} data-slot="nav-search">
			<SearchIcon class="nav-search-icon" size={14} strokeWidth={1.8} aria-hidden="true" />
			<input
				type="search"
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

		<!-- CONTROLS: refresh (recovery affordance) · theme · language · menu. -->
		<div class="nav-controls" data-slot="nav-controls">
			<RefreshButton {locale} class="nav-control" />
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
		<button
			type="button"
			class="nav-menu-backdrop"
			tabindex="-1"
			aria-hidden="true"
			onclick={closeMenu}
		></button>

		<div
			class="nav-menu glass-chrome"
			aria-label={menuAria}
			data-testid="nav-menu"
			data-slot="nav-menu"
		>
			<!-- PRIMARY (sheet only, <lg): the in-pill .nav-links row is hidden below lg,
			     so the sheet carries Map/Lines/Stops/Network there. Hidden ≥lg by CSS —
			     the pill's own link row is the desktop entry. -->
			<div
				class="nav-menu-primary-group"
				role="group"
				aria-label={primaryGroupLabel}
				data-slot="nav-menu-primary"
			>
				<SectionLabel text={primaryGroupLabel} variant="station" class="nav-menu-heading" />
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

			<!-- SEARCH (sheet only, <lg): the in-pill field is hidden below lg, so the
			     menu carries the sole search entry there. Hidden ≥lg by CSS. -->
			<div class="nav-menu-search-group" role="group" aria-label={searchGroupLabel}>
				<SectionLabel text={searchGroupLabel} variant="station" class="nav-menu-heading" />
				<form
					class="nav-menu-search"
					role="search"
					onsubmit={submitSearch}
					data-slot="nav-menu-search"
				>
					<SearchIcon class="nav-search-icon" size={16} strokeWidth={1.8} aria-hidden="true" />
					<input
						bind:this={sheetSearchInput}
						type="search"
						bind:value={search}
						placeholder={searchPlaceholder}
						aria-label={searchAria}
						autocomplete="off"
						spellcheck="false"
						onfocus={openSearchResults}
						oninput={handleSearchInput}
						class="nav-menu-search-input"
						data-slot="nav-menu-search-input"
					/>
					<button
						type="button"
						class="tap-press nav-menu-search-clear"
						aria-label={closeSearchAria}
						onclick={() => (search = '')}
					>
						<XIcon size={15} strokeWidth={2.3} aria-hidden="true" />
					</button>
				</form>
			</div>

			<!-- AUDIT group — the accountability/meta surfaces. -->
			<div class="nav-menu-group" role="group" aria-label={auditLabel} data-slot="nav-menu-audit">
				<SectionLabel text={auditLabel} variant="station" class="nav-menu-heading" />
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

			<a
				href="https://yesid.dev"
				target="_blank"
				rel="noopener noreferrer"
				class="nav-menu-house"
				aria-label="yesid."
			>
				<span class="nav-menu-house-wordmark"
					><span>yesid</span><span class="text-primary">.</span></span
				>
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
	   dropdown/sheet reads as the elevated layer. */
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
	   menu sheet's Explore group carries them), so the controls + hamburger never get
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

	/* SEARCH — the compact in-pill field (≥lg). Below lg it is removed (the menu
	   sheet carries search); a search icon is not needed in the pill there because
	   the hamburger opens the sheet. */
	.nav-search {
		position: relative;
		display: none;
		align-items: center;
		min-width: 0;
	}

	.nav-search :global(.nav-search-icon) {
		position: absolute;
		left: 0.6rem;
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
			background var(--duration-fast) var(--ease-default);
	}

	.nav-search-input::placeholder {
		color: var(--muted-foreground);
	}

	.nav-search-input:focus-visible {
		border-color: var(--primary);
		background: var(--muted);
		outline: none;
	}

	.nav-controls {
		display: flex;
		align-items: center;
		gap: 0.35rem;
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

	/* MENU — full-height sheet ≤767, anchored dropdown ≥768. Both .glass-chrome. */
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
		inset-block: 0;
		inset-inline-end: 0;
		z-index: var(--z-nav);
		display: grid;
		align-content: start;
		gap: 0.35rem;
		width: min(20rem, 92vw);
		max-height: 100dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: calc(1rem + env(safe-area-inset-top, 0px) + var(--pill-h) + 1rem) 1rem
			calc(1rem + env(safe-area-inset-bottom, 0px)) 1rem;
		border-radius: 0;
		/* .glass-chrome supplies background + hairline + blur + shadow. */
	}

	/* ≥768 — an anchored dropdown pinned under the pill, not a full-height sheet. */
	@media (min-width: 768px) {
		.nav-menu {
			inset-block: auto;
			inset-block-start: calc(1rem + env(safe-area-inset-top, 0px) + var(--pill-h) + 8px);
			inset-inline-end: 1rem;
			width: min(19rem, calc(100vw - 1.5rem));
			max-height: min(calc(100dvh - var(--pill-h) - 3rem), 34rem);
			padding: 0.65rem;
			border-radius: var(--radius-xl);
		}
	}

	.nav-menu-heading {
		padding-inline: 0.15rem;
		padding-bottom: 0.1rem;
	}

	.nav-menu-primary-group,
	.nav-menu-group,
	.nav-menu-search-group {
		display: grid;
		gap: 0.35rem;
	}

	/* The Search + Audit groups sit under a hairline; the Explore group leads the
	   sheet, so it takes no top rule. */
	.nav-menu-search-group,
	.nav-menu-group {
		margin-top: 0.5rem;
		padding-top: 0.55rem;
		border-top: 1px solid var(--border-subtle);
	}

	/* The in-pill primary links + search are hidden below lg; the sheet's Explore +
	   Search groups are hidden at and above lg (the pill is the desktop entry). The
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
		.nav-menu-primary-group,
		.nav-menu-search-group {
			display: none;
		}
	}

	.nav-menu-search {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.nav-menu-search :global(.nav-search-icon) {
		position: absolute;
		left: 0.7rem;
		pointer-events: none;
		color: var(--muted-foreground);
	}

	.nav-menu-search-input {
		width: 100%;
		min-width: 0;
		height: 44px;
		padding: 0 2.75rem 0 2.1rem;
		font-size: var(--text-small);
		color: var(--foreground);
		background: color-mix(in srgb, var(--muted) 70%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		transition: border-color var(--duration-fast) var(--ease-default);
	}

	.nav-menu-search-input::placeholder {
		color: var(--muted-foreground);
	}

	.nav-menu-search-input:focus-visible {
		border-color: var(--primary);
		outline: none;
	}

	.nav-menu-search-clear {
		position: absolute;
		right: 0.4rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-default);
	}

	.nav-menu-search-clear:hover,
	.nav-menu-search-clear:focus-visible {
		color: var(--foreground);
		outline: none;
	}

	.nav-menu-link {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 44px;
		padding: 0.55rem 0.65rem;
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
		display: inline-flex;
		align-items: center;
		justify-content: flex-start;
		min-height: 44px;
		margin-top: 0.5rem;
		padding: 0.55rem 0.65rem;
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
		padding: 0.35rem;
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
		padding: 0.4rem 0.55rem;
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
		gap: 0.45rem;
	}

	.nav-search-kind {
		flex: none;
		padding: 0.12rem 0.35rem;
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
		gap: 0.3rem;
		min-height: 1.5rem;
		padding: 0.2rem 0.6rem 0.3rem;
		color: var(--muted-foreground);
		border-top: 1px solid var(--border-subtle);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}

	.nav-google-wordmark {
		display: inline-flex;
		align-items: baseline;
		font-family: var(--font-heading);
		font-size: 0.72rem;
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

	@media (prefers-reduced-motion: reduce) {
		.nav-pill,
		.nav-menu-toggle,
		.nav-menu-line,
		.nav-search-input,
		.nav-menu-search-input,
		.nav-menu-link,
		.nav-menu-house {
			transition: none;
		}
	}
</style>

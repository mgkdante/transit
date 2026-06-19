<!--
  TopBar, the fixed app chrome strip (h60 on desktop).

  Left→right clusters:
    BRAND : the yesid. parent-brand wordmark (-> yesid.dev) · divider · the
            "transit" product home (-> /) with the live LED dot. transit.yesid.dev
            is a yesid.dev product, so the chrome carries the house mark + links home.
    CENTER: a multi-value search input (surface routing is the caller's job).
    RIGHT : the live wall-clock, an alerts bell + count badge, the theme toggle
            and the language switch.

  Composes reusable controls (BrandWordmark / LiveClock / ThemeToggle / LangSwitch);
  the bell + city picker stay inline (TopBar-specific). Persistent chrome: `locale`
  is a prop (with $derived reads) so strings stay reactive across EN⇄FR without a
  remount; falls back to getLocale() context for isolated renders / tests.

  DOCTRINE: orange --primary is INTERACTIVE-only. The live dot is the ONE "system
  is live" affordance; the alerts badge encodes a COUNT (number pill). No --primary
  stands in for data here.
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
	} from '$lib/i18n';
	import type { ChromeSearchResult, ChromeSearchScope } from '$lib/search/chromeSearch';
	import BrandCluster from '$lib/components/brand/BrandCluster.svelte';
	import SurfaceNavList from './SurfaceNavList.svelte';
	import LiveClock from './LiveClock.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import LangSwitch from './LangSwitch.svelte';

	interface TopBarProps {
		/** Active request locale; omitted → getLocale() context. */
		locale?: Locale;
		/** Full current URL, the language switch preserves path + query + hash. */
		url?: URL;
		/** Count of active alerts; renders the bell badge when > 0. */
		alertCount?: number;
		/** Current value of the multi-value search field (bindable). */
		search?: string;
		/** Fired when the search field is submitted (Enter). */
		onsearch?: (value: string) => void;
		/** Search matches shown under the chrome field. */
		searchResults?: readonly ChromeSearchResult[];
		/** Active surface scope, drives the scoped placeholder hint. */
		searchScope?: ChromeSearchScope;
		/** Fired when a search result is selected. */
		onresultselect?: (result: ChromeSearchResult) => void;
		/** Fired when the alerts bell is activated. */
		onalerts?: () => void;
		/** Locales offered in the switcher; defaults to the published set. */
		availableLocales?: readonly Locale[];
		class?: string;
	}

	let {
		locale: localeProp,
		url = new URL('https://transit.local/'),
		alertCount = 0,
		search = $bindable(''),
		onsearch,
		searchResults = [],
		searchScope = 'all',
		onresultselect,
		onalerts,
		availableLocales = PUBLISHED_LOCALES,
		class: className,
	}: TopBarProps = $props();

	// Prop wins (persistent chrome); fall back to context for isolated renders.
	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);
	const currentPath = $derived(delocalizePath(url.pathname));

	// --- Localized strings ---------------------------------------------------
	const liveLabel = $derived(locale === 'fr' ? 'En direct' : 'Live');
	const homeAria = $derived(
		locale === 'fr' ? 'Accueil, tableau de bord transit' : 'Home, transit dashboard',
	);
	// Scoped affordance: the placeholder + aria-label tell the rider the field is
	// restricted to the active surface (a line on /lines, a stop on /stops). FR is
	// canonical; map/all keep the unchanged full-network strings.
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
	const openSearchAria = $derived(locale === 'fr' ? 'Ouvrir la recherche' : 'Open search');
	const closeSearchAria = $derived(locale === 'fr' ? 'Fermer la recherche' : 'Close search');
	const openMenuAria = $derived(locale === 'fr' ? 'Ouvrir le menu' : 'Open menu');
	const closeMenuAria = $derived(locale === 'fr' ? 'Fermer le menu' : 'Close menu');
	const menuAria = $derived(locale === 'fr' ? 'Navigation mobile' : 'Mobile navigation');
	const cityLabel = 'Montréal · STM';
	const cityAria = $derived(locale === 'fr' ? 'Choisir une ville' : 'Choose a city');
	const alertsAria = $derived(
		alertCount > 0
			? locale === 'fr'
				? `Alertes (${alertCount} active${alertCount > 1 ? 's' : ''})`
				: `Alerts (${alertCount} active)`
			: locale === 'fr'
				? 'Alertes (aucune)'
				: 'Alerts (none)',
	);
	let mobileSearchOpen = $state(false);
	let mobileMenuOpen = $state(false);
	let mobileSearchInput = $state<HTMLInputElement>();
	let searchResultsOpen = $state(true);
	let headerEl = $state<HTMLElement>();
	// Cap the visible badge count so the pill never blows out the strip.
	const badgeText = $derived(alertCount > 99 ? '99+' : String(alertCount));
	const showSearchResults = $derived(
		searchResultsOpen && search.trim().length > 0 && searchResults.length > 0,
	);
	const showGoogleAttribution = $derived(
		showSearchResults && searchResults.some((result) => result.attribution === 'google'),
	);

	$effect(() => {
		if (!mobileSearchOpen || !mobileSearchInput) return;
		mobileSearchInput.focus();
		mobileSearchInput.select();
	});

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		const value = search.trim();
		onsearch?.(value);
		if (value) {
			searchResultsOpen = false;
			mobileSearchOpen = false;
		}
	}

	function selectResult(result: ChromeSearchResult): void {
		onresultselect?.(result);
		searchResultsOpen = false;
		mobileSearchOpen = false;
	}

	function openSearchResults(): void {
		if (search.trim()) searchResultsOpen = true;
	}

	function handleSearchInput(): void {
		searchResultsOpen = true;
	}

	function openMobileSearch(): void {
		mobileMenuOpen = false;
		mobileSearchOpen = true;
	}

	function toggleMobileMenu(): void {
		mobileSearchOpen = false;
		mobileMenuOpen = !mobileMenuOpen;
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && showSearchResults) {
			searchResultsOpen = false;
		}
		if (e.key === 'Escape' && mobileSearchOpen) {
			e.stopPropagation();
			mobileSearchOpen = false;
		}
		if (e.key === 'Escape' && mobileMenuOpen) {
			e.stopPropagation();
			mobileMenuOpen = false;
		}
	}

	function onWindowPointerDown(event: PointerEvent): void {
		if (!headerEl || !(event.target instanceof Node)) return;
		if (!headerEl.contains(event.target)) searchResultsOpen = false;
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

<header
	bind:this={headerEl}
	class={cn(
		'relative z-40 flex h-[60px] w-full shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:gap-4 sm:px-4',
		className,
	)}
	data-slot="topbar"
>
	<!-- BRAND: yesid. (-> yesid.dev) · transit home + live dot, shared cluster. -->
	<BrandCluster variant="topbar" productHref="/" productAria={homeAria} {liveLabel} />

	<!-- City picker placeholder (no Family data in 9.2) -------------------- -->
	<button
		type="button"
		class="tap-press hidden shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle bg-popover px-2.5 py-1.5 text-small text-foreground transition-colors hover:border-primary hover:text-primary lg:inline-flex"
		aria-label={cityAria}
		data-slot="topbar-city"
		disabled
	>
		<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none">
			<path
				d="M8 1.5c-2.5 0-4.5 2-4.5 4.5 0 3.2 4.5 8 4.5 8s4.5-4.8 4.5-8c0-2.5-2-4.5-4.5-4.5Z"
				stroke="currentColor"
				stroke-width="1.3"
			/>
			<circle cx="8" cy="6" r="1.6" stroke="currentColor" stroke-width="1.3" />
		</svg>
		<span class="font-mono text-caption">{cityLabel}</span>
	</button>

	<!-- CENTER: multi-value search ----------------------------------------- -->
	<form
		class="relative hidden min-w-0 flex-1 items-center md:flex"
		role="search"
		onsubmit={submitSearch}
		data-slot="topbar-search"
	>
		<SearchIcon
			class="pointer-events-none absolute left-2.5 text-muted-foreground"
			size={15}
			strokeWidth={1.8}
			aria-hidden="true"
		/>
		<input
			type="search"
			bind:value={search}
			placeholder={searchPlaceholder}
			aria-label={searchAria}
			autocomplete="street-address"
			spellcheck="false"
			onfocus={openSearchResults}
			oninput={handleSearchInput}
			class="h-9 w-full min-w-0 rounded-lg border border-border-subtle bg-popover pl-8 pr-3 text-small text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
		/>
		{#if showSearchResults}
			<div class="topbar-search-results" role="group" aria-label={searchAria}>
				{#each searchResults as result (`${result.kind}:${result.id}`)}
					<button
						type="button"
						class="topbar-search-result"
						aria-label={resultAria(result)}
						onclick={() => selectResult(result)}
					>
						<span class="topbar-search-main">
							<span class="topbar-search-kind">{resultKindLabel(result)}</span>
							<span class="topbar-search-label">{result.label}</span>
						</span>
						{#if result.meta}
							<small>{result.meta}</small>
						{/if}
					</button>
				{/each}
				{#if showGoogleAttribution}
					<div class="topbar-google-attribution" aria-label="Powered by Google">
						<span>Powered by</span>
						<span class="topbar-google-wordmark" aria-hidden="true">
							<span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span>
						</span>
					</div>
				{/if}
			</div>
		{/if}
	</form>

	<!-- RIGHT: clock · alerts · theme · lang ------------------------------- -->
	<div class="ml-auto flex shrink-0 items-center gap-1 sm:gap-2" data-slot="topbar-controls">
		<LiveClock {locale} class="hidden sm:inline" />

		<button
			type="button"
			class="tap-press inline-flex size-9 items-center justify-center rounded-lg text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 md:hidden"
			aria-label={openSearchAria}
			aria-expanded={mobileSearchOpen}
			onclick={openMobileSearch}
			data-slot="topbar-mobile-search-toggle"
		>
			<SearchIcon size={18} strokeWidth={2.15} aria-hidden="true" />
		</button>

		<!-- Refresh-data control + freshness readout (recovery affordance for an
		     unreachable /v1; re-runs every data source on the page). -->
		<RefreshButton {locale} />

		<!-- Alerts bell + count badge -->
		<button
			type="button"
			class="tap-press relative inline-flex size-9 items-center justify-center rounded-lg text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
			aria-label={alertsAria}
			onclick={() => onalerts?.()}
			data-slot="topbar-alerts"
		>
			<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none">
				<path
					d="M10 2.5a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.2 4.8-1.8 5.4-.3.3-.1.85.32.85h11.96c.42 0 .62-.55.32-.85-.6-.6-1.8-1.9-1.8-5.4A4.5 4.5 0 0 0 10 2.5Z"
					stroke="currentColor"
					stroke-width="1.4"
					stroke-linejoin="round"
				/>
				<path
					d="M8.4 16a1.7 1.7 0 0 0 3.2 0"
					stroke="currentColor"
					stroke-width="1.4"
					stroke-linecap="round"
				/>
			</svg>
			{#if alertCount > 0}
				<span
					class="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[0.625rem] font-bold leading-4 text-primary-foreground"
					data-slot="topbar-alerts-badge"
				>
					{badgeText}
				</span>
			{/if}
		</button>

		<ThemeToggle {locale} />
		<LangSwitch {locale} {url} {availableLocales} />

		<button
			type="button"
			class="tap-press topbar-menu-toggle md:hidden"
			aria-label={mobileMenuOpen ? closeMenuAria : openMenuAria}
			aria-expanded={mobileMenuOpen}
			onclick={toggleMobileMenu}
			data-slot="topbar-mobile-menu-toggle"
		>
			<span class="topbar-menu-line topbar-menu-line-top"></span>
			<span class="topbar-menu-line topbar-menu-line-bottom"></span>
		</button>
	</div>

	{#if mobileSearchOpen}
		<button
			type="button"
			class="topbar-mobile-search-backdrop md:hidden"
			tabindex="-1"
			aria-label={closeSearchAria}
			onclick={() => (mobileSearchOpen = false)}
		></button>

		<div class="topbar-mobile-search md:hidden" data-testid="topbar-mobile-search">
			<form
				class="relative flex min-w-0 items-center"
				role="search"
				onsubmit={submitSearch}
				data-slot="topbar-mobile-search"
			>
				<SearchIcon
					class="pointer-events-none absolute left-3 text-muted-foreground"
					size={16}
					strokeWidth={1.8}
					aria-hidden="true"
				/>
				<input
					bind:this={mobileSearchInput}
					type="search"
					bind:value={search}
					placeholder={searchPlaceholder}
					aria-label={searchAria}
					autocomplete="street-address"
					spellcheck="false"
					onfocus={openSearchResults}
					oninput={handleSearchInput}
					class="h-11 w-full min-w-0 rounded-lg border border-border-subtle bg-popover pl-9 pr-10 text-small text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
					data-slot="topbar-mobile-search-input"
				/>
				<button
					type="button"
					class="tap-press absolute right-1.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label={closeSearchAria}
					onclick={() => (mobileSearchOpen = false)}
				>
					<XIcon size={15} strokeWidth={2.3} aria-hidden="true" />
				</button>

				{#if showSearchResults}
					<div
						class="topbar-search-results topbar-search-results-mobile"
						role="group"
						aria-label={searchAria}
					>
						{#each searchResults as result (`${result.kind}:${result.id}`)}
							<button
								type="button"
								class="topbar-search-result"
								aria-label={resultAria(result)}
								onclick={() => selectResult(result)}
							>
								<span class="topbar-search-main">
									<span class="topbar-search-kind">{resultKindLabel(result)}</span>
									<span class="topbar-search-label">{result.label}</span>
								</span>
								{#if result.meta}
									<small>{result.meta}</small>
								{/if}
							</button>
						{/each}
						{#if showGoogleAttribution}
							<div class="topbar-google-attribution" aria-label="Powered by Google">
								<span>Powered by</span>
								<span class="topbar-google-wordmark" aria-hidden="true">
									<span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span
										>e</span
									>
								</span>
							</div>
						{/if}
					</div>
				{/if}
			</form>
		</div>
	{/if}

	{#if mobileMenuOpen}
		<button
			type="button"
			class="topbar-mobile-menu-backdrop md:hidden"
			tabindex="-1"
			aria-hidden="true"
			onclick={() => (mobileMenuOpen = false)}
		></button>

		<nav
			class="topbar-mobile-menu md:hidden"
			aria-label={menuAria}
			data-testid="topbar-mobile-menu"
		>
			<SurfaceNavList {locale} {currentPath} linkClass="topbar-mobile-menu-link" />
			<a
				href="https://yesid.dev"
				target="_blank"
				rel="noopener noreferrer"
				class="topbar-mobile-house"
				aria-label="yesid."
			>
				<span class="topbar-mobile-house-wordmark"
					><span>yesid</span><span class="text-primary">.</span></span
				>
			</a>
		</nav>
	{/if}
</header>

<style>
	/* The brand cluster (yesid. mark · divider · transit home) + its ≤760px
	   collapse now live in BrandCluster.svelte, the shared brand primitive. */
	.topbar-mobile-search-backdrop {
		position: fixed;
		inset: 0;
		z-index: 45;
		background: transparent;
		border: none;
		cursor: default;
	}
	.topbar-mobile-menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 45;
		background: transparent;
		border: none;
		cursor: default;
	}
	.topbar-mobile-search {
		position: absolute;
		z-index: 55;
		top: calc(100% + 0.5rem);
		left: 0.75rem;
		right: 0.75rem;
		padding: 0.45rem;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 82%, var(--primary) 18%);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sheet);
		backdrop-filter: blur(12px);
	}
	.topbar-menu-toggle {
		position: relative;
		z-index: 65;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 5px;
		width: 2.25rem;
		height: 2.25rem;
		min-width: 2.25rem;
		padding: 4px;
		color: var(--secondary-foreground);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			color var(--duration-fast, 120ms) var(--ease-default, ease),
			background var(--duration-fast, 120ms) var(--ease-default, ease);
	}
	.topbar-menu-toggle:hover,
	.topbar-menu-toggle:focus-visible {
		color: var(--foreground);
		background: var(--muted);
		outline: none;
	}
	.topbar-menu-toggle:focus-visible {
		box-shadow: 0 0 0 2px var(--ring);
	}
	.topbar-menu-line {
		display: block;
		height: 1.5px;
		border-radius: var(--radius-pill);
		background: currentColor;
		transition:
			transform var(--duration-normal, 180ms) var(--ease-default, ease),
			width var(--duration-normal, 180ms) var(--ease-default, ease);
		transform-origin: center;
	}
	.topbar-menu-line-top {
		width: 16px;
	}
	.topbar-menu-line-bottom {
		width: 11px;
	}
	.topbar-menu-toggle[aria-expanded='true'] .topbar-menu-line-top {
		width: 16px;
		transform: translateY(3.25px) rotate(45deg);
	}
	.topbar-menu-toggle[aria-expanded='true'] .topbar-menu-line-bottom {
		width: 16px;
		transform: translateY(-3.25px) rotate(-45deg);
	}
	.topbar-mobile-menu {
		position: absolute;
		z-index: 55;
		top: calc(100% + 0.5rem);
		right: 0.75rem;
		display: grid;
		gap: 0.35rem;
		width: min(19rem, calc(100vw - 1.5rem));
		padding: 0.55rem;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 82%, var(--primary) 18%);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-sheet);
		backdrop-filter: blur(12px);
	}
	/* The nav rows are rendered by the shared SurfaceNavList child, so these reach
	   them via :global scoped UNDER the TopBar-owned .topbar-mobile-menu container
	   (no leak, the descendant combinator keeps them confined to this menu). */
	.topbar-mobile-menu :global(.topbar-mobile-menu-link) {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 2.55rem;
		padding: 0.55rem 0.65rem;
		color: var(--foreground);
		background: var(--muted);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-decoration: none;
		transition:
			color var(--duration-fast, 120ms) var(--ease-default, ease),
			background var(--duration-fast, 120ms) var(--ease-default, ease),
			border-color var(--duration-fast, 120ms) var(--ease-default, ease);
	}
	.topbar-mobile-menu :global(.topbar-mobile-menu-link:hover),
	.topbar-mobile-menu :global(.topbar-mobile-menu-link:focus-visible),
	.topbar-mobile-menu :global(.topbar-mobile-menu-link[aria-current='page']) {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
		border-color: color-mix(in srgb, var(--primary) 44%, var(--border) 56%);
		outline: none;
	}
	.topbar-mobile-menu :global(.topbar-mobile-menu-link span) {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.topbar-mobile-menu :global(.topbar-mobile-menu-link small) {
		flex: none;
		color: var(--muted-foreground);
	}
	.topbar-mobile-house {
		display: inline-flex;
		align-items: center;
		justify-content: flex-start;
		min-height: 2.55rem;
		padding: 0.55rem 0.65rem;
		color: var(--foreground);
		background: color-mix(in srgb, var(--foreground) 4%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		text-decoration: none;
		transition:
			color var(--duration-fast, 120ms) var(--ease-default, ease),
			background var(--duration-fast, 120ms) var(--ease-default, ease),
			border-color var(--duration-fast, 120ms) var(--ease-default, ease);
	}
	.topbar-mobile-house:hover,
	.topbar-mobile-house:focus-visible {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
		border-color: color-mix(in srgb, var(--primary) 44%, var(--border) 56%);
		outline: none;
	}
	.topbar-mobile-house-wordmark {
		display: inline-flex;
		align-items: baseline;
		font-family: var(--font-heading);
		font-size: 18px;
		font-weight: 700;
		line-height: 1;
		white-space: nowrap;
	}
	.topbar-google-attribution {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.3rem;
		min-height: 1.5rem;
		padding: 0.2rem 0.6rem 0.3rem;
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--card) 92%, transparent);
		border-top: 1px solid var(--border-subtle);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.topbar-google-wordmark {
		display: inline-flex;
		align-items: baseline;
		font-family: var(--font-heading);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0;
	}
	.topbar-google-wordmark span:nth-child(1),
	.topbar-google-wordmark span:nth-child(4) {
		color: #4285f4;
	}
	.topbar-google-wordmark span:nth-child(2),
	.topbar-google-wordmark span:nth-child(6) {
		color: #ea4335;
	}
	.topbar-google-wordmark span:nth-child(3) {
		color: #fbbc05;
	}
	.topbar-google-wordmark span:nth-child(5) {
		color: #34a853;
	}
	.topbar-search-results {
		position: absolute;
		z-index: 50;
		top: calc(100% + 0.4rem);
		left: 0;
		right: auto;
		width: min(max(100%, 38rem), calc(100vw - 2rem));
		display: grid;
		gap: 0.25rem;
		max-height: min(22rem, calc(100dvh - 5rem));
		overflow-y: auto;
		padding: 0.35rem;
		background: color-mix(in srgb, var(--card) 96%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 82%, var(--primary) 18%);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(10px);
	}
	.topbar-search-results-mobile {
		left: -0.45rem;
		right: -0.45rem;
		width: auto;
		top: calc(100% + 0.45rem);
	}
	.topbar-search-result {
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
	.topbar-search-result:hover,
	.topbar-search-result:focus-visible {
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, var(--muted) 90%);
		border-color: color-mix(in srgb, var(--primary) 44%, var(--border) 56%);
		outline: none;
	}
	.topbar-search-main {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		gap: 0.45rem;
	}
	.topbar-search-kind {
		flex: none;
		padding: 0.12rem 0.35rem;
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 34%, transparent);
		border-radius: var(--radius-pill);
	}
	.topbar-search-label {
		min-width: 0;
		overflow: visible;
		text-overflow: clip;
		white-space: normal;
		line-height: 1.25;
	}
	.topbar-search-result small {
		flex: none;
		color: var(--muted-foreground);
	}
	@media (min-width: 768px) {
		.topbar-menu-toggle,
		.topbar-mobile-menu,
		.topbar-mobile-menu-backdrop {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.topbar-menu-toggle,
		.topbar-menu-line,
		.topbar-mobile-house {
			transition: none;
		}
		.topbar-mobile-menu :global(.topbar-mobile-menu-link) {
			transition: none;
		}
	}
</style>

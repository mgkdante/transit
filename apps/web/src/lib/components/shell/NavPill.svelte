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
	import type { TransitModeKey } from '$lib/search/stopMode';
	import { SvelteSet } from 'svelte/reactivity';
	import SearchControls, {
		type SearchScopeKey,
	} from '$lib/components/surface/SearchControls.svelte';
	import { SURFACE_NAV, AUDIT_NAV, YESID_HOUSE_LINK, isSurfaceActive } from '$lib/content/nav';
	import { footerCopy } from '$lib/components/layout/footer.copy';
	import { navPillCopy } from './navPill.copy';
	import { magnetic } from '@yesid/motion';
	import BrandWordmark from './BrandWordmark.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import LangSwitch from './LangSwitch.svelte';
	import { providerHref, type PublicProvider } from '$lib/v1/providers';
	import { v1Provider } from '$lib/v1/config';

	interface NavPillProps {
		locale?: Locale;
		url?: URL;
		providerName?: string;
		providerShortName?: string;
		providerId?: string;
		providers?: PublicProvider[];
		search?: string;
		onsearch?: (value: string) => void;
		searchResults?: readonly ChromeSearchResult[];
		searchScope?: ChromeSearchScope;
		searchModes?: SvelteSet<TransitModeKey>;
		onresultselect?: (result: ChromeSearchResult) => void;
		availableLocales?: readonly Locale[];
		class?: string;
	}

	let {
		locale: localeProp,
		url = new URL('https://transit.local/'),
		providerName: _providerName,
		providerShortName: _providerShortName,
		providerId = v1Provider(url),
		providers = [],
		search = $bindable(''),
		onsearch,
		searchResults = [],
		searchScope = 'all',
		searchModes = new SvelteSet<TransitModeKey>(),
		onresultselect,
		availableLocales = PUBLISHED_LOCALES,
		class: className,
	}: NavPillProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);
	const selectedUrl = $derived(
		new URL(localizeHref(url.pathname + url.search + url.hash, locale, providerId), url),
	);
	const currentPath = $derived(delocalizePath(url.pathname));

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
	const auditLabel = $derived(footerCopy[locale].auditLabel);
	const navCopy = $derived(navPillCopy[locale]);
	const searchCollectionNotice = $derived(navCopy.searchCollectionNotice);
	const transmitsSearches = $derived(searchScope === 'map' || searchScope === 'all');
	const blendIsMixed = $derived(searchScope === 'map' || searchScope === 'all');
	const primaryGroupLabel = $derived(locale === 'fr' ? 'Explorer' : 'Explore');
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
			href: localizeUrl(selectedUrl, target),
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
			href: localizeHref(item.href, locale, providerId),
			label: item.label[locale],
			active: isSurfaceActive(item, currentPath),
		})),
	);
	const auditItems = $derived(
		AUDIT_NAV.map((item) => ({
			key: item.key,
			href: localizeHref(item.href, locale, providerId),
			label: item.label[locale],
			active: isSurfaceActive(item, currentPath),
		})),
	);

	let menuOpen = $state(false);
	let menuToggle = $state<HTMLButtonElement>();
	let searchResultsOpen = $state(true);
	let rootEl = $state<HTMLElement>();
	let pillEl = $state<HTMLElement>();
	let menuEl = $state<HTMLElement>();
	$effect(() => {
		if (!rootEl || !pillEl || typeof ResizeObserver === 'undefined') return;
		const root = rootEl.ownerDocument.documentElement;
		const rail = rootEl.querySelector<HTMLElement>('.nav-rail')!;
		const measure = () => {
			const pill = pillEl!.getBoundingClientRect();
			const provider = rootEl!.querySelector('.nav-provider')!.getBoundingClientRect();
			root.style.setProperty(
				'--pill-h',
				`${Math.ceil(Math.max(pill.bottom, provider.bottom) - pill.top)}px`,
			);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(rail);
		measure();
		return () => {
			observer.disconnect();
			root.style.removeProperty('--pill-h');
		};
	});

	let searchFamily = $state<SearchScopeKey>('all');
	const familyOf = (result: ChromeSearchResult): SearchScopeKey =>
		result.kind === 'address' ? 'all' : result.kind;
	const visibleResults = $derived(
		searchFamily === 'all'
			? searchResults
			: searchResults.filter((result) => familyOf(result) === searchFamily),
	);
	$effect(() => {
		if (blendIsMixed) return;
		searchFamily = 'all';
		searchModes.clear();
	});
	const searchScopeSegments = $derived([
		{ key: 'all' as const, label: navCopy.searchScopeAll },
		{
			key: 'route' as const,
			label: navCopy.searchScopeCount(
				navCopy.searchScopeRoutes,
				searchResults.filter((r) => r.kind === 'route').length,
			),
		},
		{
			key: 'stop' as const,
			label: navCopy.searchScopeCount(
				navCopy.searchScopeStops,
				searchResults.filter((r) => r.kind === 'stop').length,
			),
		},
		{
			key: 'vehicle' as const,
			label: navCopy.searchScopeCount(
				navCopy.searchScopeVehicles,
				searchResults.filter((r) => r.kind === 'vehicle').length,
			),
		},
	]);

	const showSearchResults = $derived(
		searchResultsOpen && search.trim().length > 0 && visibleResults.length > 0,
	);
	const overlayActive = $derived(menuOpen);

	function syncPillAnchor(): void {
		if (typeof window === 'undefined' || !rootEl || !pillEl) return;
		const rect = pillEl.getBoundingClientRect();
		const menuRail = rootEl.querySelector<HTMLElement>('.nav-menu-rail');
		const anchorRight = menuRail?.getBoundingClientRect().right ?? window.innerWidth;
		const rightInset = Math.max(0, Math.round(anchorRight - rect.right));
		rootEl.style.setProperty('--nav-pill-right', `${rightInset}px`);
	}
	function onPillTransitionEnd(event: TransitionEvent): void {
		if (
			!menuOpen ||
			event.target !== event.currentTarget ||
			!(event.propertyName === 'transform' || event.propertyName.startsWith('padding'))
		) {
			return;
		}
		syncPillAnchor();
	}

	$effect(() => {
		if (!menuOpen) return;
		syncPillAnchor();
	});

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
		return locale === 'fr' ? 'Véhicule' : 'Vehicle';
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
	<div class="nav-rail" data-slot="nav-rail">
		<div
			bind:this={pillEl}
			class="nav-pill"
			class:nav-pill-compact={overlayActive}
			data-testid="nav-pill"
			data-slot="nav-pill"
			ontransitionend={onPillTransitionEnd}
		>
			<BrandWordmark
				href={localizeHref('/', locale, providerId)}
				text="Transit"
				external={false}
				class="nav-wordmark"
			/>

			<span class="nav-divider nav-divider-collapsible" aria-hidden="true"></span>

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
					aria-describedby={transmitsSearches ? 'nav-search-notice' : undefined}
				/>
				{#if transmitsSearches}
					<span id="nav-search-notice" class="sr-only">{searchCollectionNotice}</span>
				{/if}

				<div class="nav-search-panel" data-slot="nav-search-panel">
					<SearchControls
						variant="panel"
						notice={transmitsSearches ? searchCollectionNotice : null}
						noticeDecorative
						filters={blendIsMixed}
						scopeLabel={navCopy.searchScopeLabel}
						scopeSegments={searchScopeSegments}
						bind:scope={searchFamily}
						modeLabel={navCopy.searchModeLabel}
						modes={searchModes}
					/>
					{#if showSearchResults}
						<div class="nav-search-results" role="group" aria-label={searchAria}>
							{#each visibleResults as result (`${result.kind}:${result.id}`)}
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
						</div>
					{/if}
				</div>
			</form>

			<span class="nav-divider" aria-hidden="true"></span>

			<div class="nav-controls" data-slot="nav-controls">
				<select
					class="nav-provider"
					aria-label={locale === 'fr' ? 'Réseau de transport' : 'Transit network'}
					value={providerId}
					onchange={(event) => {
						const href = providerHref(url, event.currentTarget.value, locale);
						event.currentTarget.value = providerId;
						location.assign(href);
					}}
				>
					{#each providers as provider (provider.id)}
						<option value={provider.id}
							>{provider.labels[locale].city} · {provider.labels[locale].operator}</option
						>
					{/each}
					{#if !providers.length}
						<option value={providerId}>{providerId}</option>
						{#if providerId !== v1Provider()}
							<option value={v1Provider()}
								>{locale === 'fr' ? 'Réseau par défaut' : 'Default network'}</option
							>
						{/if}
					{/if}
				</select>
				<RefreshButton {locale} class="nav-control" />
				<a
					href={localizeHref('/search', locale, providerId)}
					class="tap-press nav-control nav-compact-search"
					aria-label={searchAria}
					data-slot="nav-compact-search"
				>
					<SearchIcon size={17} strokeWidth={1.8} aria-hidden="true" />
				</a>
				<ThemeToggle {locale} class="nav-control" />
				<LangSwitch {locale} url={selectedUrl} {availableLocales} class="nav-control" />

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
	</div>

	{#if menuOpen}
		<button
			type="button"
			class="nav-menu-backdrop"
			tabindex="-1"
			aria-label={closeMenuAria}
			onclick={closeMenu}
		></button>

		<div class="nav-menu-rail">
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
					<a
						href={compactLanguageTarget.href}
						class="nav-menu-language"
						aria-label={compactLanguageTarget.aria}
						data-sveltekit-preload-data="hover"
						data-sveltekit-noscroll
						data-sveltekit-reload
						onclick={closeMenu}
					>
						{compactLanguageTarget.label}
					</a>
				{/if}

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
		</div>
	{/if}
</nav>

<style>
	.nav-provider {
		--size-provider-select: 12.5rem;
		max-width: var(--size-provider-select);
		min-height: 44px;
		padding-inline: 0.5rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--background);
		color: var(--foreground);
		font: inherit;
	}
	.nav-provider:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	:root {
		--pill-h: 72px;
		--app-effective-rail-offset: 0px;
	}

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

	.nav-rail {
		position: relative;
		z-index: var(--z-nav);
		width: calc(100vw - var(--app-effective-rail-offset, 0px));
		display: flex;
		justify-content: center;
		container-type: inline-size;
		container-name: nav-rail;
	}

	.nav-pill {
		pointer-events: auto;
		position: relative;
		z-index: var(--z-nav);
		display: flex;
		align-items: center;
		gap: 0;
		max-width: calc(100cqi - 1.5rem);
		padding: 12px 28px;
		background: color-mix(in srgb, var(--background) 92%, transparent);
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-nav);
		backdrop-filter: blur(16px) saturate(1.1);
		-webkit-backdrop-filter: blur(16px) saturate(1.1);
		transition:
			padding var(--duration-normal) var(--ease-default),
			box-shadow var(--duration-normal) var(--ease-default),
			transform var(--app-rail-offset-duration, var(--duration-normal)) var(--ease-default);
		transform: translateX(calc(var(--app-effective-rail-offset, 0px) * -0.5));
	}

	.nav-pill-compact {
		padding: 12px 20px;
		box-shadow: none;
	}

	.nav-divider {
		flex: none;
		width: 2px;
		height: 18px;
		margin-inline: 20px;
		background: var(--border-brand);
	}

	.nav-divider-collapsible {
		display: none;
	}

	.nav-links {
		display: none;
		align-items: center;
		gap: 28px;
	}

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
		width: clamp(11rem, 22cqi, 20rem);
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
		outline: none;
		box-shadow: 0 0 0 2px var(--ring);
	}

	.nav-search-panel {
		position: absolute;
		z-index: var(--z-nav);
		top: calc(100% + 1.75rem);
		left: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		width: min(max(100%, 28rem), calc(100vw - 2rem));
		max-height: calc(100dvh - 1rem - env(safe-area-inset-top, 0px) - var(--pill-h) - 10px - 1rem);
		opacity: 0;
		visibility: hidden;
		transition:
			opacity var(--duration-normal) var(--ease-default),
			visibility 0s linear var(--duration-normal);
	}

	.nav-search:focus-within .nav-search-panel,
	.nav-search:has(.nav-search-results) .nav-search-panel {
		opacity: 1;
		visibility: visible;
		transition:
			opacity var(--duration-fast) var(--ease-default),
			visibility 0s linear 0s;
	}

	.nav-controls {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.nav-controls :global(.nav-control) {
		min-width: 44px;
		min-height: 44px;
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

	.nav-menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-menu);
		background: transparent;
		border: none;
		cursor: default;
		pointer-events: auto;
	}

	.nav-menu-rail {
		position: fixed;
		inset-block: 0;
		inset-inline-start: 0;
		width: calc(100vw - var(--app-effective-rail-offset, 0px));
		pointer-events: none;
		z-index: var(--z-menu);
		container-type: inline-size;
		container-name: nav-rail;
	}

	.nav-menu {
		pointer-events: auto;
		position: absolute;
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
	}

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

	.nav-menu-group {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-subtle);
	}

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

	@container nav-rail (width < 1024px) {
		.nav-search {
			display: none;
		}
		.nav-compact-search {
			display: inline-flex;
		}
	}

	@container nav-rail (width < 799px) {
		.nav-pill {
			padding: 12px 20px;
		}
		.nav-divider {
			margin-inline: 12px;
		}
		.nav-links {
			gap: 18px;
		}
	}

	@container nav-rail (width < 1000px) {
		.nav-links {
			display: none;
		}
		.nav-divider-collapsible {
			display: none;
		}
		.nav-menu-primary-group {
			display: grid;
		}
		.nav-menu-group {
			margin-top: 0.5rem;
			padding-top: 0.5rem;
			border-top: 1px solid var(--border-subtle);
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

	.nav-search-panel > :global([data-slot='search-controls']) {
		flex: none;
	}

	.nav-search-results {
		min-width: 0;
		min-height: 0;
		flex: 0 1 auto;
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

	@media (max-width: 599px) {
		:root {
			--pill-h: 116px;
		}
	}
	@container nav-rail (width < 600px) {
		.nav-provider {
			position: absolute;
			inset-block-start: calc(100% + 8px);
			inset-inline-start: 50%;
			transform: translateX(-50%);
			--size-provider-select: calc(100cqi - 2rem);
			padding-inline: 1rem;
			border: 2px solid var(--border-brand);
			border-radius: var(--radius-pill);
			box-shadow: var(--shadow-nav);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-pill,
		.nav-menu-toggle,
		.nav-menu-line,
		.nav-search-input,
		.nav-search-panel,
		.nav-compact-search,
		.nav-menu-link,
		.nav-menu-language,
		.nav-menu-house {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import type { Component } from 'svelte';
	import MapIcon from '@lucide/svelte/icons/map';
	import RouteIcon from '@lucide/svelte/icons/route';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import WaypointsIcon from '@lucide/svelte/icons/waypoints';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import FlameIcon from '@lucide/svelte/icons/flame';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { afterNavigate, beforeNavigate, onNavigate } from '$app/navigation';
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
	import {
		type SurfaceNavItem,
		type AuditNavItem,
		SURFACE_NAV,
		AUDIT_NAV,
		YESID_HOUSE_LINK,
		isSurfaceActive,
	} from '$lib/content/nav';
	import { navPillCopy } from './navPill.copy';
	import { SiteHeader } from '@yesid/ui/layout';
	import RefreshButton from './RefreshButton.svelte';
	import { providerHref, type PublicProvider } from '$lib/v1/providers';
	import { v1Provider } from '$lib/v1/config';

	interface NavPillProps {
		locale?: Locale;
		url?: URL;
		providerId?: string;
		providers?: PublicProvider[];
		search?: string;
		onsearch?: (value: string) => void;
		searchResults?: readonly ChromeSearchResult[];
		searchScope?: ChromeSearchScope;
		searchModes?: SvelteSet<TransitModeKey>;
		onresultselect?: (result: ChromeSearchResult) => void;
		availableLocales?: readonly Locale[];
	}

	let {
		locale: localeProp,
		url = new URL('https://transit.local/'),
		providerId = v1Provider(url),
		providers = [],
		search = $bindable(''),
		onsearch,
		searchResults = [],
		searchScope = 'all',
		searchModes = new SvelteSet<TransitModeKey>(),
		onresultselect,
		availableLocales = PUBLISHED_LOCALES,
	}: NavPillProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);
	const selectedUrl = $derived(
		new URL(localizeHref(url.pathname + url.search + url.hash, locale, providerId), url),
	);
	const currentPath = $derived(delocalizePath(url.pathname));

	const navCopy = $derived(navPillCopy[locale]);
	const searchPlaceholder = $derived(
		navCopy.searchPlaceholder[
			searchScope === 'route' || searchScope === 'stop' ? searchScope : 'all'
		],
	);
	const searchAria = $derived(
		navCopy.searchAria[searchScope === 'route' || searchScope === 'stop' ? searchScope : 'all'],
	);
	const searchCollectionNotice = $derived(navCopy.searchCollectionNotice);
	const transmitsSearches = $derived(searchScope === 'map' || searchScope === 'all');
	const blendIsMixed = $derived(searchScope === 'map' || searchScope === 'all');

	const toItem = (item: (typeof SURFACE_NAV)[number] | (typeof AUDIT_NAV)[number]) => ({
		href: localizeHref(item.href, locale, providerId),
		label: item.label[locale],
		current: isSurfaceActive(item, currentPath),
	});
	const MENU_ICONS: Record<
		SurfaceNavItem['key'] | AuditNavItem['key'],
		Component<{ class?: string }>
	> = {
		map: MapIcon,
		lines: RouteIcon,
		stops: MapPinIcon,
		network: WaypointsIcon,
		metrics: RulerIcon,
		status: ActivityIcon,
		hotspots: FlameIcon,
		receipt: ReceiptIcon,
		repeatOffenders: RepeatIcon,
		alerts: TriangleAlertIcon,
	};
	const links = $derived(SURFACE_NAV.map((item) => ({ ...toItem(item), priority: 3 as const })));
	const menuItems = $derived([
		...[...SURFACE_NAV, ...AUDIT_NAV].map((item) => ({
			...toItem(item),
			icon: MENU_ICONS[item.key],
		})),
		{
			href: YESID_HOUSE_LINK.href,
			label: YESID_HOUSE_LINK.label[locale],
			external: true,
			icon: ExternalLinkIcon,
			ariaLabel: `${YESID_HOUSE_LINK.label[locale]} ${navCopy.newTab}`,
		},
	]);

	const providerText = (provider: PublicProvider) =>
		`${provider.labels[locale].city} · ${provider.labels[locale].operator}`;
	const providerLabel = $derived.by(() => {
		const provider = providers.find((candidate) => candidate.id === providerId);
		return provider ? providerText(provider) : providerId;
	});

	let searchResultsOpen = $state(true);
	let searchForm = $state<HTMLFormElement>();
	let providerControl = $state<HTMLLabelElement>();

	// --pill-h spans the pill plus the provider row that drops below it on phones.
	$effect(() => {
		if (!providerControl || typeof ResizeObserver === 'undefined') return;
		const control = providerControl;
		const pill = control.closest<HTMLElement>('[data-testid="nav-pill"]')!;
		const root = control.ownerDocument.documentElement;
		const measure = () => {
			const box = pill.getBoundingClientRect();
			root.style.setProperty(
				'--pill-h',
				`${Math.ceil(Math.max(box.bottom, control.getBoundingClientRect().bottom) - box.top)}px`,
			);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(pill.closest('[data-slot="site-header"]')!);
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

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		const value = search.trim();
		onsearch?.(value);
		if (value) searchResultsOpen = false;
	}

	function selectResult(result: ChromeSearchResult): void {
		onresultselect?.(result);
		searchResultsOpen = false;
	}

	function resultAria(result: ChromeSearchResult): string {
		const kind = resultKindLabel(result);
		return result.meta ? `${kind} ${result.label} ${result.meta}` : `${kind} ${result.label}`;
	}

	function resultKindLabel(result: ChromeSearchResult): string {
		return navCopy.searchKind[result.kind];
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && showSearchResults) searchResultsOpen = false;
	}}
	onpointerdown={(event) => {
		if (searchForm && event.target instanceof Node && !searchForm.contains(event.target)) {
			searchResultsOpen = false;
		}
	}}
/>

{#snippet searchField()}
	<form
		bind:this={searchForm}
		class="nav-search"
		role="search"
		onsubmit={submitSearch}
		data-slot="nav-search"
	>
		<SearchIcon class="nav-search-icon" size={14} strokeWidth={1.8} aria-hidden="true" />
		<input
			type="search"
			name="network-search"
			bind:value={search}
			placeholder={searchPlaceholder}
			aria-label={searchAria}
			autocomplete="off"
			spellcheck="false"
			onfocus={() => {
				if (search.trim()) searchResultsOpen = true;
			}}
			oninput={() => (searchResultsOpen = true)}
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
{/snippet}

{#snippet actions()}
	<!-- The visible label is its own element, centred in the control; the native select sits on top, transparent. -->
	<label bind:this={providerControl} class="nav-provider">
		<span class="nav-provider-label" aria-hidden="true">{providerLabel}</span>
		<select
			class="nav-provider-select"
			aria-label={navCopy.network}
			value={providerId}
			onchange={(event) => {
				const href = providerHref(url, event.currentTarget.value, locale);
				event.currentTarget.value = providerId;
				location.assign(href);
			}}
		>
			{#each providers as provider (provider.id)}
				<option value={provider.id}>{providerText(provider)}</option>
			{/each}
			{#if !providers.length}
				<option value={providerId}>{providerId}</option>
				{#if providerId !== v1Provider()}
					<option value={v1Provider()}>{navCopy.defaultNetwork}</option>
				{/if}
			{/if}
		</select>
	</label>
	<RefreshButton {locale} class="nav-refresh" />
	<a
		href={localizeHref('/search', locale, providerId)}
		class="tap-press nav-compact-search"
		aria-label={searchAria}
		data-slot="nav-compact-search"
	>
		<SearchIcon size={17} strokeWidth={1.8} aria-hidden="true" />
	</a>
{/snippet}

<SiteHeader
	navigation={{ beforeNavigate, onNavigate, afterNavigate }}
	home={localizeHref('/', locale, providerId)}
	wordmark="Transit"
	{links}
	{menuItems}
	labels={navCopy}
	language={{
		locale,
		locales: availableLocales,
		href: (next) => localizeUrl(selectedUrl, next as Locale),
		label: navCopy.language,
		reload: true,
	}}
	search={searchField}
	{actions}
/>

<style>
	:root {
		--pill-h: 72px;
	}

	/* Decision 7: the city sits on the pill's own surface, its label centred. */
	.nav-provider {
		--size-provider-select: 12.5rem;
		position: relative;
		display: inline-grid;
		place-items: center;
		max-width: var(--size-provider-select);
		min-height: 44px;
		padding-inline: 0.75rem;
		border-radius: var(--radius-sm);
		color: var(--foreground);
	}
	.nav-provider-label {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		pointer-events: none;
	}
	.nav-provider-select {
		min-block-size: var(--size-tap-min);
		position: absolute;
		inset-inline: 0;
		inset-block-start: 50%;
		transform: translateY(-50%);
		width: 100%;
		opacity: 0;
		font: inherit;
		cursor: pointer;
	}
	.nav-provider-select option {
		background: var(--background);
		color: var(--foreground);
	}
	.nav-provider:has(:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@container site-header (width < 600px) {
		.nav-provider {
			--size-provider-select: calc(100cqi - 2rem);
			position: absolute;
			inset-block-start: calc(100% + 8px);
			inset-inline-start: 50%;
			transform: translateX(-50%);
			padding-inline: 1rem;
			border: 2px solid var(--border-brand);
			border-radius: var(--radius-pill);
			background: color-mix(in srgb, var(--background) 92%, transparent);
			-webkit-backdrop-filter: blur(var(--glass-blur));
			backdrop-filter: blur(var(--glass-blur));
			box-shadow: var(--shadow-nav);
		}
	}

	:global(.nav-refresh) {
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
	@container site-header (width >= 1024px) {
		.nav-compact-search {
			display: none;
		}
	}

	.nav-search {
		position: relative;
		display: flex;
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
		height: var(--size-tap-min);
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
		-webkit-backdrop-filter: blur(var(--glass-blur));
		backdrop-filter: blur(var(--glass-blur));
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

	@media (--tablet-max) {
		:root {
			--pill-h: 64px;
		}
	}
	@media (max-width: 599px) {
		:root {
			--pill-h: 110px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-search-input,
		.nav-search-panel,
		.nav-compact-search {
			transition: none;
		}
	}
</style>

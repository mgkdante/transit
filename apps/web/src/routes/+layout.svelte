<script module lang="ts">
	import { LEGAL_NAV } from '$lib/content/nav';

	export function isDataIndependentRoute(pathname: string): boolean {
		return LEGAL_NAV.some((item) => item.href === pathname);
	}
</script>

<script lang="ts">
	import '$lib/styles/fonts.css';
	import '@yesid/motion/ripple.css';
	import '../app.css';

	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { updated } from '$app/state';
	import { goto, onNavigate, beforeNavigate, afterNavigate, invalidateAll } from '$app/navigation';
	import { browser } from '$app/environment';

	import { transitAnalytics } from '$lib/analytics/runtime';
	import {
		setLocaleContext,
		DEFAULT_LOCALE,
		delocalizePath,
		localizeHref,
		type Locale,
	} from '$lib/i18n';
	import SeoHead from '$lib/components/SeoHead.svelte';
	import {
		resolveRouteSeo,
		isEphemeralPath,
		breadcrumbItemsForHead,
		resolveDatasetSeo,
	} from '$lib/seo/routeSeo';
	import { breadcrumbJsonLd, organizationJsonLd, datasetJsonLd } from '$lib/seo/jsonld';
	import { readPublicSiteConfig } from '$lib/site/config';
	import { errorDocumentHead } from '$lib/site/errorPage';
	import { setV1Context } from '$lib/v1/boot';
	import { v1Provider } from '$lib/v1/config';
	import { getVehicles } from '$lib/v1/repositories/live';
	import { getRoutesIndex, getStopsIndex } from '$lib/v1/repositories/static';
	import { createResource } from '$lib/v1/resource.svelte';
	import { dataPulse, themeStore } from '$lib/stores';
	import { registerServiceWorker } from '$lib/pwa/register';
	import { decideFreshnessReload } from '$lib/pwa/appVersion';
	import { startVitals } from '$lib/vitals/collect';
	import { runViewTransition } from '$lib/motion/view-transition';
	import { initGlobalRipple } from '@yesid/motion/utils/globalRipple';
	import { AppShell } from '$lib/components/shell';
	import Footer from '$lib/components/layout/Footer.svelte';
	import { EdgeState } from '$lib/components/edge';
	import { layout } from '$lib/nav';
	import { mainLandmarkLabel } from '$lib/content/nav';
	import { legalCopy } from '$lib/features/legal/legal.copy';
	import {
		chromeSearchResultHref,
		chromeSearchResults,
		scopeForPath,
		type ChromeSearchResult,
		type ChromeSearchScope,
	} from '$lib/search/chromeSearch';
	import type { TransitModeKey } from '$lib/search/stopMode';
	import { SvelteSet } from 'svelte/reactivity';
	import type { GeocodeSuggestion } from '$lib/geocode/types';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const locale = $derived<Locale>(data.lang ?? DEFAULT_LOCALE);
	setLocaleContext(
		() => data.lang ?? DEFAULT_LOCALE,
		() => data.providerId,
	);

	const siteConfig = readPublicSiteConfig();
	const seoPath = $derived(delocalizePath($page.url.pathname));

	const noIndex = $derived(!siteConfig.indexing || isEphemeralPath($page.url.pathname));

	const isFullBleed = $derived(seoPath === '/map');
	const dataIndependentRoute = $derived(isDataIndependentRoute(seoPath));

	const searchScope = $derived<ChromeSearchScope>(scopeForPath(seoPath));

	const mainLabel = $derived(mainLandmarkLabel(seoPath));

	const v1 = $derived(data.v1);
	setV1Context(() => v1 ?? undefined);
	const footerAttribution = $derived(
		dataIndependentRoute ? legalCopy[locale].footerAttribution : v1?.manifest.attribution,
	);
	const footerProviderName = $derived(dataIndependentRoute ? undefined : v1?.manifest.display_name);

	const providerShortName = $derived(data.provider?.labels[locale].operator ?? data.providerId);
	const providerCity = $derived(data.provider?.labels[locale].city);

	const seo = $derived(
		resolveRouteSeo($page.url.pathname, locale, {
			shortName: providerShortName,
			city: providerCity,
		}),
	);
	const seoSiteName = $derived(
		providerShortName ? `${providerShortName} Analytics` : 'Transit Analytics',
	);

	const isErrorStatus = $derived(($page.status ?? 200) >= 400);
	const errorHead = $derived(errorDocumentHead($page.status ?? 500, locale));
	const headTitle = $derived(isErrorStatus ? errorHead.title : seo.title);
	const headDescription = $derived(isErrorStatus ? errorHead.description : seo.description);
	const headSiteName = $derived(isErrorStatus ? 'Transit' : seoSiteName);

	const datasetCopy = $derived(resolveDatasetSeo(locale));
	const jsonLd = $derived.by(() => {
		if (isErrorStatus) return [];
		const nodes: unknown[] = [
			organizationJsonLd({ siteOrigin: siteConfig.siteOrigin, siteName: seoSiteName }),
			datasetJsonLd({
				siteOrigin: siteConfig.siteOrigin,
				siteName: seoSiteName,
				name: datasetCopy.name,
				description: datasetCopy.description,
				locale,
			}),
		];
		const breadcrumb = breadcrumbJsonLd(
			breadcrumbItemsForHead($page.url.pathname, locale, siteConfig.siteOrigin, data.providerId),
		);
		if (breadcrumb) nodes.push(breadcrumb);
		return nodes;
	});
	$effect(() => dataPulse.subscribe(v1?.manifest ?? null));

	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');
	let topSearch = $state('');
	let addressSuggestions = $state<GeocodeSuggestion[]>([]);
	const searchModes = new SvelteSet<TransitModeKey>();
	const chromeSearchEnabled = $derived(v1 !== null && topSearch.trim().length > 0);
	const searchRoutes = createResource(() => getRoutesIndex(), {
		enabled: () => chromeSearchEnabled,
	});
	const searchStops = createResource(() => getStopsIndex(), {
		enabled: () => chromeSearchEnabled,
	});
	const searchVehicles = createResource(() => getVehicles(), {
		enabled: () => chromeSearchEnabled,
	});
	const topSearchResults = $derived(
		chromeSearchResults(
			topSearch,
			{
				routes: searchRoutes.data?.routes ?? [],
				stops: searchStops.data?.stops ?? [],
				vehicles: searchVehicles.data?.vehicles ?? [],
				addresses: addressSuggestions,
			},
			{ scope: searchScope, modes: searchModes },
		),
	);

	$effect(() => {
		const query = topSearch.trim();
		const wantsAddress = searchScope === 'map' || searchScope === 'all';
		if (!browser || !v1 || !wantsAddress || searchModes.size > 0 || !shouldSuggestAddress(query)) {
			addressSuggestions = [];
			return;
		}

		const controller = new AbortController();
		const timer = setTimeout(() => {
			void fetchAddressSuggestions(query, 4, controller.signal)
				.then((results) => {
					if (!controller.signal.aborted && topSearch.trim() === query) {
						addressSuggestions = results;
					}
				})
				.catch(() => {
					if (!controller.signal.aborted) addressSuggestions = [];
				});
		}, 250);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	onMount(() => {
		themeStore.init();
		if (data.v1Error && !data.v1) void invalidateAll();

		if (browser && navigator.serviceWorker) {
			navigator.serviceWorker.addEventListener('message', (event) => {
				if ((event.data as { type?: string } | undefined)?.type === 'SW_KILLED') {
					location.reload();
				}
			});
		}
		void registerServiceWorker({ browser, production: import.meta.env.PROD });

		const disposeRipple = initGlobalRipple({ exclude: '[data-ripple-exempt]' });

		const disposeVitals = startVitals();
		return () => {
			disposeRipple();
			disposeVitals();
		};
	});

	onNavigate((navigation) => runViewTransition(navigation));

	afterNavigate(({ to }) => {
		if (to) void transitAnalytics.trackPageview(to.url);
	});

	beforeNavigate((navigation) => {
		if (
			!navigation.willUnload &&
			navigation.to &&
			v1Provider(navigation.to.url) !== data.providerId
		) {
			navigation.cancel();
			location.assign(navigation.to.url.href);
			return;
		}
		const decision = decideFreshnessReload({
			hasNewVersion: updated.current,
			willUnload: navigation.willUnload,
			toHref: navigation.to?.url.href ?? null,
		});
		if (decision.reload && decision.href) {
			location.href = decision.href;
		}
	});

	function retryBoot() {
		void invalidateAll();
	}

	async function selectSearchResult(result: ChromeSearchResult): Promise<void> {
		topSearch = '';
		void goto(
			localizeHref(
				chromeSearchResultHref(result, searchScope, $page.url.searchParams),
				locale,
				data.providerId,
			),
			{ noScroll: true },
		);
	}

	async function submitSearch(value: string): Promise<void> {
		const query = value.trim();
		const [first] = chromeSearchResults(
			query,
			{
				routes: searchRoutes.data?.routes ?? [],
				stops: searchStops.data?.stops ?? [],
				vehicles: searchVehicles.data?.vehicles ?? [],
				addresses: addressSuggestions,
			},
			{ scope: searchScope, modes: searchModes },
		);
		if (first) {
			await selectSearchResult(first);
			return;
		}

		if (searchScope === 'route' || searchScope === 'stop') return;
		if (searchModes.size > 0) return;
		if (!shouldSuggestAddress(query)) return;
		const addresses = await fetchAddressSuggestions(query, 1);
		const [addressResult] = chromeSearchResults(query, { addresses }, { scope: searchScope });
		if (addressResult) await selectSearchResult(addressResult);
	}

	function shouldSuggestAddress(query: string): boolean {
		const trimmed = query.trim();
		if (trimmed.length < 3) return false;
		return !/^\s*-?\d+(?:\.\d+)?\s*[, ]\s*-?\d*(?:\.\d*)?\s*$/.test(trimmed);
	}

	async function fetchAddressSuggestions(
		query: string,
		limit: number,
		signal?: AbortSignal,
	): Promise<GeocodeSuggestion[]> {
		const response = await fetch(
			`/api/geocode/montreal?q=${encodeURIComponent(query)}&suggest=1&limit=${limit}`,
			{ signal },
		);
		if (!response.ok) return [];
		const payload = (await response.json()) as { results?: GeocodeSuggestion[] };
		return payload.results ?? [];
	}
</script>

<SeoHead
	title={headTitle}
	description={headDescription}
	siteName={headSiteName}
	path={seoPath}
	{locale}
	siteOrigin={siteConfig.siteOrigin}
	noIndex={noIndex || isErrorStatus}
	suppressCanonical={isErrorStatus}
	twitterSite={siteConfig.twitterSite}
	twitterCreator={siteConfig.twitterCreator}
	author={siteConfig.author}
	{jsonLd}
/>

<a class="skip-link" href="#main">{locale === 'fr' ? 'Aller au contenu' : 'Skip to content'}</a>

<AppShell
	{locale}
	url={$page.url}
	providerName={v1?.manifest.display_name}
	providerShortName={v1?.manifest.short_name ?? undefined}
	providerId={data.providerId}
	providers={data.providers}
	bind:search={topSearch}
	searchResults={topSearchResults}
	{searchScope}
	{searchModes}
	onsearch={submitSearch}
	onresultselect={selectSearchResult}
	{mainLabel}
>
	{#snippet main()}
		<div
			id="main"
			class="flex h-full w-full flex-col {isFullBleed ? 'overflow-hidden' : 'overflow-y-auto'}"
			tabindex="-1"
		>
			<div
				class={isFullBleed ? 'min-h-0 grow' : 'grow shrink-0 basis-auto pt-[var(--chrome-offset)]'}
			>
				{#if !v1 && !isDataIndependentRoute(seoPath)}
					<div class="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-4 p-6">
						<p>{data.provider?.labels[locale].city ?? data.providerId}</p>
						<EdgeState
							variant="error-v1"
							lang={locale}
							layout={edgeLayout}
							onRetry={retryBoot}
							class="w-full"
						/>
					</div>
				{:else}
					{@render children?.()}
				{/if}
			</div>
			{#if !isFullBleed}
				<Footer {locale} attribution={footerAttribution} providerName={footerProviderName} />
			{/if}
		</div>
	{/snippet}
</AppShell>

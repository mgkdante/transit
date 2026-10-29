<script module lang="ts">
	import { LEGAL_NAV } from '$lib/content/nav';

	export function isDataIndependentRoute(pathname: string): boolean {
		return LEGAL_NAV.some((item) => item.href === pathname);
	}
</script>

<script lang="ts">
	import { navPillCopy } from '$lib/components/shell/navPill.copy';
	import '@yesid/tokens/fonts.css';
	import '@yesid/motion/ripple.css';
	import '../app.css';

	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { updated } from '$app/state';
	import { goto, onNavigate, beforeNavigate, afterNavigate, invalidateAll } from '$app/navigation';
	import { browser } from '$app/environment';

	import { createAnalytics } from '@yesid/analytics/client';
	import {
		setLocaleContext,
		DEFAULT_LOCALE,
		SUPPORTED_LOCALES,
		delocalizePath,
		localizeHref,
		type Locale,
	} from '$lib/i18n';
	import { SeoHead } from '@yesid/ui/head';
	import {
		resolveRouteSeo,
		isEphemeralPath,
		breadcrumbItemsForHead,
		resolveDatasetSeo,
	} from '$lib/seo/routeSeo';
	import {
		breadcrumbJsonLd,
		organizationJsonLd,
		datasetJsonLd,
		websiteJsonLd,
		type JsonLdNode,
	} from '$lib/seo/jsonld';
	import { readPublicSiteConfig } from '$lib/site/config';
	import { currentMirrorUrl } from '$lib/site/urlMirror';
	import { errorDocumentHead } from '$lib/site/errorPage';
	import { setV1Context } from '$lib/v1/boot';
	import { v1Provider } from '$lib/v1/config';
	import { getVehicles } from '$lib/v1/repositories/live';
	import { getRoutesIndex, getStopsIndex } from '$lib/v1/repositories/static';
	import { createResource } from '$lib/v1/resource.svelte';
	import { dataPulse } from '$lib/stores';
	import { registerServiceWorker } from '$lib/pwa/register';
	import { decideFreshnessReload } from '$lib/pwa/appVersion';
	import { startVitals } from '@yesid/analytics/vitals';
	import { env } from '$env/dynamic/public';
	import { viewTransition } from '@yesid/motion/utils/viewTransition';
	import { initGlobalRipple } from '@yesid/motion/utils/globalRipple';
	import { initScrollTriggerConfig } from '@yesid/motion/utils/gsap';
	import { getLenis } from '@yesid/motion/utils/lenis';
	import { AppShell } from '$lib/components/shell';
	import BrandCluster from '$lib/components/brand/BrandCluster.svelte';
	import { footerCopy } from '$lib/components/layout/footer.copy';
	import { EdgeState } from '$lib/components/edge';
	import { SiteFooter, SiteRoot } from '@yesid/ui/layout';
	import { ConstructionProps } from '@yesid/ui/brand';
	import { desktop } from '@yesid/ui/state';
	import { AUDIT_NAV, mainLandmarkLabel, SURFACE_NAV } from '$lib/content/nav';
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
	let constructionEdge = $state<HTMLElement>();
	let constructionProgress = $state(1);
	let mainScroller = $state<HTMLElement>();

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
	const footer = $derived(footerCopy[locale]);
	const footerAgency = $derived(footerProviderName ?? footer.providerFallback);
	const footerGroups = $derived(
		[
			{ label: footer.exploreLabel, links: SURFACE_NAV },
			{ label: footer.auditLabel, links: AUDIT_NAV },
			{ label: footer.legalLabel, links: LEGAL_NAV, testId: 'footer-legal' },
		].map((group) => ({
			...group,
			links: group.links.map((link) => ({
				href: localizeHref(link.href, locale, data.providerId),
				label: link.label[locale],
			})),
		})),
	);

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
		const nodes: JsonLdNode[] = [
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
	const headHref = (lang: Locale) =>
		`${siteConfig.siteOrigin}${localizeHref(seoPath, lang, data.providerId)}`;
	const head = $derived({
		title: headTitle === headSiteName ? headTitle : `${headTitle} · ${headSiteName}`,
		description: headDescription,
		siteName: headSiteName,
		canonical: isErrorStatus ? undefined : headHref(locale),
		alternates: [
			...SUPPORTED_LOCALES.map((lang) => ({ hreflang: lang, href: headHref(lang) })),
			{ hreflang: 'x-default', href: headHref(DEFAULT_LOCALE) },
		],
		ogLocale: `${locale}_CA`,
		ogLocaleAlternates: SUPPORTED_LOCALES.filter((lang) => lang !== locale).map(
			(lang) => `${lang}_CA`,
		),
		image: {
			url: `${siteConfig.siteOrigin}/og/${locale}.png`,
			alt: `${headSiteName}: ${headTitle}`,
		},
		noIndex: noIndex || isErrorStatus,
		twitter: { site: siteConfig.twitterSite, creator: siteConfig.twitterCreator },
		author: siteConfig.author,
		jsonLd: [
			websiteJsonLd({ siteOrigin: siteConfig.siteOrigin, siteName: headSiteName, locale }),
			...jsonLd,
		],
	});
	$effect(() => dataPulse.subscribe(v1?.manifest ?? null));

	const edgeLayout = $derived(desktop.current ? 'desktop' : 'mobile');
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

	// SiteRoot's initLenis reads ScrollTrigger.isTouch, which is only set once the plugin
	// is registered. Upstream registers it itself from the next design release.
	if (browser) initScrollTriggerConfig();

	// The page scrolls inside #main, which SvelteKit's own scroll reset does not reach.
	function resetMainScroll(hash: string): void {
		const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
		const lenis = getLenis();
		if (lenis) {
			lenis.resize();
			lenis.scrollTo(target ?? 0, { immediate: true, force: true });
		} else if (target) {
			target.scrollIntoView();
		} else {
			document.getElementById('main')?.scrollTo({ top: 0 });
		}
	}

	onMount(() => {
		if (data.v1Error && !data.v1) void invalidateAll();

		if (browser && navigator.serviceWorker) {
			navigator.serviceWorker.addEventListener('message', (event) => {
				if ((event.data as { type?: string } | undefined)?.type === 'SW_KILLED') {
					location.reload();
				}
			});
		}
		void registerServiceWorker({ browser, production: import.meta.env.PROD });

		createAnalytics({ events: [] }, { domain: env.PUBLIC_PLAUSIBLE_DOMAIN });
		const disposeRipple = initGlobalRipple({ exclude: '[data-ripple-exempt]' });

		const disposeVitals =
			env.PUBLIC_VITALS_ENABLED === 'true'
				? startVitals({ endpoint: '/api/vitals', load: () => import('web-vitals') })
				: () => {};
		return () => {
			disposeRipple();
			disposeVitals();
		};
	});

	onNavigate(viewTransition);

	afterNavigate(({ from, to, type }) => {
		if (!to || type === 'enter' || type === 'popstate') return;
		if (from?.url.pathname !== to.url.pathname || from.url.hash !== to.url.hash) {
			resetMainScroll(to.url.hash);
		}
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
			navigation.cancel();
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
		if (!data.v1) return;
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
		if (!data.v1) return [];
		const response = await fetch(
			`/api/geocode?provider=${encodeURIComponent(data.providerId)}&lang=${locale}&q=${encodeURIComponent(query)}&suggest=1&limit=${limit}`,
			{ signal },
		);
		if (!response.ok) return [];
		const payload = (await response.json()) as { results?: GeocodeSuggestion[] };
		return payload.results ?? [];
	}
</script>

<SiteRoot scroller={{ wrapper: '#main', content: '#main-flow' }} lang={locale}>
	<SeoHead {...head} />

	<a class="skip-link" href="#main">{navPillCopy[locale].skipToContent}</a>

	<AppShell
		{locale}
		url={currentMirrorUrl($page.url)}
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
				bind:this={mainScroller}
				class="flex h-full w-full flex-col {isFullBleed ? 'overflow-hidden' : 'overflow-y-auto'}"
				tabindex="-1"
			>
				<div
					id="main-flow"
					style:overflow-anchor={seoPath === '/' ? 'none' : undefined}
					class="flex flex-col {isFullBleed ? 'h-full' : 'min-h-full shrink-0'}"
					data-lenis-prevent={isFullBleed || undefined}
				>
					<div
						class={isFullBleed
							? 'min-h-0 grow'
							: 'grow shrink-0 basis-auto pt-[var(--chrome-offset)]'}
					>
						{#if !v1 && !isDataIndependentRoute(seoPath)}
							<div
								class="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-4 p-6"
							>
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
						{#if seoPath === '/'}
							{#key $page.url.pathname}
								<div
									bind:this={constructionEdge}
									class="construction-anchor"
									aria-hidden="true"
								></div>
								<div
									class="home-construction-floor"
									style="--ground-progress:{constructionProgress}"
								>
									<ConstructionProps
										layout="spread"
										floodlight
										revealAt={constructionEdge}
										revealRoot={mainScroller}
										bind:progress={constructionProgress}
									/>
								</div>
							{/key}
						{/if}
						<SiteFooter
							tagline={footer.tagline(footerAgency)}
							groups={footerGroups}
							statusPrefix={footer.statusPrefix}
							liveLabel={footer.liveLabel}
						>
							{#snippet brand()}
								<BrandCluster productHref={localizeHref('/', locale, data.providerId)} />
							{/snippet}
							{#snippet statusStart()}
								<p class="footer-honesty m-0 text-center sm:text-left">
									{#if footerAttribution}<span>{footerAttribution}</span>{/if}
									<span class="footer-disclaimer">{footer.disclaimer(footerAgency)}</span>
								</p>
							{/snippet}
						</SiteFooter>
					{/if}
				</div>
			</div>
		{/snippet}
	</AppShell>
</SiteRoot>

<style>
	.home-construction-floor {
		position: relative;
		height: calc(240px * var(--ground-progress, 1));
		flex-shrink: 0;
		overflow: clip;
	}
	.construction-anchor {
		height: 0;
		width: 1px;
		flex-shrink: 0;
		pointer-events: none;
	}
	@media (--tablet-max) {
		.home-construction-floor {
			height: calc(100px * var(--ground-progress, 1));
		}
	}
	.footer-honesty {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.footer-disclaimer {
		color: var(--secondary-foreground);
	}
</style>

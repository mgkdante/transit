<!--
  Root layout — the app-shell backbone and the i18n / v1 context provider.

  This is the integration linchpin: every page renders inside the AppShell
  (TopBar + responsive 3-zone body) and reads the active locale + the v1 snapshot
  context that this layout provides ONCE here.

    fonts + app.css   side-effect imports (variable fonts BEFORE the stylesheet)
    themeStore.init() onMount — re-syncs the runes theme store with the pre-paint
                      <html data-theme> the app.html inline script applied
    locale context    setLocaleContext(() => lang) — a reader so late readers stay
                      reactive across EN⇄FR; lang is path-derived in +layout.ts
    v1 context        setV1Context(data.v1) — the booted snapshot context the whole
                      app reads via getV1Context(); booted fail-soft in +layout.ts
    children → main    the page tree renders into the shell's `main` zone; the
                      skip-link target #main lives on the wrapper inside it

  FAIL-SOFT: if +layout.ts could not boot the /v1 contract (manifest 404 /
  unreachable), `data.v1` is null. We then render the `error-v1` edge state in
  the shell `main` INSTEAD of the page tree — so no descendant ever calls
  getV1Context() without a provider — and offer a retry that re-runs the load.

  Adapted from the yesid.dev +layout.svelte chrome composition: gsap/lenis/seo/
  marketing stripped, re-themed to the transit shell. Tokens only.
-->
<script lang="ts">
	// Self-hosted variable fonts — latin + latin-ext subsets ONLY (EN + FR), via
	// a local @font-face sheet instead of the bare @fontsource-variable imports
	// that pulled all 7 subsets (cyrillic/greek/vietnamese/…). Side-effect import
	// BEFORE app.css. See $lib/styles/fonts.css for the why + the pinned woff2.
	import '$lib/styles/fonts.css';
	import '../app.css';

	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto, onNavigate } from '$app/navigation';
	import { browser } from '$app/environment';

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
	import {
		setV1Context,
		bootV1,
		getRoutesIndex,
		getStopsIndex,
		getVehicles,
		type V1Context,
	} from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { dataRefresh, themeStore } from '$lib/stores';
	import { registerServiceWorker } from '$lib/pwa/register';
	import { runViewTransition } from '$lib/motion';
	import { AppShell } from '$lib/components/shell';
	import { Footer } from '$lib/components/layout';
	import { EdgeState } from '$lib/components/edge';
	import { layout } from '$lib/nav';
	import { mainLandmarkLabel } from '$lib/content/nav';
	import {
		chromeSearchResultHref,
		chromeSearchResults,
		scopeForPath,
		type ChromeSearchResult,
		type ChromeSearchScope,
	} from '$lib/search/chromeSearch';
	import type { GeocodeSuggestion, GeocodedLocation } from '$lib/geocode/types';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// Active request locale (path-derived in +layout.ts). A reader is provided to
	// context so deep call sites that read it at init stay reactive across page
	// swaps (the root layout never remounts).
	const locale = $derived<Locale>(data.lang ?? DEFAULT_LOCALE);
	setLocaleContext(() => data.lang ?? DEFAULT_LOCALE);

	// Per-route document head config. One <SeoHead> resolves title/description/
	// canonical/OG/hreflang per surface (routeSeo, derived below once v1 is in
	// scope) instead of a single global title on every page. siteOrigin + indexing
	// + the provider identity fallback come from the public site config
	// (PUBLIC_SITE_ORIGIN / PUBLIC_INDEXING / PUBLIC_PROVIDER_*) so the dev lane is
	// noindex and SSR copy stays provider-specific before the manifest boots.
	const siteConfig = readPublicSiteConfig();
	const seoPath = $derived(delocalizePath($page.url.pathname));

	// noindex when the dev lane is off-index OR the surface is EPHEMERAL (a /trip/
	// [id] deep link whose id rotates within minutes — indexing it would fill
	// search with dead pages). Stable detail surfaces (/route, /stop) stay indexed.
	const noIndex = $derived(!siteConfig.indexing || isEphemeralPath($page.url.pathname));

	// Full-bleed surfaces own the whole viewport: #main must NOT scroll and must
	// NOT carry a footer. The map fills height:100%, so a trailing footer would
	// force the main column to scroll with the footer crammed under the canvas
	// (the "squeezed footer" artifact). Only /map today; its STM/OSM attribution
	// rides the map's own attribution control instead of the page footer.
	const isFullBleed = $derived(seoPath === '/map');

	// Context-aware chrome search: the active surface RESTRICTS the result blend
	// and steers selection — /lines + /route/* search only lines (→ /route/<id>),
	// /stops + /stop/* only stops (→ /stop/<id>), /map keeps the full blend, and
	// the hub/network/search default to today's blend. Derived from the same
	// delocalized path the nav highlight uses, so the two never disagree.
	const searchScope = $derived<ChromeSearchScope>(scopeForPath(seoPath));

	// Surface-appropriate `<main>` landmark name (the shell renders ONE persistent
	// <main> across routes). Derived from the SAME delocalized path the nav highlight
	// + search scope use, so the landmark, the highlight, and the scope never diverge.
	const mainLabel = $derived(mainLandmarkLabel(seoPath));

	// v1 snapshot context. The SSR boot (+layout.ts) can fail on Cloudflare — a
	// Worker's fetch to its own zone can't reach the sibling /data route (523) —
	// so when it does we RE-BOOT client-side: the browser reaches /data fine.
	// `clientV1` holds that recovery; `v1` prefers the SSR value and falls back to
	// it. The context reader stays live, so once the client boot lands every
	// descendant that read getV1Context() at init sees the data without a remount.
	let clientV1 = $state<V1Context | null>(null);
	const v1 = $derived<V1Context | null>(data.v1 ?? clientV1);
	setV1Context(() => (v1 ?? undefined) as V1Context);

	// Provider copy identity for the document head (resolved AFTER v1, since the
	// keyworded SEO copy reads it). Manifest-first (live; SSR via the DATA service
	// binding, client via boot) then env fallback (PUBLIC_PROVIDER_* — SSR-visible
	// when the manifest is absent / not yet republished). Absent identity → neutral.
	const providerShortName = $derived(v1?.manifest.short_name ?? siteConfig.providerShortName);
	const providerCity = $derived(v1?.manifest.city ?? siteConfig.providerCity);

	// Per-route document head. The same identity drives BOTH the per-surface
	// title/description (routeSeo) AND the brand siteName appended to every <title>/
	// og:site_name / WebSite JSON-LD — so an absent or non-STM provider never leaks
	// a hardcoded agency name in the head.
	const seo = $derived(
		resolveRouteSeo($page.url.pathname, locale, {
			shortName: providerShortName,
			city: providerCity,
		}),
	);
	const seoSiteName = $derived(
		providerShortName ? `${providerShortName} Analytics` : 'Transit Analytics',
	);

	// Soft-404 / error renders: a bare or invalid deep link (e.g. /trip with no id,
	// or any surface that resolved to an error status) renders the +error page with
	// $page.status >= 400. Such a URL must NOT be indexed and must NOT advertise a
	// self-canonical (it would tell crawlers a broken URL is the canonical one).
	const isErrorStatus = $derived(($page.status ?? 200) >= 400);

	// Site-wide structured data plus the per-surface BreadcrumbList on the stable
	// detail surfaces (/route, /stop). The WebSite+SearchAction node is always-on
	// inside SeoHead; here we add the Organization (publisher identity), a Dataset
	// node for the open /v1 transit data (CC BY 4.0), and a path-derived breadcrumb
	// trail. Error renders carry no meaningful structured data, so we emit none.
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
			breadcrumbItemsForHead($page.url.pathname, locale, siteConfig.siteOrigin),
		);
		if (breadcrumb) nodes.push(breadcrumb);
		return nodes;
	});
	// Seed the chrome freshness timestamp from the booted manifest as an INITIAL
	// fallback (seed-if-unset) so pages WITHOUT a live store still show the
	// page-load data's age. The live store is the single AUTHORITATIVE writer —
	// once it polls, its per-poll timestamp supersedes this seed.
	$effect(() => {
		dataRefresh.seedDataGeneratedUtc(
			v1?.manifest.files.live.generated_utc ?? v1?.manifest.files.static?.generated_utc,
		);
	});

	// True while a client-side (re-)boot is in flight — lets the edge state show a
	// "retrying" affordance rather than a dead button.
	let rebooting = $state(false);

	async function clientBoot(): Promise<void> {
		if (!browser || rebooting) return;
		rebooting = true;
		try {
			clientV1 = await bootV1(data.lang ?? DEFAULT_LOCALE);
		} catch {
			// Still unreachable — keep the edge state up; the user can retry.
		} finally {
			rebooting = false;
		}
	}

	// Shell desktop/mobile split drives the edge-state skeleton/error density.
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');
	let topSearch = $state('');
	let addressSuggestions = $state<GeocodeSuggestion[]>([]);
	let addressSessionToken = $state(createAddressSessionToken());
	const searchRoutes = createResource(() => getRoutesIndex());
	const searchStops = createResource(() => getStopsIndex());
	const searchVehicles = createResource(() => getVehicles());
	const topSearchResults = $derived(
		chromeSearchResults(
			topSearch,
			{
				routes: searchRoutes.data?.routes ?? [],
				stops: searchStops.data?.stops ?? [],
				vehicles: searchVehicles.data?.vehicles ?? [],
				addresses: addressSuggestions,
			},
			{ scope: searchScope },
		),
	);

	$effect(() => {
		const query = topSearch.trim();
		// Only map/all scope surfaces addresses — skip the geocode fetch (and its
		// "Powered by Google" footer) entirely on the line/stop catalogue surfaces.
		const wantsAddress = searchScope === 'map' || searchScope === 'all';
		if (!browser || !wantsAddress || !shouldSuggestAddress(query)) {
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
		// Re-sync the theme store with the pre-paint <html data-theme> attribute
		// and back-fill the theme-color meta (SSR'd dark).
		themeStore.init();
		// Recover a failed SSR boot — the browser can reach /data even when the SSR
		// worker could not. No-op when SSR already produced a context.
		if (data.v1Error && !data.v1) void clientBoot();

		// PWA service-worker lifecycle + remote kill-switch (browser + production +
		// secure-context only). This ALSO enforces the kill-flag client-side on
		// every load: a misbehaving / killed SW is torn down here before any
		// (re-)registration. The network-first shell guarantees this code re-runs
		// with the latest deploy, so the kill-switch can always reach an installed SW.
		// A killed SW posts SW_KILLED → reload into the now-SW-free live site.
		if (browser && navigator.serviceWorker) {
			navigator.serviceWorker.addEventListener('message', (event) => {
				if ((event.data as { type?: string } | undefined)?.type === 'SW_KILLED') {
					location.reload();
				}
			});
		}
		void registerServiceWorker({ browser, production: import.meta.env.PROD });
	});

	// SPA View Transitions — a tasteful root cross-fade between surfaces. The
	// helper feature-detects `document.startViewTransition` AND respects
	// `prefers-reduced-motion: reduce` (returning `undefined` so SvelteKit does
	// its instant swap in both cases). On the happy path it resolves the DOM swap
	// INSIDE startViewTransition and awaits `navigation.complete`, so the new
	// surface settles within the transition. CSS side lives in app.css
	// (@view-transition + the ::view-transition-*(root) cross-fade, reduced-motion
	// guarded). Canonical SvelteKit + View Transitions recipe.
	onNavigate((navigation) => runViewTransition(navigation));

	// Retry from the error edge state: re-boot client-side (a full reload would
	// just re-run the same failing SSR boot). Browser-only via clientBoot's guard.
	function retryBoot() {
		void clientBoot();
	}

	async function selectSearchResult(result: ChromeSearchResult): Promise<void> {
		if (result.kind === 'address' && !hasResultCoordinates(result)) {
			await selectUnresolvedAddressResult(result);
			return;
		}
		topSearch = '';
		addressSessionToken = createAddressSessionToken();
		void goto(
			localizeHref(chromeSearchResultHref(result, searchScope, $page.url.searchParams), locale),
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
			{ scope: searchScope },
		);
		if (first) {
			await selectSearchResult(first);
			return;
		}

		// The line/stop catalogues never resolve an address — no fallback there.
		if (searchScope === 'route' || searchScope === 'stop') return;
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
			`/api/geocode/montreal?q=${encodeURIComponent(query)}&suggest=1&limit=${limit}&session=${encodeURIComponent(addressSessionToken)}`,
			{ signal },
		);
		if (!response.ok) return [];
		const payload = (await response.json()) as { results?: GeocodeSuggestion[] };
		return payload.results ?? [];
	}

	async function selectUnresolvedAddressResult(result: ChromeSearchResult): Promise<void> {
		// A Google suggestion is coordinate-less but carries a placeId — resolve the
		// EXACT place via Place Details (reusing the autocomplete session token)
		// instead of re-text-searching its label, which landed on the wrong place.
		const resolved = result.placeId
			? await fetchPlaceDetails(result.placeId)
			: await fetchGeocodedLocation(result.label);
		if (!resolved) return;

		topSearch = '';
		addressSessionToken = createAddressSessionToken();
		void goto(
			localizeHref(
				chromeSearchResultHref(
					{
						kind: 'address',
						id: `${resolved.lat},${resolved.lon}`,
						label: resolved.label,
						lat: resolved.lat,
						lon: resolved.lon,
						precision: resolved.precision,
						priority: 30,
					},
					searchScope,
					$page.url.searchParams,
				),
				locale,
			),
			{ noScroll: true },
		);
	}

	async function fetchGeocodedLocation(query: string): Promise<GeocodedLocation | null> {
		const response = await fetch(`/api/geocode/montreal?q=${encodeURIComponent(query)}`);
		if (!response.ok) return null;
		return (await response.json()) as GeocodedLocation;
	}

	async function fetchPlaceDetails(placeId: string): Promise<GeocodedLocation | null> {
		const response = await fetch(
			`/api/geocode/montreal?placeId=${encodeURIComponent(placeId)}&session=${encodeURIComponent(addressSessionToken)}`,
		);
		if (!response.ok) return null;
		return (await response.json()) as GeocodedLocation;
	}

	function hasResultCoordinates(result: ChromeSearchResult): boolean {
		return typeof result.lat === 'number' && typeof result.lon === 'number';
	}

	function createAddressSessionToken(): string {
		return globalThis.crypto?.randomUUID?.() ?? `chrome-${Date.now()}-${Math.random()}`;
	}
</script>

<SeoHead
	title={seo.title}
	description={seo.description}
	siteName={seoSiteName}
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

<AppShell
	{locale}
	url={$page.url}
	providerName={v1?.manifest.display_name}
	providerShortName={v1?.manifest.short_name ?? undefined}
	bind:search={topSearch}
	searchResults={topSearchResults}
	{searchScope}
	onsearch={submitSearch}
	onresultselect={selectSearchResult}
	{mainLabel}
>
	{#snippet main()}
		<!-- Skip-link target. Layout splits on `isFullBleed` (see the derived above):
		     full-bleed surfaces (the map) fill the viewport, do NOT scroll, and omit
		     the Footer (a trailing footer would cram under the height:100% canvas);
		     document surfaces scroll, with the Footer at the natural bottom of the
		     flow — content grows to at least the viewport, tall content scrolls. -->
		<div
			id="main"
			class="flex h-full w-full flex-col {isFullBleed ? 'overflow-hidden' : 'overflow-y-auto'}"
			tabindex="-1"
		>
			<div class={isFullBleed ? 'min-h-0 grow' : 'grow shrink-0 basis-auto'}>
				{#if !v1}
					<!-- /v1 contract unreachable: render the honest error state, never a
					     crash. Retry (and an automatic client re-boot on mount) re-fetch
					     the contract; the page tree renders the moment a context lands. -->
					<div class="mx-auto flex h-full max-w-2xl items-center justify-center p-6">
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
				<Footer
					{locale}
					attribution={v1?.manifest.attribution}
					providerName={v1?.manifest.display_name}
				/>
			{/if}
		</div>
	{/snippet}
</AppShell>

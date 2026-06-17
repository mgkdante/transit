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
	// Self-hosted variable fonts (side-effect imports) BEFORE app.css.
	import '@fontsource-variable/inter';
	import '@fontsource-variable/jetbrains-mono';
	import '../app.css';

	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';

	import { setLocaleContext, DEFAULT_LOCALE, localizeHref, type Locale } from '$lib/i18n';
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
	import { AppShell } from '$lib/components/shell';
	import { EdgeState } from '$lib/components/edge';
	import { layout } from '$lib/nav';
	import {
		chromeSearchHref,
		chromeSearchResults,
		type ChromeSearchResult,
	} from '$lib/search/chromeSearch';
	import type { GeocodeSuggestion, GeocodedLocation } from '$lib/geocode/types';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// Active request locale (path-derived in +layout.ts). A reader is provided to
	// context so deep call sites that read it at init stay reactive across page
	// swaps (the root layout never remounts).
	const locale = $derived<Locale>(data.lang ?? DEFAULT_LOCALE);
	setLocaleContext(() => data.lang ?? DEFAULT_LOCALE);

	// v1 snapshot context. The SSR boot (+layout.ts) can fail on Cloudflare — a
	// Worker's fetch to its own zone can't reach the sibling /data route (523) —
	// so when it does we RE-BOOT client-side: the browser reaches /data fine.
	// `clientV1` holds that recovery; `v1` prefers the SSR value and falls back to
	// it. The context reader stays live, so once the client boot lands every
	// descendant that read getV1Context() at init sees the data without a remount.
	let clientV1 = $state<V1Context | null>(null);
	const v1 = $derived<V1Context | null>(data.v1 ?? clientV1);
	setV1Context(() => (v1 ?? undefined) as V1Context);
	$effect(() => {
		dataRefresh.noteDataGeneratedUtc(
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
		chromeSearchResults(topSearch, {
			routes: searchRoutes.data?.routes ?? [],
			stops: searchStops.data?.stops ?? [],
			vehicles: searchVehicles.data?.vehicles ?? [],
			addresses: addressSuggestions,
		}),
	);

	$effect(() => {
		const query = topSearch.trim();
		if (!browser || !shouldSuggestAddress(query)) {
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
	});

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
		void goto(localizeHref(chromeSearchHref(result, $page.url.searchParams), locale), {
			noScroll: true,
		});
	}

	async function submitSearch(value: string): Promise<void> {
		const query = value.trim();
		const [first] = chromeSearchResults(query, {
			routes: searchRoutes.data?.routes ?? [],
			stops: searchStops.data?.stops ?? [],
			vehicles: searchVehicles.data?.vehicles ?? [],
			addresses: addressSuggestions,
		});
		if (first) {
			await selectSearchResult(first);
			return;
		}

		if (!shouldSuggestAddress(query)) return;
		const addresses = await fetchAddressSuggestions(query, 1);
		const [addressResult] = chromeSearchResults(query, { addresses });
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
		const resolved = await fetchGeocodedLocation(result.label);
		if (!resolved) return;

		topSearch = '';
		addressSessionToken = createAddressSessionToken();
		void goto(
			localizeHref(
				chromeSearchHref(
					{
						kind: 'address',
						id: `${resolved.lat},${resolved.lon}`,
						label: resolved.label,
						lat: resolved.lat,
						lon: resolved.lon,
						precision: resolved.precision,
					},
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

	function hasResultCoordinates(result: ChromeSearchResult): boolean {
		return typeof result.lat === 'number' && typeof result.lon === 'number';
	}

	function createAddressSessionToken(): string {
		return globalThis.crypto?.randomUUID?.() ?? `chrome-${Date.now()}-${Math.random()}`;
	}
</script>

<svelte:head>
	<title>{locale === 'fr' ? 'Transit · carte STM en direct' : 'Transit · live STM map'}</title>
	<meta
		name="description"
		content={locale === 'fr'
			? 'Carte en direct des bus, arrêts, lignes et alertes STM à Montréal.'
			: 'Live STM map for Montreal buses, stops, routes, and alerts.'}
	/>
</svelte:head>

<AppShell
	{locale}
	url={$page.url}
	bind:search={topSearch}
	searchResults={topSearchResults}
	onsearch={submitSearch}
	onresultselect={selectSearchResult}
>
	{#snippet main()}
		<!-- Skip-link target. The page tree (or the error edge state) renders here;
		     each shell zone scrolls internally, so this wrapper owns the scroll. -->
		<div id="main" class="h-full w-full overflow-y-auto" tabindex="-1">
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
	{/snippet}
</AppShell>

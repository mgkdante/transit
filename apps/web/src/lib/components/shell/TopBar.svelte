<!--
  TopBar — the fixed app chrome strip (h60 on desktop).

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
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, PUBLISHED_LOCALES, getLocale } from '$lib/i18n';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import BrandWordmark from './BrandWordmark.svelte';
	import LiveClock from './LiveClock.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import LangSwitch from './LangSwitch.svelte';

	interface TopBarProps {
		/** Active request locale; omitted → getLocale() context. */
		locale?: Locale;
		/** Full current URL — the language switch preserves path + query + hash. */
		url?: URL;
		/** Count of active alerts; renders the bell badge when > 0. */
		alertCount?: number;
		/** Current value of the multi-value search field (bindable). */
		search?: string;
		/** Fired when the search field is submitted (Enter). */
		onsearch?: (value: string) => void;
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
		onalerts,
		availableLocales = PUBLISHED_LOCALES,
		class: className,
	}: TopBarProps = $props();

	// Prop wins (persistent chrome); fall back to context for isolated renders.
	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	// --- Localized strings ---------------------------------------------------
	const liveLabel = $derived(locale === 'fr' ? 'En direct' : 'Live');
	const homeAria = $derived(
		locale === 'fr' ? 'Accueil — tableau de bord transit' : 'Home — transit dashboard',
	);
	const searchPlaceholder = $derived(
		locale === 'fr' ? 'Rechercher une ligne, un arrêt…' : 'Search a line, stop…',
	);
	const searchAria = $derived(locale === 'fr' ? 'Rechercher dans le réseau' : 'Search the network');
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
	// Cap the visible badge count so the pill never blows out the strip.
	const badgeText = $derived(alertCount > 99 ? '99+' : String(alertCount));

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		onsearch?.(search.trim());
	}
</script>

<header
	class={cn(
		'flex h-[60px] w-full shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:gap-4 sm:px-4',
		className,
	)}
	data-slot="topbar"
>
	<!-- BRAND: yesid. (-> yesid.dev) · transit home + live dot ------------- -->
	<div class="flex shrink-0 items-center gap-2 sm:gap-2.5" data-slot="topbar-brand">
		<BrandWordmark href="https://yesid.dev" />
		<span class="topbar-divider" aria-hidden="true"></span>
		<a href="/" class="topbar-home" aria-label={homeAria} data-slot="topbar-home">
			<span class="topbar-product">transit</span>
			<span class="inline-flex items-center gap-1.5" data-slot="topbar-live">
				<StatusDot color="orange" pulse label={liveLabel} />
				<span class="label-station hidden text-[0.625rem] sm:inline">{liveLabel}</span>
			</span>
		</a>
	</div>

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
		class="relative flex min-w-0 flex-1 items-center"
		role="search"
		onsubmit={submitSearch}
		data-slot="topbar-search"
	>
		<svg
			class="pointer-events-none absolute left-2.5 text-muted-foreground"
			viewBox="0 0 16 16"
			width="15"
			height="15"
			aria-hidden="true"
			fill="none"
		>
			<circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.4" />
			<line
				x1="10.4"
				y1="10.4"
				x2="14"
				y2="14"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linecap="round"
			/>
		</svg>
		<input
			type="search"
			bind:value={search}
			placeholder={searchPlaceholder}
			aria-label={searchAria}
			autocomplete="off"
			spellcheck="false"
			class="h-9 w-full min-w-0 rounded-lg border border-border-subtle bg-popover pl-8 pr-3 text-small text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
		/>
	</form>

	<!-- RIGHT: clock · alerts · theme · lang ------------------------------- -->
	<div class="flex shrink-0 items-center gap-1 sm:gap-2" data-slot="topbar-controls">
		<LiveClock {locale} class="hidden sm:inline" />

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
	</div>
</header>

<style>
	/* Brand divider — the same bold brand-border rule as the yesid.dev nav pill. */
	.topbar-divider {
		display: inline-block;
		width: 2px;
		height: 18px;
		background: var(--border-brand);
		flex-shrink: 0;
	}

	.topbar-home {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: var(--radius-sm);
		transition: color var(--duration-fast, 120ms) var(--ease-default, ease);
	}
	.topbar-home:hover .topbar-product {
		color: var(--primary);
	}
	.topbar-home:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.topbar-product {
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: 1rem;
		color: var(--foreground);
		white-space: nowrap;
		transition: color var(--duration-fast, 120ms) var(--ease-default, ease);
	}
	/* Tightest phones: keep the brand mark + dot, drop the product word. */
	@media (max-width: 400px) {
		.topbar-product {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.topbar-home,
		.topbar-product {
			transition: none;
		}
	}
</style>

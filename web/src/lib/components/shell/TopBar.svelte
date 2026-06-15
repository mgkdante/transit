<!--
  TopBar — the fixed app chrome strip (h60 on desktop).

  Three logical clusters, left→right:
    LEFT  : wordmark "métro." + live LED dot, then a city picker placeholder.
    CENTER: a multi-value search input (the global "find a line / stop / vehicle"
            field — surface routing is the caller's job via `onsearch`).
    RIGHT : the live wall-clock (America/Toronto), an alerts bell + count badge,
            the theme toggle (signal-lamp) and the language switch (fingerpost).

  Adapted from yesid.dev's floating-pill Nav idioms (wordmark + live dot, the
  ThemeToggle signal-lamp, the LanguageToggle fingerpost) — re-themed to the
  transit board strip, stripped of gsap/magnetic/lenis. Pure runes + tokens.

  DOCTRINE: orange --primary is INTERACTIVE-only. The live dot is the ONE place
  --primary speaks as the "system is live" affordance; the alerts badge encodes
  a COUNT (interactive number pill), not a data category. No --primary marks
  stand in for data here.

  PERSISTENT CHROME: this rides the never-remounting shell, so `locale` is a
  prop (with $derived reads) rather than an init-frozen getLocale() — matching
  the yesid.dev ThemeToggle/LanguageToggle convention. It still falls back to
  getLocale() context when the prop is omitted (isolated renders / tests).
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { formatClock } from '$lib/utils';
	import { themeStore } from '$lib/stores';
	import {
		type Locale,
		DEFAULT_LOCALE,
		PUBLISHED_LOCALES,
		getLocale,
		localizeUrl,
	} from '$lib/i18n';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	interface TopBarProps {
		/**
		 * Active request locale. Persistent chrome passes this from the layout so
		 * label/aria strings stay reactive across EN⇄FR; omitted → getLocale().
		 */
		locale?: Locale;
		/** Full current URL — the language switch preserves its path + query + hash. */
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

	// --- Live wall-clock (America/Toronto), ticking once per second ----------
	let now = $state(new Date());
	onMount(() => {
		if (!browser) return;
		const id = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(id);
	});
	const clock = $derived(formatClock(now, locale));

	// --- Theme toggle (signal-lamp: top lens lit = dark) ---------------------
	const isDark = $derived(themeStore.isDark);
	const themeLabel = $derived(
		locale === 'fr'
			? isDark
				? 'Passer au thème clair'
				: 'Passer au thème sombre'
			: isDark
				? 'Switch to light theme'
				: 'Switch to dark theme',
	);

	// --- Language switch (fingerpost) ----------------------------------------
	const CODE: Record<Locale, string> = { en: 'EN', fr: 'FR' };
	const NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' };
	const localeIdx = $derived(Math.max(0, availableLocales.indexOf(locale)));
	const nextLocale = $derived(availableLocales[(localeIdx + 1) % availableLocales.length]);
	const langHref = $derived(localizeUrl(url, nextLocale));
	const langAria = $derived(
		`${locale === 'fr' ? 'Changer de langue' : 'Switch language'}: ${NAMES[locale] ?? locale}`,
	);

	// --- Localized strings ---------------------------------------------------
	const liveLabel = $derived(locale === 'fr' ? 'En direct' : 'Live');
	const searchPlaceholder = $derived(
		locale === 'fr' ? 'Rechercher une ligne, un arrêt…' : 'Search a line, stop…',
	);
	const searchAria = $derived(
		locale === 'fr' ? 'Rechercher dans le réseau' : 'Search the network',
	);
	const cityLabel = $derived(locale === 'fr' ? 'Montréal · STM' : 'Montréal · STM');
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
	<!-- LEFT: wordmark + live dot ------------------------------------------ -->
	<a
		href="/"
		class="group flex shrink-0 items-center gap-2 font-heading text-[1.0625rem] font-bold text-foreground"
		data-slot="topbar-wordmark"
	>
		<span>métro</span><span class="text-primary">.</span>
		<span class="ml-1 inline-flex items-center gap-1.5" data-slot="topbar-live">
			<StatusDot color="orange" pulse label={liveLabel} />
			<span class="label-station hidden text-[0.625rem] sm:inline">{liveLabel}</span>
		</span>
	</a>

	<!-- City picker placeholder (no Family data in 9.2) -------------------- -->
	<button
		type="button"
		class="tap-press hidden shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle bg-popover px-2.5 py-1.5 text-small text-foreground transition-colors hover:border-primary hover:text-primary md:inline-flex"
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
			<line x1="10.4" y1="10.4" x2="14" y2="14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
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
		<!-- Live clock (America/Toronto). aria-hidden: decorative signage. -->
		<time
			class="hidden font-mono text-small tabular-nums text-secondary-foreground sm:inline"
			datetime={now.toISOString()}
			aria-hidden="true"
			data-slot="topbar-clock">{clock}</time
		>

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
				<path d="M8.4 16a1.7 1.7 0 0 0 3.2 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
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

		<!-- Theme toggle — signal-lamp (top lens lit = dark / night running). -->
		<button
			type="button"
			class="theme-toggle tap-press"
			role="switch"
			aria-checked={isDark}
			aria-label={themeLabel}
			onclick={() => themeStore.toggle()}
			data-slot="topbar-theme"
		>
			<svg viewBox="0 0 20 28" width="13" height="18" aria-hidden="true">
				<rect x="3" y="2" width="14" height="24" rx="4" fill="none" stroke="currentColor" stroke-width="1.5" />
				<line x1="10" y1="26" x2="10" y2="28" stroke="currentColor" stroke-width="1.5" />
				<circle class="lens" class:lit={isDark} cx="10" cy="9" r="3.5" />
				<circle class="lens" class:lit={!isDark} cx="10" cy="19" r="3.5" />
			</svg>
		</button>

		<!-- Language switch — fingerpost (current locale board filled). -->
		{#if availableLocales.length >= 2}
			<a
				href={langHref}
				data-sveltekit-preload-data="hover"
				data-sveltekit-noscroll
				class="lang-post tap-press"
				aria-label={langAria}
				title={NAMES[locale] ?? locale}
				data-slot="topbar-lang"
			>
				<svg viewBox="0 0 44 28" width="34" height="22" aria-hidden="true">
					<line class="pole" x1="22" y1="4" x2="22" y2="26" stroke-linecap="round" />
					<circle class="finial" cx="22" cy="3" r="1.6" />
					<!-- top board: current locale (filled), pointing right -->
					<g class="board active">
						<path class="plate" d="M24 7 H40 L43 11 L40 15 H24 Z" />
						<text x="31.5" y="13">{CODE[locale] ?? locale.toUpperCase()}</text>
					</g>
					<!-- bottom board: next locale (outline), pointing left -->
					<g class="board">
						<path class="plate" d="M20 16 H4 L1 20 L4 24 H20 Z" />
						<text x="12" y="22">{CODE[nextLocale] ?? nextLocale.toUpperCase()}</text>
					</g>
				</svg>
				<span class="sr-only" aria-live="polite">{NAMES[locale] ?? locale}</span>
			</a>
		{/if}
	</div>
</header>

<style>
	/* Signal-lamp theme toggle — line-art signal head, lit lens fills --primary. */
	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2.25rem;
		width: 2.25rem;
		padding: 0;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--secondary-foreground);
		border-radius: var(--radius-lg);
		transition: color var(--duration-fast, 120ms) var(--ease-default, ease);
	}
	.theme-toggle:hover {
		color: var(--foreground);
		background: var(--muted);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	.lens {
		fill: transparent;
		stroke: currentColor;
		stroke-width: 1.25;
		transition:
			fill var(--duration-normal, 220ms) var(--ease-default, ease),
			filter var(--duration-normal, 220ms) var(--ease-default, ease);
	}
	.lens.lit {
		fill: var(--primary);
		stroke: var(--primary);
		filter: drop-shadow(0 0 3px color-mix(in srgb, var(--primary) 60%, transparent));
	}

	/* Fingerpost language switch — flat line-art, current board filled. */
	.lang-post {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2.25rem;
		min-width: 2.25rem;
		padding: 0 2px;
		color: var(--secondary-foreground);
		border-radius: var(--radius-lg);
		transition: color var(--duration-fast, 120ms) var(--ease-default, ease);
	}
	.lang-post:hover {
		color: var(--foreground);
		background: var(--muted);
	}
	.lang-post:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	.pole {
		stroke: currentColor;
		stroke-width: 1.5;
	}
	.finial {
		fill: currentColor;
	}
	.plate {
		fill: transparent;
		stroke: currentColor;
		stroke-width: 1.25;
		stroke-linejoin: round;
	}
	.board text {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.02em;
		fill: currentColor;
		text-anchor: middle;
	}
	.board.active .plate {
		fill: var(--primary);
		stroke: var(--primary);
	}
	.board.active text {
		fill: var(--primary-foreground);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.theme-toggle,
		.lens {
			transition: none;
		}
	}
</style>

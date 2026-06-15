<!--
  LangSwitch — the fingerpost EN/FR switch (flat line-art signpost; the current
  locale's board is filled, the next is outlined and points the other way). A
  real <a> to the localized URL so it preserves path + query + hash and works
  without JS (progressive enhancement). Renders only when ≥2 locales ship.
  Extracted from TopBar for reuse + isolated testing.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { type Locale, PUBLISHED_LOCALES, localizeUrl } from '$lib/i18n';

	interface Props {
		locale: Locale;
		/** Full current URL — the switch keeps the path + query + hash. */
		url: URL;
		availableLocales?: readonly Locale[];
		class?: string;
	}

	let { locale, url, availableLocales = PUBLISHED_LOCALES, class: className }: Props = $props();

	const CODE: Record<Locale, string> = { en: 'EN', fr: 'FR' };
	const NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' };
	const idx = $derived(Math.max(0, availableLocales.indexOf(locale)));
	const nextLocale = $derived(availableLocales[(idx + 1) % availableLocales.length]);
	const href = $derived(localizeUrl(url, nextLocale));
	const aria = $derived(
		`${locale === 'fr' ? 'Changer de langue' : 'Switch language'}: ${NAMES[locale] ?? locale}`,
	);
</script>

{#if availableLocales.length >= 2}
	<a
		{href}
		data-sveltekit-preload-data="hover"
		data-sveltekit-noscroll
		class={cn('lang-post tap-press', className)}
		aria-label={aria}
		title={NAMES[locale] ?? locale}
		data-slot="lang-switch"
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

<style>
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
		.lang-post {
			transition: none;
		}
	}
</style>

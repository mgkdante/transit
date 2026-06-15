<!--
  Footer — the site footer strip.

  Ported from yesid.dev's layout/Footer.svelte; same two-row structure, re-themed
  to transit tokens and re-contented for the citizen dashboard:
    Row 1 (above the hazard rule):
      LEFT   : the yesid. parent-brand wordmark (-> yesid.dev) + the "transit"
               product mark + a bilingual tagline. transit.yesid.dev is a
               yesid.dev product, so the chrome carries the house mark — mirrors
               the TopBar brand cluster.
      CENTER : the IA nav links (menuItems from $lib/content/nav), localized.
      RIGHT  : the external portfolio link back to yesid.dev.
    Row 2 (below the hazard rule, departure-board rule):
      STM open-data attribution ("Données STM — CC BY 4.0") + the unofficial-site
      disclaimer (Honesty Gate #6) on the left; the live system-date readout on
      the right (the orange route-set lamp is the lone --primary touch).

  DOCTRINE: orange --primary is INTERACTIVE-only. The footer-link underline draw
  and the status lamp are the only --primary marks; no data is painted here.
  Bilingual via getLocale() context (no prop drilling) + the inline
  Record<Locale, ...> copy pattern. Reduced-motion-safe (link transitions guarded).
-->
<script lang="ts">
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { menuItems } from '$lib/content/nav';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import BrandWordmark from '$lib/components/shell/BrandWordmark.svelte';

	const locale: Locale = getLocale();

	// System date — the departure-board readout (YYYY.MM.DD), matches yesid's footer.
	const now = new Date();
	const systemDate = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

	type CopyKey =
		| 'tagline'
		| 'navAria'
		| 'attribution'
		| 'disclaimer'
		| 'statusPrefix'
		| 'liveLabel';
	const T: Record<Locale, Record<CopyKey, string>> = {
		fr: {
			tagline: 'Analytique citoyenne du réseau STM',
			navAria: 'Pied de page',
			attribution: 'Données STM — CC BY 4.0',
			disclaimer: 'Site non officiel — sans affiliation avec la STM.',
			statusPrefix: 'SYSTÈME',
			liveLabel: 'En direct',
		},
		en: {
			tagline: 'Citizen analytics for the STM network',
			navAria: 'Footer',
			attribution: 'STM data — CC BY 4.0',
			disclaimer: 'Unofficial website — not affiliated with the STM.',
			statusPrefix: 'SYSTEM',
			liveLabel: 'Live',
		},
	};
	const t = $derived(T[locale]);

	// IA links — locale-LESS hrefs from the nav inventory, localized at render.
	// External entries (the portfolio) split out into the right cluster below.
	const navLinks = $derived(
		menuItems
			.filter((item) => !item.external)
			.map((item) => ({
				label: item.label[locale],
				href: localizeHref(item.href, locale),
			})),
	);
	const externalLinks = $derived(
		menuItems
			.filter((item) => item.external)
			.map((item) => ({ label: item.label[locale], href: item.href })),
	);
</script>

<footer data-testid="footer" data-slot="footer" class="relative z-50 bg-[var(--muted)]">
	<!-- Platform edge: the footer's top line is real hazard tape. -->
	<div class="footer-gradient-sep" aria-hidden="true"></div>

	<!-- Row 1: Main content -->
	<div
		class="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 pb-5 pt-10 sm:flex-row sm:items-start sm:justify-between sm:px-10 sm:pt-12"
	>
		<!-- Left: parent wordmark + transit product mark + tagline -->
		<div class="flex flex-col items-center sm:items-start">
			<span class="flex items-center gap-2">
				<BrandWordmark href="https://yesid.dev" animate={false} />
				<span class="footer-divider" aria-hidden="true"></span>
				<a
					href={localizeHref('/', locale)}
					data-testid="footer-home"
					class="footer-product font-heading text-xl font-bold text-[var(--foreground)]"
				>
					transit
				</a>
			</span>
			<span class="mt-1 font-mono text-caption text-[var(--muted-foreground)]">{t.tagline}</span>
		</div>

		<!-- Center: IA nav links -->
		<nav aria-label={t.navAria} class="flex flex-wrap justify-center gap-x-6 gap-y-2">
			{#each navLinks as link (link.href)}
				<a
					href={link.href}
					class="footer-link text-small text-[var(--secondary-foreground)] transition-colors hover:text-primary active:text-primary"
				>
					{link.label}
				</a>
			{/each}
		</nav>

		<!-- Right: external (portfolio) links -->
		<div class="flex items-center gap-4">
			{#each externalLinks as link (link.href)}
				<a
					href={link.href}
					target="_blank"
					rel="noopener noreferrer"
					class="footer-link text-small text-[var(--secondary-foreground)] transition-colors hover:text-primary active:text-primary"
				>
					{link.label}
				</a>
			{/each}
		</div>
	</div>

	<!-- Row 2: Status bar — below the hazard rule. STM open-data attribution + the
	     unofficial-site disclaimer (Honesty Gate #6) on the left; the live system
	     readout on the right (the orange route-set lamp is the lone --primary touch). -->
	<div
		class="footer-status-border mx-auto flex max-w-5xl flex-col items-center gap-2 px-6 py-4 font-mono text-caption text-[var(--muted-foreground)] sm:flex-row sm:justify-between sm:px-10"
	>
		<p class="footer-honesty m-0 text-center sm:text-left">
			<span>{t.attribution}</span>
			<span class="footer-disclaimer">{t.disclaimer}</span>
		</p>
		<span class="flex items-center gap-1.5 text-[var(--accent-text)]">
			<StatusDot color="orange" pulse label={t.liveLabel} />
			{t.statusPrefix}
			{systemDate}
		</span>
	</div>
</footer>

<style>
	/* Platform-edge hazard strip (theme-invariant yellow + warm black — matches
	   the Separator hazard recipe). */
	.footer-gradient-sep {
		height: 3px;
		background: repeating-linear-gradient(
			-45deg,
			var(--hazard-a) 0px,
			var(--hazard-a) 6px,
			var(--hazard-b) 6px,
			var(--hazard-b) 12px
		);
	}

	/* The status bar's top line is a BOLD departure-board rule — the yellow
	   wayfinding voice as structure. */
	.footer-status-border {
		border-top: 2px solid var(--border-rule-accent);
	}

	footer {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}

	/* Brand divider between the parent wordmark and the product mark — the same
	   bold brand-border rule as the TopBar brand cluster. */
	.footer-divider {
		display: inline-block;
		width: 2px;
		height: 18px;
		background: var(--border-brand);
		flex-shrink: 0;
	}

	.footer-product {
		white-space: nowrap;
		letter-spacing: -0.01em;
		border-radius: var(--radius-sm);
		transition: color var(--duration-fast) var(--ease-default);
	}
	.footer-product:hover {
		color: var(--primary);
	}
	.footer-product:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	/* Honesty line — attribution + the unofficial-site disclaimer stack tight. */
	.footer-honesty {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.footer-disclaimer {
		color: var(--secondary-foreground);
	}

	/* Underline draw, blueprint line at word scale (the lone --primary touch). */
	.footer-link {
		background-image: linear-gradient(var(--primary), var(--primary));
		background-repeat: no-repeat;
		background-position: 0 100%;
		background-size: 0% 1px;
		transition:
			background-size var(--duration-fast) var(--ease-out),
			color var(--duration-fast) var(--ease-default);
	}
	.footer-link:hover,
	.footer-link:focus-visible {
		background-size: 100% 1px;
	}

	@media (prefers-reduced-motion: reduce) {
		.footer-product,
		.footer-link {
			transition: none;
		}
	}
</style>

<!--
  Footer, the site footer strip.

  Ported from yesid.dev's layout/Footer.svelte; same two-row structure, re-themed
  to transit tokens and re-contented for the citizen dashboard:
    Row 1 (above the hazard rule):
      LEFT   : the yesid. parent-brand wordmark (-> yesid.dev) + the "transit"
               product mark + a bilingual tagline. transit.yesid.dev is a
               yesid.dev product, so the chrome carries the house mark, mirrors
               the TopBar brand cluster.
      RIGHT  : localized Explore, Audit and Legal link groups from the canonical nav.
    Row 2 (below the hazard rule, departure-board rule):
      caller-supplied attribution (the active manifest's verbatim licence on data
      routes, static under-review copy on legal placeholders) + the unofficial-site
      disclaimer (Honesty Gate #6) on the left; the live system-date readout on
      the right (the orange route-set lamp is the lone --primary touch).

  DOCTRINE: orange --primary is INTERACTIVE-only. The footer-link underline draw
  and the status lamp are the only --primary marks; no data is painted here.
  Bilingual via getLocale() context (no prop drilling) + the co-located,
  FR-canonical footer.copy.ts pattern. Reduced-motion-safe (link transitions guarded).
-->
<script lang="ts">
	import { DEFAULT_LOCALE, getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { FooterGroup, FooterLink } from '@yesid/ui/footer';
	import { SURFACE_NAV, AUDIT_NAV, LEGAL_NAV } from '$lib/content/nav';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import BrandCluster from '$lib/components/brand/BrandCluster.svelte';
	import { footerCopy } from './footer.copy';

	interface FooterProps {
		/** Active locale (prop wins; falls back to context for isolated renders). */
		locale?: Locale;
		/**
		 * Caller-owned attribution rendered verbatim. Data routes supply the active
		 * manifest licence; legal placeholders supply static under-review copy.
		 * Omitted ⇒ the line is hidden (never fabricate a licence we do not hold).
		 */
		attribution?: string;
		/** Provider display name (manifest.display_name); drives the tagline + disclaimer. */
		providerName?: string;
	}

	let { locale: localeProp, attribution: attributionProp, providerName }: FooterProps = $props();

	// Prop wins (the layout threads the reactive request locale so the footer copy
	// + localized hrefs stay current across EN⇄FR without a remount); fall back to
	// the context reader for isolated renders (e.g. the _kit harness / tests).
	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	// System date, the departure-board readout (YYYY.MM.DD), matches yesid's footer.
	const now = new Date();
	const systemDate = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

	const t = $derived(footerCopy[locale]);

	// Provider-driven copy (multi-provider Layer A): the agency NAME comes from the
	// manifest (display_name), with a neutral, provider-agnostic fallback for the
	// brief window before the v1 context boots — NEVER a hardcoded 'STM'.
	const agencyName = $derived(providerName ?? t.providerFallback);
	const tagline = $derived(t.tagline(agencyName));
	const disclaimer = $derived(t.disclaimer(agencyName));

	// The three footer groups consume the canonical manifests directly, preserving
	// their distinct wayfinding/accountability/legal roles and manifest order.
	const exploreLinks = $derived(
		SURFACE_NAV.map((item) => ({
			label: item.label[locale],
			href: localizeHref(item.href, locale),
		})),
	);
	const auditLinks = $derived(
		AUDIT_NAV.map((item) => ({
			label: item.label[locale],
			href: localizeHref(item.href, locale),
		})),
	);
	const legalLinks = $derived(
		LEGAL_NAV.map((item) => ({
			label: item.label[locale],
			href: localizeHref(item.href, locale),
		})),
	);
</script>

<footer data-testid="footer" data-slot="footer" class="relative z-50 bg-[var(--muted)]">
	<!-- Platform edge: the footer's top line is real hazard tape. -->
	<div class="footer-gradient-sep" aria-hidden="true"></div>

	<!-- Row 1: Main content -->
	<div
		class="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 pb-5 pt-10 sm:flex-row sm:items-start sm:justify-between sm:px-10 sm:pt-12"
	>
		<!-- Left: parent wordmark + transit product mark + tagline (shared cluster). -->
		<div class="flex flex-col items-center sm:items-start">
			<BrandCluster variant="footer" productHref={localizeHref('/', locale)} />
			<span class="mt-1 font-mono text-caption text-[var(--muted-foreground)]">{tagline}</span>
		</div>

		<!-- Right: one labelled landmark with Explore, Audit and Legal groups. -->
		<nav aria-label={t.navAria} class="flex flex-wrap justify-center gap-x-8 gap-y-6">
			<FooterGroup
				label={t.exploreLabel}
				role="group"
				aria-label={t.exploreLabel}
				class="items-center sm:items-start"
			>
				{#each exploreLinks as link (link.href)}
					<FooterLink href={link.href}>{link.label}</FooterLink>
				{/each}
			</FooterGroup>
			<FooterGroup
				label={t.auditLabel}
				role="group"
				aria-label={t.auditLabel}
				class="items-center sm:items-start"
			>
				{#each auditLinks as link (link.href)}
					<FooterLink href={link.href}>{link.label}</FooterLink>
				{/each}
			</FooterGroup>
			<FooterGroup
				label={t.legalLabel}
				role="group"
				aria-label={t.legalLabel}
				class="items-center sm:items-start"
			>
				{#each legalLinks as link (link.href)}
					<FooterLink href={link.href}>{link.label}</FooterLink>
				{/each}
			</FooterGroup>
		</nav>
	</div>

	<!-- Row 2: Status bar, below the hazard rule. Caller-supplied attribution + the
	     unofficial-site disclaimer (Honesty Gate #6) sit on the left; the live system
	     readout sits on the right (the orange route-set lamp is the lone --primary touch). -->
	<div
		class="footer-status-border mx-auto flex max-w-5xl flex-col items-center gap-2 px-6 py-4 font-mono text-caption text-[var(--muted-foreground)] sm:flex-row sm:justify-between sm:px-10"
	>
		<p class="footer-honesty m-0 text-center sm:text-left">
			{#if attributionProp}<span>{attributionProp}</span>{/if}
			<span class="footer-disclaimer">{disclaimer}</span>
		</p>
		<span class="flex items-center gap-1.5 text-[var(--accent-text)]">
			<StatusDot color="orange" pulse label={t.liveLabel} />
			{t.statusPrefix}
			{systemDate}
		</span>
	</div>
</footer>

<style>
	/* Platform-edge hazard strip (theme-invariant yellow + warm black, matches
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

	/* The status bar's top line is a BOLD departure-board rule — a full-width
	   structural divider on the strong-border ink (P7: not a brand accent rule). */
	.footer-status-border {
		border-top: 2px solid var(--border-strong);
	}

	footer {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}

	/* The brand cluster (yesid. mark · divider · transit product mark) now lives in
	   BrandCluster.svelte, the shared brand primitive, also used by the TopBar. */

	/* Honesty line, attribution + the unofficial-site disclaimer stack tight. */
	.footer-honesty {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.footer-disclaimer {
		color: var(--secondary-foreground);
	}

	/* FooterLink owns the underline and tap floor. Keep the footer-specific
	   reduced-motion guarantee even though the leaf is shared. */
	@media (prefers-reduced-motion: reduce) {
		:global([data-slot='footer-link']) {
			transition: none;
		}
	}
</style>

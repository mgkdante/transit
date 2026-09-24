<script lang="ts">
	import { onMount } from 'svelte';
	import { DEFAULT_LOCALE, getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { FooterGroup, FooterLink } from '@yesid/ui/footer';
	import { SURFACE_NAV, AUDIT_NAV, LEGAL_NAV } from '$lib/content/nav';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import BrandCluster from '$lib/components/brand/BrandCluster.svelte';
	import { footerCopy } from './footer.copy';

	interface FooterProps {
		locale?: Locale;
		/** Render the caller's licence verbatim; omission must not invent an attribution. */
		attribution?: string;
		providerName?: string;
	}

	let { locale: localeProp, attribution: attributionProp, providerName }: FooterProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	const now = new Date();
	const systemDate = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

	const t = $derived(footerCopy[locale]);

	const agencyName = $derived(providerName ?? t.providerFallback);
	const tagline = $derived(t.tagline(agencyName));
	const disclaimer = $derived(t.disclaimer(agencyName));

	const groups = $derived([
		{ label: t.exploreLabel, links: SURFACE_NAV },
		{ label: t.auditLabel, links: AUDIT_NAV },
		{ label: t.legalLabel, links: LEGAL_NAV, testId: 'footer-legal' },
	]);

	let footer: HTMLElement;
	let inView = $state(false);
	onMount(() => {
		if (typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(([entry]) => (inView = entry.isIntersecting));
		observer.observe(footer);
		return () => observer.disconnect();
	});
</script>

<footer
	bind:this={footer}
	data-in-view={inView}
	data-testid="footer"
	data-slot="footer"
	class="relative z-[var(--z-content)] bg-[var(--muted)]"
>
	<div class="footer-gradient-sep" aria-hidden="true"></div>
	<div
		class="grid w-full grid-cols-1 gap-10 px-6 pb-8 pt-10 sm:grid-cols-2 sm:px-10 sm:pt-12 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-8 lg:px-16 lg:pt-14"
	>
		<div class="flex flex-col items-start">
			<BrandCluster variant="footer" productHref={localizeHref('/', locale)} />
			<span class="mt-2 font-mono text-xs text-[var(--muted-foreground)]">{tagline}</span>
		</div>
		{#each groups as group (group.label)}
			<nav aria-label={group.label} data-testid={group.testId} class="flex flex-col gap-2">
				<FooterGroup label={group.label}>
					{#each group.links as link (link.href)}
						<FooterLink href={localizeHref(link.href, locale)}>{link.label[locale]}</FooterLink>
					{/each}
				</FooterGroup>
			</nav>
		{/each}
	</div>
	<div
		class="footer-status-border flex w-full flex-col items-center gap-2 px-6 py-4 font-mono text-caption text-[var(--muted-foreground)] sm:flex-row sm:justify-between sm:px-10 lg:px-16"
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
	.footer-status-border {
		border-top: 2px solid var(--border-rule-accent);
	}

	footer {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	.footer-honesty {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.footer-disclaimer {
		color: var(--secondary-foreground);
	}
	@media (prefers-reduced-motion: reduce) {
		:global([data-slot='footer-link']) {
			transition: none;
		}
	}
</style>

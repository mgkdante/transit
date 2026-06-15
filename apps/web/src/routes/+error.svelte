<!--
  Branded error page.

  SvelteKit error pages have NO companion loader, so the locale is derived from
  the URL path (pathLocale; error renders carry no route params) and the copy
  lives inline (bilingual). Renders inside the AppShell `main` zone like any page.

  Doctrine: the status is glyph + colour + text (never colour alone); the error
  verdict colour rides the dataviz status scale (--dataviz-status-severe), NOT
  --destructive — an unreachable surface is a DATA verdict. The "go home" link is
  an interactive affordance, so it carries the --primary accent. Tokens, no hex.
-->
<script lang="ts">
	import { page } from '$app/stores';
	import { pathLocale, localizeHref, type Locale } from '$lib/i18n';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';

	// Defensive optional chain: the error page is the last surface that may
	// render, and bare test renders may not provide $page.url.
	const locale = $derived<Locale>(pathLocale($page.url?.pathname ?? '/'));
	const status = $derived($page.status);
	const detail = $derived($page.error?.message ?? '');

	type CopyKey = 'label' | 'heading404' | 'headingGeneric' | 'body404' | 'bodyGeneric' | 'home';
	const T: Record<Locale, Record<CopyKey, string>> = {
		fr: {
			label: 'HORS SERVICE',
			heading404: 'Cette voie n’existe pas',
			headingGeneric: 'Une erreur est survenue',
			body404: 'Le chemin demandé n’est pas desservi. Vérifiez l’adresse ou revenez à l’accueil.',
			bodyGeneric:
				'Quelque chose s’est mal passé en chargeant cette vue. Réessayez ou revenez à l’accueil.',
			home: 'Retour à l’accueil',
		},
		en: {
			label: 'OUT OF SERVICE',
			heading404: 'This track does not exist',
			headingGeneric: 'Something went wrong',
			body404: 'The requested path is not in service. Check the address or head back home.',
			bodyGeneric: 'Something failed while loading this view. Try again or head back home.',
			home: 'Back to home',
		},
	};
	const t = $derived(T[locale]);
	const is404 = $derived(status === 404);
	const heading = $derived(is404 ? t.heading404 : t.headingGeneric);
	const body = $derived(is404 ? t.body404 : t.bodyGeneric);
	const homeHref = $derived(localizeHref('/', locale));
</script>

<section class="err">
	<SectionLabel text={t.label} variant="station" align="center" />

	<!-- Status verdict: glyph + colour (dataviz severe) + text. -->
	<div class="err-status" role="alert">
		<span class="err-glyph" aria-hidden="true">◆</span>
		<span class="err-code">{status}</span>
	</div>

	<h1 class="err-heading">{heading}</h1>
	<p class="err-body">{body}</p>

	{#if detail}
		<p class="err-detail font-mono">{detail}</p>
	{/if}

	<a class="err-home" href={homeHref}>{t.home}</a>
</section>

<style>
	.err {
		max-width: 40rem;
		margin-inline: auto;
		padding: clamp(3rem, 10vw, 6rem) var(--space-page-x, 1.5rem);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		text-align: center;
	}
	.err-status {
		display: inline-flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	.err-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-title);
		line-height: 1;
		/* DATA verdict — rides the dataviz status scale, not --destructive. */
		color: var(--dataviz-status-severe);
	}
	.err-code {
		font-family: var(--font-mono);
		font-size: var(--text-title);
		font-weight: 700;
		color: var(--foreground);
	}
	.err-heading {
		font-family: var(--font-heading);
		font-size: var(--text-heading);
		font-weight: 700;
		color: var(--foreground);
		line-height: 1.15;
		max-width: 28ch;
	}
	.err-body {
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
		max-width: 44ch;
	}
	.err-detail {
		color: var(--muted-foreground);
		font-size: var(--text-caption);
		opacity: 0.8;
		word-break: break-word;
		max-width: 44ch;
	}
	.err-home {
		margin-top: 0.5rem;
		display: inline-flex;
		align-items: center;
		padding: 0.5rem 1.25rem;
		font-family: var(--font-body);
		font-size: var(--text-small);
		font-weight: 600;
		/* Interactive affordance — the only --primary touch on the page. */
		color: var(--primary-foreground);
		background: var(--primary);
		border-radius: var(--radius-md, 0.5rem);
		text-decoration: none;
		transition: background 150ms ease;
	}
	.err-home:hover {
		background: var(--primary-hover, var(--primary));
	}
	.err-home:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.err-home {
			transition: none;
		}
	}
</style>

<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { LEGAL_EFFECTIVE_DATE, legalDocument, type LegalPageKind } from './legal.copy';

	interface Props {
		kind: LegalPageKind;
		locale?: Locale;
	}

	let { kind, locale: localeProp }: Props = $props();
	const contextLocale = getLocale();
	const locale = $derived(localeProp ?? contextLocale);
	const document = $derived(legalDocument(locale, kind));
</script>

<article class="legal-document" data-testid="legal-document" aria-labelledby="legal-title">
	<header class="legal-document__header">
		<p class="legal-document__kicker">{document.kicker}</p>
		<h1 id="legal-title">{document.title}</h1>
		<p class="legal-document__effective">
			{document.effectiveLabel}:
			<time datetime={LEGAL_EFFECTIVE_DATE}>{document.effectiveDate}</time>
		</p>
		<p class="legal-document__summary">{document.summary}</p>
	</header>

	<div class="legal-document__sections">
		{#each document.sections as section (section.id)}
			<section aria-labelledby={`legal-${section.id}`}>
				<h2 id={`legal-${section.id}`}>{section.title}</h2>
				{#each section.paragraphs as paragraph (paragraph)}
					<p>{paragraph}</p>
				{/each}
				{#if section.bullets}
					<ul>
						{#each section.bullets as item (item)}
							<li>{item}</li>
						{/each}
					</ul>
				{/if}
				{#if section.links}
					<ul class="legal-document__links">
						{#each section.links as link (link.href)}
							<li>
								<a
									href={link.href}
									target={link.href.startsWith('https://') ? '_blank' : undefined}
									rel={link.href.startsWith('https://') ? 'noreferrer' : undefined}>{link.label}</a
								>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</div>
</article>

<style>
	.legal-document {
		display: grid;
		gap: 3rem;
		width: min(100% - 2rem, 52rem);
		margin-inline: auto;
		padding-block: calc(var(--chrome-offset) + 4rem) 6rem;
	}

	.legal-document__header,
	.legal-document__sections,
	section {
		display: grid;
		gap: 1rem;
	}

	.legal-document__sections {
		gap: 2.5rem;
	}

	.legal-document__kicker,
	.legal-document__effective,
	h1,
	h2,
	p,
	ul {
		margin: 0;
	}

	.legal-document__kicker,
	.legal-document__effective {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
	}

	.legal-document__kicker {
		color: var(--primary);
		font-weight: 700;
		letter-spacing: var(--tracking-eyebrow);
	}

	.legal-document__effective {
		color: var(--muted-foreground);
	}

	h1,
	h2 {
		font-family: var(--font-heading);
		line-height: var(--leading-tight);
	}

	h1 {
		font-size: var(--text-display);
	}

	h2 {
		font-size: var(--text-title);
	}

	p,
	li {
		max-width: var(--measure-lede);
		color: var(--secondary-foreground);
		line-height: var(--leading-relaxed);
	}

	.legal-document__summary {
		font-size: var(--text-lede);
	}

	ul {
		display: grid;
		gap: 0.5rem;
		padding-inline-start: 1.25rem;
	}

	.legal-document__links {
		list-style: none;
		padding-inline-start: 0;
	}

	a {
		color: var(--link);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}

	a:hover {
		color: var(--link-hover);
	}
</style>

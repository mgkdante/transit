<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { legalCopy, type LegalPageKind } from './legal.copy';

	interface Props {
		kind: LegalPageKind;
		locale?: Locale;
	}

	let { kind, locale: localeProp }: Props = $props();
	const contextLocale = getLocale();
	const locale = $derived(localeProp ?? contextLocale);
	const t = $derived(legalCopy[locale]);
	const title = $derived(kind === 'privacy' ? t.privacyTitle : t.termsTitle);
</script>

<section class="legal-placeholder" data-testid="legal-placeholder" aria-labelledby="legal-title">
	<p class="legal-placeholder__kicker">{t.kicker}</p>
	<h1 id="legal-title">{title}</h1>
	<p>{t.reviewNotice}</p>
	<p>{t.reviewDetail}</p>
</section>

<style>
	.legal-placeholder {
		display: grid;
		gap: 1rem;
		width: min(100% - 2rem, 52rem);
		min-height: 60dvh;
		margin-inline: auto;
		padding-block: calc(var(--chrome-offset) + 4rem) 6rem;
	}

	.legal-placeholder__kicker {
		margin: 0;
		color: var(--primary);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 700;
		letter-spacing: var(--tracking-eyebrow);
	}

	h1,
	p {
		margin: 0;
	}

	h1 {
		font-family: var(--font-heading);
		font-size: var(--text-display);
		line-height: var(--leading-tight);
	}

	p {
		max-width: 68ch;
		color: var(--secondary-foreground);
		line-height: var(--leading-relaxed);
	}
</style>

<script lang="ts">
	import { page } from '$app/stores';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import ErrorIllustration from '$lib/components/shared/ErrorIllustration.svelte';
	import TerminalCursor from '$lib/components/shared/TerminalCursor.svelte';
	import { Separator } from '$lib/components/ui/separator';
	import { localizeHref, pathLocale, type Locale } from '$lib/i18n';
	import { errorDocumentHead, errorPageCopy } from '$lib/site/errorPage';

	const locale = $derived<Locale>(pathLocale($page.url?.pathname ?? '/'));
	const status = $derived($page.status);
	const detail = $derived($page.error?.message ?? '');
	const is404 = $derived(status === 404);

	const generic = $derived(errorPageCopy[locale].generic);
	const notFound = $derived(errorPageCopy[locale].notFound);
	const suggestions = $derived(
		notFound.suggestions.map((suggestion) => ({
			...suggestion,
			href: localizeHref(suggestion.href, locale),
		})),
	);
	const homeHref = $derived(localizeHref('/', locale));
	const documentHead = $derived(errorDocumentHead(status, locale));
</script>

<svelte:head>
	<title>{documentHead.title} · Transit</title>
	{#if is404}
		<meta name="robots" content="noindex,nofollow" />
	{/if}
</svelte:head>

{#if is404}
	<section class="error-page">
		<div data-testid="hazard-tape">
			<Separator variant="hazard" hazardSize="sm" />
		</div>

		<div class="error-page-content">
			<div class="error-illustration">
				<ErrorIllustration />
			</div>

			<div class="error-copy">
				<SectionLabel text={notFound.label} variant="station" align="center" />
				<h1>{notFound.heading}</h1>
				<p>{notFound.description}</p>
			</div>

			<nav
				class="suggestions"
				aria-label={locale === 'fr' ? 'Destinations suggérées' : 'Suggested destinations'}
			>
				{#each suggestions as suggestion, index (suggestion.href)}
					<a
						class:suggestion-primary={index === 0}
						class:suggestion-secondary={index > 0}
						href={suggestion.href}
					>
						<span class:dot-solid={index === 0} class:dot-hollow={index > 0} aria-hidden="true"
						></span>
						{suggestion.label}
					</a>
				{/each}
			</nav>

			<p class="terminal-line" data-testid="terminal-line">
				<span class="terminal-command">$</span>
				<span> route --status</span>
				<span class="terminal-command"> {status}</span>
				<span class="terminal-note"> {notFound.statusNote}</span>
				<TerminalCursor />
			</p>
		</div>
	</section>
{:else}
	<section class="err">
		<SectionLabel text={generic.label} variant="station" align="center" />
		<div class="err-status" role="alert">
			<span class="err-glyph" aria-hidden="true">◆</span>
			<span class="err-code">{status}</span>
		</div>
		<SectionHeading heading={generic.heading} level={1} dot class="err-heading" />
		<p class="err-body">{generic.body}</p>
		{#if detail}
			<p class="err-detail font-mono">{detail}</p>
		{/if}
		<a class="err-home" href={homeHref}>{generic.home}</a>
	</section>
{/if}

<style>
	.error-page {
		width: 100%;
		min-height: calc(100dvh - 5rem);
		padding-inline: var(--space-page-x);
		display: flex;
		flex-direction: column;
	}

	.error-page-content {
		width: 100%;
		max-width: 52rem;
		margin-inline: auto;
		padding-block: 1rem;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.25rem;
	}

	.error-illustration {
		width: 100%;
		max-width: 24rem;
	}

	.error-copy {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
	}

	.error-copy h1 {
		max-width: 32rem;
		margin: 0;
		font-family: var(--font-heading);
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.25;
		letter-spacing: var(--tracking-tight);
		color: var(--foreground);
	}

	.error-copy p {
		max-width: 28rem;
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.625;
		color: var(--secondary-foreground);
	}

	.suggestions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.75rem;
	}

	.suggestions a {
		justify-content: center;
		min-width: 7.25rem;
		min-height: 2.5rem;
		padding: 0.625rem 1.25rem;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid;
		border-radius: var(--radius-pill);
		font-family: var(--font-body);
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			background var(--duration-normal) var(--ease-default),
			color var(--duration-normal) var(--ease-default),
			transform var(--duration-normal) var(--ease-default);
	}

	.suggestions a:hover {
		transform: scale(1.03);
	}

	.suggestions a:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
	}

	.suggestion-primary {
		border-color: color-mix(in srgb, var(--primary) 30%, transparent);
		background: color-mix(in srgb, var(--primary) 8%, transparent);
		color: var(--primary);
	}

	.suggestion-primary:hover {
		border-color: color-mix(in srgb, var(--primary) 60%, transparent);
		background: color-mix(in srgb, var(--primary) 15%, transparent);
	}

	.suggestion-secondary {
		border-color: color-mix(in srgb, var(--foreground) 10%, transparent);
		background: color-mix(in srgb, var(--foreground) 3%, transparent);
		color: var(--secondary-foreground);
	}

	.suggestion-secondary:hover {
		border-color: color-mix(in srgb, var(--primary) 40%, transparent);
		color: var(--primary);
	}

	.suggestions a > span {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			background var(--duration-normal) var(--ease-default);
	}

	.dot-solid {
		background: var(--primary);
	}

	.dot-hollow {
		border: 1.5px solid var(--border-subtle);
		background: transparent;
	}

	.suggestion-secondary:hover .dot-hollow {
		border-color: var(--primary);
		background: var(--primary);
	}

	.terminal-line {
		max-width: 100%;
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.5;
		text-align: center;
		color: var(--secondary-foreground);
	}

	.terminal-command {
		color: var(--primary);
	}

	.terminal-note {
		color: var(--muted-foreground);
	}

	.err {
		max-width: 40rem;
		margin-inline: auto;
		padding: clamp(3rem, 10vw, 6rem) var(--space-page-x);
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
		color: var(--dataviz-status-severe);
	}
	.err-code {
		font-family: var(--font-mono);
		font-size: var(--text-title);
		font-weight: 700;
		color: var(--foreground);
	}
	.err :global([data-slot='section-heading']) {
		max-width: 28ch;
	}
	.err :global(.err-heading .section-heading-text) {
		justify-content: center;
		text-align: center;
	}
	.err-body {
		max-width: 44ch;
		font-size: var(--text-subheading);
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.err-detail {
		max-width: 44ch;
		font-size: var(--text-caption);
		word-break: break-word;
		color: var(--muted-foreground);
		opacity: 0.8;
	}
	.err-home {
		margin-top: 0.5rem;
		padding: 0.5rem 1.25rem;
		display: inline-flex;
		align-items: center;
		border-radius: var(--radius-md);
		background: var(--primary);
		font-family: var(--font-body);
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--primary-foreground);
		text-decoration: none;
		transition: background var(--duration-fast) var(--ease-default);
	}
	.err-home:hover {
		background: var(--primary-hover, var(--primary));
	}
	.err-home:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	@media (min-width: 640px) {
		.error-page-content {
			gap: 1.5rem;
		}
		.error-illustration {
			max-width: 28rem;
		}
		.error-copy {
			gap: 0.75rem;
		}
		.error-copy h1 {
			font-size: 2.25rem;
		}
		.error-copy p {
			font-size: 1.125rem;
		}
		.suggestions a {
			font-size: 1rem;
		}
		.terminal-line {
			font-size: 0.875rem;
		}
	}

	@media (max-width: 399px) {
		.terminal-note {
			display: block;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.suggestions a,
		.suggestions a > span,
		.err-home {
			transition: none;
		}
		.suggestions a:hover {
			transform: none;
		}
	}
</style>

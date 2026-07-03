<!--
  ArticleShell — the vertical article/masthead scaffold (§C2.5, P5.3b).

  The prose-page spine: a kicker overline, a display title with the orange
  terminal dot, a capped lede, a mono meta row, the hazard tape, then a content
  region whose CHROME may be full-bleed but whose PROSE lane is capped. This is
  where `--container-content` survives after P5.3a stripped it from Surface.

  Zone order (vertical):
    kicker → title (+ dot) → lede → meta → hazard tape → content

  Consumers (P5.3c, NOT wired here): /metrics masthead + prose blocks, /status
  preamble, any future article.

  Prose lane law: the lede and the content's `.article-prose` wrapper cap at
  `min(--container-content, 72ch)` (the §6 article measure); the content region
  itself is full width so a consumer can drop a full-bleed board inside it and
  wrap the reading copy in `.article-prose` to re-enter the lane.

  a11y: the title is a real heading via SectionHeading (level defaults to 1 — a
  masthead is the page title); pass `headingId` to wire an `aria-labelledby`.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { Separator } from '$lib/components/ui/separator';

	export interface ArticleShellProps {
		/** Display title text (rendered as a real heading + orange dot). */
		title: string;
		/** Heading level for the title. Default 1 (masthead = page title). */
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		/** Id on the heading wrapper (for a section's `aria-labelledby`). */
		headingId?: string;
		/** Mono kicker overline above the title (e.g. "METRICS · REFERENCE"). */
		kicker?: string;
		/** Lede paragraph (capped to the prose lane). */
		lede?: string;
		/** Mono meta row snippet (micro type; e.g. provider · generated_utc). */
		meta?: Snippet;
		/** Show the hazard tape below the head. Default true. */
		tape?: boolean;
		/** Content region (full-bleed chrome allowed; wrap copy in `.article-prose`). */
		children?: Snippet;
		class?: string;
	}

	let {
		title,
		level = 1,
		headingId,
		kicker,
		lede,
		meta,
		tape = true,
		children,
		class: className,
	}: ArticleShellProps = $props();
</script>

<article data-slot="article-shell" class={cn('article-shell', className)}>
	<header class="article-head">
		{#if kicker}
			<span class="article-kicker">{kicker}</span>
		{/if}
		<SectionHeading heading={title} {level} id={headingId} dot />
		{#if lede}
			<p class="article-lede">{lede}</p>
		{/if}
		{#if meta}
			<div class="article-meta" data-slot="article-meta">{@render meta()}</div>
		{/if}
	</header>

	{#if tape}
		<Separator variant="hazard" hazardSize="sm" maxWidth="100%" class="article-tape" />
	{/if}

	{#if children}
		<div class="article-content" data-slot="article-content">{@render children()}</div>
	{/if}
</article>

<style>
	.article-shell {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.article-head {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.article-kicker {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent);
	}
	/* The lede rides the prose lane — capped to the article measure (§6). */
	.article-lede {
		max-width: min(var(--container-content), 72ch);
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-body);
		line-height: 1.9;
	}
	@media (min-width: 1024px) {
		.article-lede {
			font-size: 1.125rem; /* 18px — the desktop article body measure */
		}
	}
	.article-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	/* Full-width region — chrome may bleed edge to edge; reading copy re-enters
	   the lane via `.article-prose`. */
	.article-content {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.article-content :global(.article-prose) {
		max-width: min(var(--container-content), 72ch);
	}
</style>

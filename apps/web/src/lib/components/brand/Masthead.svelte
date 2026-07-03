<!--
  Masthead — the ONE surface header family (§C2, P5.4a).

  Merges the two competing head systems (surface/SurfaceHeader + layout/ArticleShell)
  into a single, promotion-ready masthead. Every non-metrics/status surface composes
  this so the head reads identically across the app, closed by the mandatory hazard
  tape that already ends the yesid detail heads.

  Zone order (vertical):
    [cornerMeta] → kicker/overline → display title (+ orange dot) → lede →
    [meta row] → [children] → hazard tape

  • KICKER — a mono station-voice overline (SectionLabel `variant="station"`: the
    yellow wayfinding accent, --tracking-eyebrow). This is the brand overline the
    surface heads carry.
  • TITLE — a REAL heading via SectionHeading (level defaults to 1 — a masthead is
    the page title) with the brand orange dot. Exactly ONE h1 + one dot per page.
  • LEDE — a muted framing sentence, capped to the ~52ch reading measure.
  • META — an optional mono-micro row (provider · window · generated_utc slots) — the
    zone ArticleShell owned; the caller drops a fully-composed snippet (e.g. a
    FreshnessStamp).
  • CHILDREN — an optional region between the meta row and the tape (e.g. a control
    rail, a hero pulse panel). Full-width; the caller owns its measure.
  • TAPE — the closing edge-to-edge hazard Separator (default on) — the tape rhythm
    that ends every yesid detail head.

  Promotion-ready: token-driven, app-agnostic, no app conditionals. Brand primitives
  only (SectionLabel + SectionHeading + Separator). Tokens, no hex. `--primary` is a
  brand flourish on the dot only; the kicker rides `--accent`.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import SectionLabel from './SectionLabel.svelte';
	import SectionHeading from './SectionHeading.svelte';
	import { Separator } from '$lib/components/ui/separator';

	export interface MastheadProps {
		/** Mono station-voice overline (e.g. "NETWORK · LIVE"). */
		kicker: string;
		/** The display title text (rendered as a real heading + orange dot). */
		heading: string;
		/** Optional mono subheading under the title (e.g. "// MESURE"). */
		subheading?: string;
		/** Optional lede paragraph (muted, ~52ch reading measure). */
		lede?: string;
		/** Heading level (1–6). Default 1 — a masthead is the page title. */
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		/** Id on the heading wrapper (for a section's `aria-labelledby`). */
		headingId?: string;
		/** Optional inline explainer (i) affordance rendered after the title (§C2.7). */
		explainer?: Snippet;
		/**
		 * Optional blueprint-margin corner readouts pinned to the (relative) head.
		 * The caller drops a fully-composed <CornerMeta> here (A4, REAL data only);
		 * omitted ⇒ no corner annotations.
		 */
		cornerMeta?: Snippet;
		/**
		 * Optional mono meta row under the lede — provider · window · generated_utc
		 * chips (the caller drops a fully-composed snippet, e.g. a FreshnessStamp).
		 * Omitted ⇒ no meta row.
		 */
		meta?: Snippet;
		/**
		 * Optional region between the meta row and the tape — a control rail, a hero
		 * pulse panel, etc. Full-width; the caller owns its measure. Omitted ⇒ nothing.
		 */
		children?: Snippet;
		/** Show the closing hazard tape below the head. Default true. */
		tape?: boolean;
		/** Optional extra classes on the header root. */
		class?: string;
	}

	let {
		kicker,
		heading,
		subheading,
		lede,
		level = 1,
		headingId,
		explainer,
		cornerMeta,
		meta,
		children,
		tape = true,
		class: className,
	}: MastheadProps = $props();
</script>

<div class={cn('masthead', className)} data-slot="masthead">
	<header class="masthead-head" class:masthead-head--cornered={cornerMeta}>
		{#if cornerMeta}
			{@render cornerMeta()}
		{/if}
		<SectionLabel text={kicker} variant="station" />
		<SectionHeading {heading} {subheading} {level} id={headingId} dot {explainer} />
		{#if lede}
			<p class="masthead-lede">{lede}</p>
		{/if}
		{#if meta}
			<div class="masthead-meta" data-slot="masthead-meta">{@render meta()}</div>
		{/if}
	</header>

	{#if children}
		<div class="masthead-body" data-slot="masthead-body">{@render children()}</div>
	{/if}

	{#if tape}
		<Separator variant="hazard" maxWidth="100%" class="masthead-tape" />
	{/if}
</div>

<style>
	.masthead {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.masthead-head {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* A4: when the head carries CornerMeta it becomes the relative host for the four
	   corner readouts; a top+bottom band (only where the corners surface, ≥768px)
	   keeps them clear of the content flow. */
	.masthead-head--cornered {
		position: relative;
	}
	@media (min-width: 768px) {
		.masthead-head--cornered {
			padding-block: 1.75rem;
		}
	}
	/* The framing sentence — muted, subheading-scale, ~52ch measure (the SurfaceHeader
	   lede measure, so every surface head reads identically). */
	.masthead-lede {
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
		max-width: 52ch;
	}
	/* Mono-micro meta row — provider · window · generated_utc chips below the lede. */
	.masthead-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	/* Full-width region between the meta row and the tape (control rail / hero pulse). */
	.masthead-body {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
</style>

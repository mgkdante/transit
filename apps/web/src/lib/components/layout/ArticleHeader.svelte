<!--
  ArticleHeader — the yesid.dev magazine-cover article-header grammar, ported
  source-aligned for Transit (P5-R R3a.2). BlogDetailHeader is the visual source;
  Transit keeps its explicit overrides: no vertical edge titles and no text glow.
  Both transit articles (/metrics, /status) render this as their DetailShell band.

  The layer stack, in yesid's exact render order and values:
	    1. the band: --manifesto ground, overflow hidden, crosshair cursor, and the
	       source padding paired with Transit-local pull-up geometry. Transit adds
	       one --chrome-offset at the document shell and the cover adds another as
	       source padding, so -2 offsets make the cover section start at viewport y=0.
    2. the circuit grid — the shared .detail-header-grid class, accented via
       --header-accent.
    3. ManifestoCanvas — the cursor-proximity circuit-node field (glow, traces,
       click ripples; static under reduced motion).
    4. decorations: CornerMarks, the three top-right chevrons, and the giant
       ghost WATERMARK. Transit deliberately has no vertical edge titles.
    5. content column (centered): back link (boop hover) → category ruled line
       → display TITLE with the first-keyword highlight → keyword TAG PILLS →
       dot-separated META row → the controls row (QuietModeButton etc. via the
       `controls` snippet).

  Other Transit adaptations: copy arrives as props (no CMS), the accent defaults
  to --primary, and EN/FR strings are resolved by the caller.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { boop } from '@yesid/motion';
	import { CornerMarks } from '$lib/components/brand';
	import ManifestoCanvas from '$lib/components/brand/ManifestoCanvas.svelte';

	export interface ArticleHeaderProps {
		/** The giant ghost word behind the cover (locale-resolved by the caller). */
		watermark: string;
		/** The category line between the 40px rules (mono, uppercase). */
		category: string;
		/** The display title (h1). Uppercased by CSS; carries NO trailing dot —
		 *  the yesid article-title grammar. */
		title: string;
		/** Keyword pills. The first tag is the title-highlight keyword, matching
		 *  yesid's article contract exactly. */
		tags: readonly string[];
		/** aria-label for the static keyword list. */
		tagsAria: string;
		/** Back link (the article's ONE up-nav — back-link-only law). */
		backHref: string;
		backLabel: string;
		/** Dot-separated meta row entries. Dated entries render as semantic time. */
		meta: readonly ArticleMetaEntry[];
		/** Accent color for the whole cover. Default: the brand primary. */
		accent?: string;
		/** The controls row under the meta (QuietModeButton + page controls). */
		controls?: Snippet;
		/** id for the h1 (aria-labelledby wiring). */
		titleId?: string;
	}

	export type ArticleMetaEntry = string | { readonly text: string; readonly datetime?: string };

	let {
		watermark,
		category,
		title,
		tags,
		tagsAria,
		backHref,
		backLabel,
		meta,
		accent = 'var(--primary)',
		controls,
		titleId,
	}: ArticleHeaderProps = $props();

	let headerEl = $state<HTMLElement>(undefined!);

	// yesid highlights tags[0] only. If that keyword is absent, the title renders
	// whole; later pills never silently become the highlight contract.
	const titleParts = $derived.by(() => {
		const keyword = tags[0];
		if (!keyword) return [{ text: title, highlight: false }];
		const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
		const match = title.match(regex);
		if (!match || match.index === undefined) return [{ text: title, highlight: false }];

		const parts: { text: string; highlight: boolean }[] = [];
		if (match.index > 0) parts.push({ text: title.slice(0, match.index), highlight: false });
		parts.push({ text: match[1], highlight: true });
		const after = title.slice(match.index + match[1].length);
		if (after) parts.push({ text: after, highlight: false });
		return parts;
	});
</script>

<div
	bind:this={headerEl}
	class="article-header"
	style="--article-accent: {accent};"
	data-slot="article-header"
>
	<div class="header__circuit-grid detail-header-grid" aria-hidden="true"></div>
	<ManifestoCanvas containerEl={headerEl} />

	<section class="header-section w-full">
		<!-- Background decorations (absolute layer behind content) -->
		<div class="absolute inset-0 pointer-events-none overflow-hidden">
			<CornerMarks size="md" opacity={0.12} />

			<!-- Chevrons (top-right, desktop only) -->
			<div
				class="header__decoration absolute right-[55px] top-[70px] hidden items-center gap-1.5 lg:flex"
				aria-hidden="true"
			>
				{#each Array(3) as _, i (i)}
					<div
						class="h-3.5 w-3.5 rotate-[-45deg] border-b-2 border-r-2"
						style="border-color: var(--article-accent);"
					></div>
				{/each}
			</div>

			<!-- Watermark -->
			<div class="header__watermark" aria-hidden="true">
				{watermark}
			</div>
		</div>

		<div class="header__content">
			<!-- Back link — the article's one up-nav -->
			<a href={backHref} class="header__back" use:boop={{ scale: 1.05, timing: 200 }}>
				{backLabel}
			</a>

			<!-- Category line with ruled borders -->
			<div class="header__cat-line">
				{category}
			</div>

			<!-- Display title with the keyword highlight -->
			<h1 class="header__title" id={titleId}>
				{#each titleParts as part, i (i)}
					{#if part.highlight}<span class="header__title-highlight">{part.text}</span
						>{:else}{part.text}{/if}
				{/each}
			</h1>

			<!-- Static keyword pills: a labelled list, not a navigation landmark. -->
			<ul class="header__tags" aria-label={tagsAria}>
				{#each tags as tag (tag)}
					<li class="header__pill">{tag}</li>
				{/each}
			</ul>

			<!-- Meta row -->
			<div class="header__meta">
				{#each meta as entry, i (i)}
					{#if i > 0}<span class="header__meta-sep" aria-hidden="true"></span>{/if}
					{#if typeof entry === 'string'}
						<span>{entry}</span>
					{:else if entry.datetime}
						<time datetime={entry.datetime}>{entry.text}</time>
					{:else}
						<span>{entry.text}</span>
					{/if}
				{/each}
			</div>

			{#if controls}
				<div class="header__controls">
					{@render controls()}
				</div>
			{/if}
		</div>
	</section>
</div>

<style>
	/* ── Container — extends behind the floating nav ─────────────
	   yesid uses -nav-clearance/+nav-clearance. Transit starts one offset lower
	   because the root layout already pads non-full-bleed pages by --chrome-offset.
	   Pull up TWO offsets here: one cancels that document pad and one cancels this
	   cover's preserved source padding, placing .header-section at viewport y=0. */
	.article-header {
		position: relative;
		--header-accent: var(--article-accent);
		margin-top: calc(-2 * var(--chrome-offset));
		padding-top: var(--chrome-offset);
		overflow: hidden;
		background: var(--manifesto);
		cursor: crosshair;
	}

	.header-section {
		position: relative;
		display: grid;
		align-items: center;
		min-height: 380px;
	}
	@media (min-width: 1024px) {
		.header-section {
			min-height: 440px;
		}
	}

	/* ── BG Layer 1: Circuit Grid (shared .detail-header-grid, app.css) ── */
	.header__circuit-grid {
		position: absolute;
		inset: 0;
		z-index: var(--z-base);
	}

	/* ── Watermark ─────────────────────────────────────────────── */
	.header__watermark {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: clamp(100px, 14vw, 180px);
		font-weight: 900;
		/* contrast-exempt: decorative (aria-hidden watermark) */
		color: color-mix(in srgb, var(--article-accent) 2.5%, transparent);
		text-transform: uppercase;
		letter-spacing: -0.06em;
		pointer-events: none;
		white-space: nowrap;
		z-index: var(--z-base);
	}

	.header__decoration {
		z-index: calc(var(--z-content) + 1);
	}

	/* ── Center Content ────────────────────────────────────────── */
	.header__content {
		position: relative;
		z-index: calc(var(--z-content) + 9);
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		width: 100%;
		margin-inline: auto;
		/* Top padding clears the fixed floating nav: the wrapper's negative-
		   margin trick extends the BACKGROUND up under the nav; the content
		   still needs its own clearance or the back link hides beneath it. */
		padding: 4.5rem 1.25rem 2.5rem;
	}
	@media (min-width: 1024px) {
		.header__content {
			padding: 5.5rem 2rem 3.75rem;
		}
	}

	/* ── Back link ─────────────────────────────────────────────── */
	.header__back {
		display: inline-block;
		margin-bottom: 1.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-back-link, var(--text-small));
		letter-spacing: 0;
		color: var(--article-accent);
		text-decoration: none;
		opacity: 0.7;
		transition: opacity var(--duration-normal) ease;
	}
	.header__back:hover {
		opacity: 1;
	}
	@media (min-width: 1024px) {
		.header__back {
			margin-bottom: 1.75rem;
		}
	}

	.header__controls {
		margin-top: 1.25rem;
		display: inline-flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	/* ── Category line with ruled borders ──────────────────────── */
	.header__cat-line {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-bottom: 1.25rem;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 3px;
		text-transform: uppercase;
		color: var(--article-accent);
		max-width: calc(100% - 2rem);
	}
	.header__cat-line::before,
	.header__cat-line::after {
		content: '';
		width: 40px;
		height: 1px;
		background: color-mix(in srgb, var(--article-accent) 30%, transparent);
	}
	@media (min-width: 1024px) {
		.header__cat-line {
			margin-bottom: 1.5rem;
		}
	}
	@media (max-width: 390px) {
		.header__cat-line {
			gap: 0.5rem;
			font-size: 9px;
			letter-spacing: 1.5px;
			line-height: 1.4;
		}
		.header__cat-line::before,
		.header__cat-line::after {
			width: 20px;
		}
	}

	/* ── Title ─────────────────────────────────────────────────── */
	.header__title {
		font-family: var(--font-heading);
		font-size: clamp(28px, 6vw, 56px);
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: -0.04em;
		line-height: 0.95;
		color: var(--foreground);
		margin-bottom: 1.25rem;
	}
	.header__title-highlight {
		color: var(--article-accent);
	}
	/* ── Tag pills ─────────────────────────────────────────────── */
	.header__tags {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		margin-top: 0;
		margin-bottom: 1.25rem;
		padding: 0;
		list-style: none;
	}
	@media (min-width: 1024px) {
		.header__tags {
			gap: 8px;
		}
	}
	.header__pill {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.04em;
		color: color-mix(in srgb, var(--article-accent) 85%, transparent);
		border: 1px solid color-mix(in srgb, var(--article-accent) 12%, transparent);
		border-radius: var(--radius-pill);
		padding: 4px 12px;
		background: color-mix(in srgb, var(--article-accent) 3%, transparent);
	}
	@media (min-width: 1024px) {
		.header__pill {
			font-size: var(--text-caption);
			color: color-mix(in srgb, var(--article-accent) 90%, transparent);
			border-color: color-mix(in srgb, var(--article-accent) 15%, transparent);
			padding: 7px 18px;
			background: color-mix(in srgb, var(--article-accent) 4%, transparent);
		}
	}

	/* ── Meta row ──────────────────────────────────────────────── */
	.header__meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		font-family: var(--font-mono);
		font-size: 11px;
		color: color-mix(in srgb, var(--article-accent) 85%, transparent);
	}
	.header__meta-sep {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--article-accent);
		opacity: 0.4;
	}

	/* ── Ripple keyframes (for ManifestoCanvas taps) ───────────── */
	:global(.manifesto__ripple) {
		position: absolute;
		border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: calc(var(--z-content) + 3);
		animation: ripple-expand 1.2s ease-out forwards;
	}
	:global(.manifesto__ripple-inner) {
		position: absolute;
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: calc(var(--z-content) + 3);
		animation: ripple-inner 0.8s ease-out forwards;
	}
	@keyframes ripple-expand {
		0% {
			width: 0;
			height: 0;
			opacity: 0.6;
		}
		100% {
			width: 200px;
			height: 200px;
			opacity: 0;
		}
	}
	@keyframes ripple-inner {
		0% {
			width: 0;
			height: 0;
			opacity: 0.8;
		}
		100% {
			width: 100px;
			height: 100px;
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.header__back {
			transition: none;
		}
		:global(.manifesto__ripple),
		:global(.manifesto__ripple-inner) {
			animation: none;
			display: none;
		}
	}
</style>

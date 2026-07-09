<!--
  SectionHeading — the canonical section/page title renderer (SectionHeading LAW,
  §C2.7, P5.3b). It ALWAYS renders a real `<h1>`…`<h6>` (level prop, default 2) so
  every surface earns a real h1→h2(→h3) outline (kills the flat-outline defect on
  the 8 span-titled surfaces; axe heading-order clean).

  Two visual modes, one element:

  • DISPLAY mode (existing, unchanged): pass `heading` for a display-scale title
    (+ optional `subheading` mono overline below, + the brand orange `dot`). This
    is the page/surface head used by Masthead, the hub, RouteDetail.

  • OVERLINE mode (new): pass `overline` for the mono-uppercase station-voice
    label look — the demoted SectionLabel, now wrapped in a real heading. This is
    the DROP-IN for the old `<SectionLabel id=… text=… variant="station" />`
    section-title usage: the visible overline look is IDENTICAL, but the element
    is a real hN and `aria-labelledby` still resolves (pass the same `id`; it
    lands on the wrapper the label points to, exactly as before).

  Both modes accept:
    • `number`   → a leading NumberedChip (D4 `01`/`02`); wayfinding, decorative.
    • `explainer`→ an (i)/help snippet rendered inline after the title (the §C2.7
      optional explainer slot, e.g. a MetricInfo popover).

  The trailing `dot` (display mode) is a brand FLOURISH (orange = --primary, the
  interactive accent), not a data mark — doctrine-clean.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import NumberedChip from './NumberedChip.svelte';

	export interface SectionHeadingProps extends HTMLAttributes<HTMLDivElement> {
		/** DISPLAY-mode heading text (display-scale title). */
		heading?: string;
		/** Optional mono subheading below a DISPLAY heading (e.g. "// MESURE"). */
		subheading?: string;
		/**
		 * OVERLINE-mode text — the mono-uppercase station-voice label, wrapped in a
		 * real heading. The drop-in for the old SectionLabel section-title span.
		 * When set (and `heading` is not), the heading renders in overline style.
		 */
		overline?: string;
		/** Heading level (1–6). Default 2 for sections; use 1 for page titles. */
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		/**
		 * Show the brand orange dot after a DISPLAY heading. Default true (the
		 * historical display-mode behaviour); ignored in overline mode.
		 */
		dot?: boolean;
		/** Optional leading numbered chip (D4) — section index, e.g. 3 → "03". */
		number?: number;
		/** Active tone for the numbered chip (matches the ToC active mark). */
		numberTone?: 'rest' | 'active';
		/** Optional inline explainer affordance (the (i) slot, §C2.7). */
		explainer?: Snippet;
		/**
		 * Optional SECOND display line rendered in --primary under `heading` (the
		 * yesid two-line thesis grammar — "SYSTEMS THAT / DON'T BREAK."). The dot
		 * terminates the accent line. Display mode only.
		 */
		headingAccent?: string;
		class?: string;
	}

	let {
		heading,
		subheading,
		overline,
		level = 2,
		dot = true,
		number,
		numberTone = 'rest',
		explainer,
		headingAccent,
		class: className,
		...restProps
	}: SectionHeadingProps = $props();

	const tag = $derived(`h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
	// Overline mode when there is an overline and no display heading.
	const isOverline = $derived(overline != null && heading == null);
	// The visible title text of whichever mode is active.
	const titleText = $derived(isOverline ? (overline ?? '') : (heading ?? ''));

	// DOT LAW (operator): the dot sits beside the last LETTER, always. The global
	// no-overflow guarantee (`body { overflow-wrap: anywhere }`) creates a break
	// opportunity between the final word and the dot span, so a tight line can
	// orphan the dot onto its own row. Splitting the text and gluing
	// [last word + dot] inside one white-space:nowrap span removes that break
	// point at the only seam that matters, on every dotted heading.
	function splitTail(text: string): { head: string; tail: string } {
		const m = /^([\s\S]*\s)(\S+)$/.exec(text);
		return m ? { head: m[1], tail: m[2] } : { head: '', tail: text };
	}
	const titleParts = $derived(splitTail(titleText));
	const accentParts = $derived(splitTail(headingAccent ?? ''));
</script>

<div
	data-slot="section-heading"
	data-mode={isOverline ? 'overline' : 'display'}
	class={cn('section-heading', className)}
	{...restProps}
>
	<svelte:element
		this={tag}
		class={isOverline ? 'section-heading-overline' : 'section-heading-text'}
	>
		{#if number != null}<NumberedChip
				value={number}
				tone={numberTone}
				class="section-heading-chip"
			/>{/if}<span class="section-heading-title"
			>{#if headingAccent && !isOverline}{titleText}<span
					data-slot="section-heading-accent"
					class="section-heading-accent"
					>{accentParts.head}<span class="section-heading-tail"
						>{accentParts.tail}{#if dot}<span
								data-slot="section-heading-dot"
								class="section-heading-dot"
								aria-hidden="true">.</span
							>{/if}</span
					></span
				>{:else if dot && !isOverline}{titleParts.head}<span class="section-heading-tail"
					>{titleParts.tail}<span
						data-slot="section-heading-dot"
						class="section-heading-dot"
						aria-hidden="true">.</span
					></span
				>{:else}{titleText}{/if}</span
		>{#if explainer}<span class="section-heading-explainer">{@render explainer()}</span>{/if}
	</svelte:element>
	{#if subheading && !isOverline}
		<p data-slot="section-heading-sub" class="section-heading-sub">{subheading}</p>
	{/if}
</div>

<style>
	/* ── DISPLAY mode (page/surface titles) — unchanged look ──────────────────── */
	.section-heading-text {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-family: var(--font-heading);
		font-size: clamp(2.5rem, 6vw, 4rem);
		font-weight: 900;
		color: var(--foreground);
		letter-spacing: -2px;
		margin-block-end: 6px;
	}
	/* Brand flourish — the interactive-accent orange (doctrine: not a data mark). */
	.section-heading-dot {
		color: var(--primary);
	}
	/* [last word + dot] glued: no break opportunity between them, so the global
	   overflow-wrap:anywhere can never orphan the dot onto its own line. */
	.section-heading-tail {
		white-space: nowrap;
	}
	/* The two-line thesis accent (yesid HeroTextContent grammar): line 2 breaks onto
	   its own row in --primary and CARRIES the dot inline (the dot must never wrap
	   onto a lone line). The dot inherits its own --primary rule. */
	.section-heading-accent {
		display: block;
		color: var(--primary);
	}
	.section-heading-sub {
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		color: var(--muted-foreground);
		letter-spacing: 2px;
		text-transform: uppercase;
		margin-block-end: 36px;
	}

	/* ── OVERLINE mode (section titles) — the demoted SectionLabel/station look ── */
	.section-heading-overline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-family: var(--font-mono);
		/* Station-voice overline: the yellow wayfinding accent, mono-caps. */
		font-size: var(--text-mono);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent);
		line-height: 1.2;
	}

	/* Shared bits — the title span + chip + explainer sit inline in either mode. */
	.section-heading :global(.section-heading-chip) {
		align-self: center;
	}
	.section-heading-title {
		min-width: 0;
	}
	.section-heading-explainer {
		display: inline-flex;
		align-items: center;
		align-self: center;
	}
</style>

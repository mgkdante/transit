<!--
  DetailShell — the ONE detail-page system (P5.4c). Replaces DetailTemplate (deleted).

  A faithful port of the yesid projects/[slug] + blog/[slug] detail architecture into
  a single reusable shell that BOTH transit detail surfaces (/metrics + /status) consume,
  so the header→hazard→3-col-grid→ToC rhythm is drawn ONCE, not hand-inlined per feature.

  What the shell OWNS (the layout + wiring the features used to duplicate):
    · a full-bleed ARTICLE HEADER band carrying the global `.detail-header-grid` dot-grid
      schematic (--manifesto ground) — the caller drops its Masthead + CornerMeta inside
      via the `header` snippet (pass the Masthead `tape={false}`; the shell adds the tape);
    · the edge-to-edge closing `<Separator variant="hazard">` under the header;
    · the 3-column body grid — `1fr 2fr 1fr` at ≥1024 (yesid's breakpoint, gap 2rem),
      collapsing to a single column below. Left rail (ToC) + right rail (stat cards) are
      sticky at `top: var(--chrome-offset)` (the single P5.3a offset knob). When no `right`
      snippet is given the grid is 2-column (`1fr 3fr`);
    · the mobile order: below 1024 the side rails are hidden, the right-rail stats reflow
      to a top `mobileSummary` strip, and the ToC becomes the floating `TocPill`;
    · ONE IntersectionObserver (`observeActiveToc` over `[data-toc]`/`[data-section-index]`)
      that owns `activeId` (exposed `$bindable` so the caller's left-rail TocNav +
      reading-position readout stay in lock-step, and any locale-scroll-restore can read it);
    · the floating `TocPill` (given the caller's toc entries + navigate + aria).

  What the CALLER owns: the header CONTENT (Masthead + CornerMeta), the ToC entries +
  `onNavigate` (scroll behavior can carry surface-specific nuance), the left-rail content
  (TocNav + reading-position readout + context), the center sections, and the right-rail
  stat cards. The shell is layout + observer + pill; the feature is content.

  Promotion-ready: token-driven, app-agnostic, no app conditionals. Brand/shared primitives
  only (Separator + TocPill + toc.ts). The `.detail-header-grid` dot pattern lives in
  app.css (single source of truth); a caller may recolour it per-surface via `--header-accent`.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { cn } from '$lib/utils';
	import { Separator } from '$lib/components/ui/separator';
	import TocPill from '$lib/components/shared/TocPill.svelte';
	import { observeActiveToc, type TocEntry } from '$lib/components/shared/toc';

	export interface DetailShellProps {
		/** The header content — the caller's Masthead + CornerMeta. Rendered inside the
		    full-bleed `.detail-header-grid` band. Pass the Masthead `tape={false}` — the
		    shell adds the closing hazard tape after the band. */
		header: Snippet;
		/** Left rail — ToC / reading-position readout / context (sticky, ≥1024). */
		left: Snippet;
		/** Center column — the numbered sections (the 2fr / 3fr track). */
		center: Snippet;
		/** Right rail — stat cards (sticky, ≥1024). Omit ⇒ a 2-column grid. */
		right?: Snippet;
		/** Mobile-only top summary strip — the right-rail stats reflowed above the sections
		    (< 1024, where the right rail is hidden). Omit ⇒ nothing above the sections. */
		mobileSummary?: Snippet;
		/** ToC entries for the floating mobile pill (the shell owns the pill). */
		tocEntries: TocEntry[];
		/** Optional distinct mobile-order entries for the pill. Default = `tocEntries`. */
		mobileTocEntries?: TocEntry[];
		/**
		 * The active ToC id. `$bindable` — the shell owns the single IntersectionObserver
		 * and writes this as the reader scrolls; the caller binds it so its left-rail
		 * TocNav + reading-position readout follow, and drives it back if needed.
		 */
		activeId?: string;
		/** Scroll-to-section handler for the pill (and the caller's TocNav reuse it). */
		onNavigate: (id: string) => void;
		/** aria-label for the pill's open control ("Table of contents"). */
		tocOpenAria: string;
		/** aria-label for the pill's close control. */
		tocCloseAria: string;
		/** Optional conversion band region below the sections (yesid CtaBand analog).
		    Unused on transit's metrics/status; kept for promotion parity. */
		cta?: Snippet;
		/** Extra classes on the shell root article. */
		class?: string;
	}

	let {
		header,
		left,
		center,
		right,
		mobileSummary,
		tocEntries,
		mobileTocEntries,
		activeId = $bindable(''),
		onNavigate,
		tocOpenAria,
		tocCloseAria,
		cta,
		class: className,
	}: DetailShellProps = $props();

	// ONE observer drives BOTH the caller's desktop TocNav (via the bound activeId) and
	// the shell's mobile TocPill — no duplicate observers. Targets `[data-toc]` +
	// `[data-section-index]` (toc.ts). Re-scoped only on mount; sections are stable.
	onMount(() => observeActiveToc((id) => (activeId = id)));

	const pillEntries = $derived(mobileTocEntries ?? tocEntries);
</script>

<article data-slot="detail-shell" class={cn('detail-shell', className)}>
	<!-- Full-bleed header band: the global dot-grid schematic over the --manifesto ground;
	     the caller's Masthead + CornerMeta ride the centered inner. Closed by the hazard
	     tape below (edge-to-edge), the yesid detail-head rhythm. -->
	<div class="detail-shell-header detail-header-grid" data-slot="detail-shell-header">
		<div class="detail-shell-header__inner">
			{@render header()}
		</div>
	</div>

	<Separator variant="hazard" maxWidth="100%" class="detail-shell-tape" />

	<!-- Mobile top summary strip — the right-rail stats reflowed above the sections
	     (hidden ≥1024, where the sticky right rail carries them). -->
	{#if mobileSummary}
		<div class="detail-shell-mobile-summary" data-slot="detail-shell-mobile-summary">
			{@render mobileSummary()}
		</div>
	{/if}

	<div class="detail-shell-grid" class:detail-shell-grid--two={!right}>
		<aside class="detail-shell-rail detail-shell-rail--left" data-slot="detail-shell-left">
			{@render left()}
		</aside>

		<div class="detail-shell-center" data-slot="detail-shell-center">
			{@render center()}
		</div>

		{#if right}
			<aside class="detail-shell-rail detail-shell-rail--right" data-slot="detail-shell-right">
				{@render right()}
			</aside>
		{/if}
	</div>

	{#if cta}
		<div class="detail-shell-cta" data-slot="detail-shell-cta">{@render cta()}</div>
	{/if}
</article>

<!-- Floating mobile ToC pill (hides itself ≥1024 via its own breakpoint, so the sticky
     left rail takes over seamlessly at the SAME 1024 boundary the rails appear at). -->
{#if pillEntries.length > 0}
	<TocPill
		entries={pillEntries}
		{activeId}
		openAria={tocOpenAria}
		closeAria={tocCloseAria}
		{onNavigate}
	/>
{/if}

<style>
	.detail-shell {
		display: block;
	}

	/* Full-bleed header band: --manifesto ground + the global .detail-header-grid dot
	   pattern (position:relative + overflow:hidden anchor + clip the ::after solder dots).
	   Full width; the inner re-caps to the content measure and centres. */
	.detail-shell-header {
		position: relative;
		overflow: hidden;
		padding-block: clamp(1.75rem, 4vw, 3rem);
		padding-inline: var(--space-page-x);
		background: var(--manifesto);
	}
	.detail-shell-header__inner {
		position: relative;
		z-index: 1;
		max-width: var(--container-content);
		margin-inline: auto;
	}

	/* The mobile summary strip is a single-column band above the sections; the desktop
	   rails collapse into the flow below 1024. */
	.detail-shell-mobile-summary {
		display: block;
		padding-inline: var(--space-page-x);
		margin-block-start: 1.5rem;
	}

	/* Body: single column < 1024; the yesid 3-column detail grid ≥1024. Full-bleed
	   (gutter padding, no max-width cap) — the edge-to-edge detail rhythm; the center
	   caps its own prose measure. */
	.detail-shell-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-card-gap);
		padding-inline: var(--space-page-x);
		padding-block: 1.5rem;
	}

	/* The center column never overflows its track (long tables / <pre> scroll inside). */
	.detail-shell-center {
		min-width: 0;
	}

	/* Rails hidden below 1024 — the TocPill (left) + mobileSummary (right) stand in. */
	.detail-shell-rail {
		display: none;
	}

	@media (min-width: 1024px) {
		.detail-shell-grid {
			grid-template-columns: 1fr 2fr 1fr;
			gap: 2rem;
			padding-block: 2.5rem;
		}
		/* 2-column when there is no right rail (e.g. a detail page without stat cards). */
		.detail-shell-grid--two {
			grid-template-columns: 1fr 3fr;
		}
		/* The mobile summary strip is redundant once the sticky right rail is visible. */
		.detail-shell-mobile-summary {
			display: none;
		}
		.detail-shell-rail {
			display: block;
			position: sticky;
			/* The single P5.3a offset knob — never a hardcoded literal. */
			top: var(--chrome-offset);
			align-self: start;
			max-height: calc(100dvh - var(--chrome-offset));
			overflow-y: auto;
		}
	}

	.detail-shell-cta {
		margin-block-start: 1rem;
	}
</style>

<!--
  DetailShell — the ONE detail-page system (P5.4c). Replaces DetailTemplate (deleted).

  A faithful port of the yesid projects/[slug] + blog/[slug] detail architecture into
  a single reusable shell that BOTH transit detail surfaces (/metrics + /status) consume,
  so the header→hazard→3-col-grid→ToC rhythm is drawn ONCE, not hand-inlined per feature.

  What the shell OWNS (the layout + wiring the features used to duplicate):
	    · a header region: either a caller-owned complete `articleHeader` cover or the
	      default full-bleed `.detail-header-grid` band around the `header` snippet;
    · the edge-to-edge closing `<Separator variant="hazard">` under the header;
	    · the adaptive body grid: one column below 1024; a wide rail plus readable center
	      from 1024; and three explicit useful tracks from 1440 only when a caller provides
	      distinct right-rail content. Supporting content follows the center at intermediate
	      widths instead of shrinking every column. With neither rail the center is full width;
    · the mobile order: below 1024 the side rails are hidden, the right-rail stats reflow
      to a top `mobileSummary` strip, and the ToC becomes the floating `TocPill`;
    · ONE IntersectionObserver (`observeActiveToc` over `[data-toc]`/`[data-section-index]`)
      that owns `activeId` (exposed `$bindable` so the caller's left-rail TocNav +
      reading-position readout stay in lock-step, and any locale-scroll-restore can read it);
    · the floating `TocPill` (given the caller's toc entries + navigate + aria).

	  What the CALLER owns: the complete article cover or default-band header content, the ToC entries +
  `onNavigate` (scroll behavior can carry surface-specific nuance), the left-rail content
  (TocNav + reading-position readout + context), the center sections, and the right-rail
  stat cards. The shell is layout + observer + pill; the feature is content.

  Promotion-ready: token-driven, app-agnostic, no app conditionals. Brand/shared primitives
	  only (Separator + TocPill + toc.ts). The default band's `.detail-header-grid` pattern
	  lives in app.css; a complete article cover owns its own ground and layers.
-->
<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { Separator } from '$lib/components/ui/separator';
	import TocPill from '$lib/components/shared/TocPill.svelte';
	import { observeActiveToc, type TocEntry } from '$lib/components/shared/toc';
	import SurfaceRail, { type SurfaceRailContext } from '$lib/components/surface/SurfaceRail.svelte';
	import ArticleSummaryLane from './ArticleSummaryLane.svelte';

	export interface DetailShellCombinedRailConfig {
		label: string;
		summary?: string;
		openAria: string;
		closeAria: string;
		class?: string;
	}
	interface DetailShellBaseProps {
		/** The header content — the caller's Masthead + CornerMeta. Rendered inside the
		    full-bleed `.detail-header-grid` band. Pass the Masthead `tape={false}` — the
		    shell adds the closing hazard tape after the band. Omit when passing
		    `articleHeader`. */
		header?: Snippet;
		/**
		 * The ARTICLE HEADER (P5-R R3a.2): a complete band the caller supplies
		 * (the shared ArticleHeader — the yesid magazine-cover port). When given,
		 * it REPLACES the shell's default band entirely (the cover owns its own
		 * ground, grid, canvas and nav-clearance mechanics); the shell still adds
		 * the closing hazard tape and everything below.
		 */
		articleHeader?: Snippet;
		/** Stable full-width control row between the closing hazard strip and body grid. */
		toolbar?: Snippet;
		/** Stable article summary/verdict row. It is always aligned to the canonical
		 * center track and never moves when a pane owns its own rail. */
		summary?: Snippet;
		/** Center column — the numbered sections (the 2fr / 3fr track). */
		center: Snippet;
		/** Right rail — stat cards (sticky, ≥1024). Omit ⇒ a 2-column grid. */
		right?: Snippet;
		/** Mobile-only top summary strip — the right-rail stats reflowed above the sections
		    (< 1024, where the right rail is hidden). Omit ⇒ nothing above the sections. */
		mobileSummary?: Snippet;
		/** ToC entries for the floating mobile pill (the shell owns the pill). */
		tocEntries: TocEntry[];
		/**
		 * The active ToC id. `$bindable` — the shell owns the single IntersectionObserver
		 * and writes this as the reader scrolls; the caller binds it so its left-rail
		 * TocNav + reading-position readout follow, and drives it back if needed.
		 */
		activeId?: string;
		/** Optional conversion band region below the sections (yesid CtaBand analog).
		    Unused on transit's metrics/status; kept for promotion parity. */
		cta?: Snippet;
		/** Extra classes on the shell root article. */
		class?: string;
		/** Keep the legacy left rail in normal document flow below 1024. */
		leftMobile?: boolean;
		/** The active pane owns its own internal rail; keep the outer left content as
		    a full-width toolbar above one unconstrained center track. */
		paneOwnedRail?: boolean;
	}
	type DetailShellLegacyRailProps = {
		/** Left rail — ToC / reading-position readout / context (sticky, ≥1024). */
		left?: Snippet;
		combinedRail?: never;
		combinedRailConfig?: never;
		/** Optional distinct mobile-order entries for the pill. Default = `tocEntries`. */
		mobileTocEntries?: TocEntry[];
		/** Scroll-to-section handler for the pill (and the caller's TocNav reuse it). */
		onNavigate?: (id: string) => void;
		/** aria-label for the pill's open control ("Table of contents"). */
		tocOpenAria?: string;
		/** aria-label for the pill's close control. */
		tocCloseAria?: string;
	};
	type DetailShellCombinedRailProps = {
		left?: never;
		combinedRail: Snippet<[SurfaceRailContext]>;
		combinedRailConfig: DetailShellCombinedRailConfig | undefined;
		mobileTocEntries?: never;
		onNavigate?: never;
		tocOpenAria?: never;
		tocCloseAria?: never;
	};
	export type DetailShellProps = DetailShellBaseProps &
		(DetailShellLegacyRailProps | DetailShellCombinedRailProps);

	let {
		header,
		articleHeader,
		toolbar,
		summary,
		left,
		combinedRail,
		combinedRailConfig,
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
		leftMobile = false,
		paneOwnedRail = false,
		class: className,
	}: DetailShellProps = $props();

	// ONE observer drives BOTH the caller's desktop TocNav (via the bound activeId) and
	// the shell's mobile TocPill — no duplicate observers. Async resources can add or
	// remove targets after mount, so reconnect after the ordered id signature changes
	// and after the corresponding DOM update settles.
	$effect(() => {
		const signature = tocEntries.map((entry) => entry.id).join('|');
		let cancelled = false;
		let stop: (() => void) | undefined;

		void (async () => {
			void signature;
			await tick();
			if (!cancelled) stop = observeActiveToc((id) => (activeId = id));
		})();

		return () => {
			cancelled = true;
			stop?.();
		};
	});

	const pillEntries = $derived(mobileTocEntries ?? tocEntries);
	const rendersLeftRail = $derived(Boolean(left || (combinedRail && combinedRailConfig)));
</script>

<article data-slot="detail-shell" class={cn('detail-shell', className)}>
	<!-- The header band: the caller's ARTICLE COVER when given (it owns its own
	     ground/grid/canvas + nav-clearance), else the default dot-grid band over
	     the --manifesto ground with the caller's Masthead inside. Closed by the
	     hazard tape below (edge-to-edge), the yesid detail-head rhythm. -->
	{#if articleHeader}
		{@render articleHeader()}
	{:else if header}
		<div class="detail-shell-header detail-header-grid" data-slot="detail-shell-header">
			<div class="detail-shell-header__inner">
				{@render header()}
			</div>
		</div>
	{/if}

	<Separator variant="hazard" maxWidth="100%" class="detail-shell-tape" />

	{#if toolbar}
		<div class="detail-shell-toolbar" data-slot="detail-shell-toolbar">
			<div class="detail-shell-toolbar__inner">{@render toolbar()}</div>
		</div>
	{/if}

	<!-- Mobile top summary strip — the right-rail stats reflowed above the sections
	     (hidden ≥1024, where the sticky right rail carries them). -->
	{#if mobileSummary}
		<div class="detail-shell-mobile-summary" data-slot="detail-shell-mobile-summary">
			{@render mobileSummary()}
		</div>
	{/if}

	<div
		class="detail-shell-grid"
		class:detail-shell-grid--three={rendersLeftRail && Boolean(right)}
		class:detail-shell-grid--two={rendersLeftRail && !right}
		class:detail-shell-grid--single={!rendersLeftRail && !right}
		class:detail-shell-grid--pane-owned={paneOwnedRail}
	>
		{#if combinedRail && combinedRailConfig}
			<SurfaceRail
				rail={combinedRail}
				label={combinedRailConfig.label}
				summary={combinedRailConfig.summary}
				openAria={combinedRailConfig.openAria}
				closeAria={combinedRailConfig.closeAria}
				class={combinedRailConfig.class}
			/>
		{:else if left}
			<aside
				class="detail-shell-rail detail-shell-rail--left"
				class:detail-shell-rail--mobile={leftMobile}
				data-slot="detail-shell-left"
			>
				{@render left()}
			</aside>
		{/if}

		<div class="detail-shell-center" data-slot="detail-shell-center">
			{#if summary}
				<ArticleSummaryLane data-slot="detail-shell-summary">
					{@render summary()}
				</ArticleSummaryLane>
			{/if}
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
{#if !combinedRail && pillEntries.length > 0 && onNavigate && tocOpenAria && tocCloseAria}
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
		--detail-rail-width: var(--layout-control-rail-width);
		--detail-support-rail-width: var(--layout-support-rail-width);
		--detail-center-min: var(--layout-article-main-min);
		--detail-center-max: var(--container-content);
		--detail-column-gap: 2rem;
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

	.detail-shell-toolbar {
		width: 100%;
		padding: 0;
		background: var(--primary);
	}
	.detail-shell-toolbar__inner {
		width: 100%;
	}

	/* The mobile summary strip is a single-column band above the sections; the desktop
	   rails collapse into the flow below 1024. */
	.detail-shell-mobile-summary {
		display: block;
		padding-inline: var(--space-page-x);
		margin-block-start: 1.5rem;
	}

	/* Body: single column < 1024; adaptive two/three-column article grid above. Full-bleed
	   (gutter padding, no max-width cap) — the edge-to-edge detail rhythm; the center
	   caps its own prose measure. */
	.detail-shell-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-card-gap);
		padding-inline: var(--space-page-x);
		padding-block: var(--layout-article-top-space);
		min-width: 0;
		overflow-x: clip;
	}

	/* The center column never overflows its track (long tables / <pre> scroll inside). */
	.detail-shell-center {
		min-width: 0;
		width: 100%;
		max-width: var(--detail-center-max);
	}

	/* Rails hidden below 1024 — the TocPill (left) + mobileSummary (right) stand in. */
	.detail-shell-rail {
		display: none;
	}
	.detail-shell-rail--mobile {
		display: block;
		min-width: 0;
	}

	@media (min-width: 1024px) {
		.detail-shell-grid {
			grid-template-columns: var(--detail-rail-width) minmax(0, var(--detail-center-max));
			gap: var(--detail-column-gap);
			padding-block: var(--layout-article-top-space);
			align-items: stretch;
			justify-content: center;
		}
		/* No right rail means two real tracks: the shared rail width plus the shared
		   center cap. Outer whitespace centers the canvas instead of faking a third track. */
		.detail-shell-grid--two {
			grid-template-columns: var(--detail-rail-width) minmax(0, var(--detail-center-max));
			justify-content: center;
		}
		/* One full-width center track when neither rail renders. */
		.detail-shell-grid--single {
			grid-template-columns: minmax(0, 1fr);
		}
		/* Reliability/history panes already own a complete SurfaceRail. Their outer
		   tab rail becomes a toolbar above one full-width track, avoiding nested rails. */
		.detail-shell-grid--pane-owned {
			grid-template-columns: minmax(0, 1fr);
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
		.detail-shell-rail--left {
			grid-column: 1;
			justify-self: stretch;
			width: 100%;
		}
		.detail-shell-grid > :global([data-slot='surface-rail']) {
			grid-column: 1;
			justify-self: stretch;
			width: 100%;
		}
		.detail-shell-center {
			grid-column: 2;
			justify-self: stretch;
			max-width: var(--detail-center-max);
		}
		/* Until the viewport can hold three useful columns, distinct support content
		   follows the main article in its readable track instead of crushing it. */
		.detail-shell-grid--three .detail-shell-rail--right {
			position: static;
			grid-column: 2;
			grid-row: 2;
			justify-self: stretch;
			width: 100%;
			max-height: none;
			overflow: visible;
		}
		.detail-shell-grid--two .detail-shell-rail--left,
		.detail-shell-grid--two > :global([data-slot='surface-rail']) {
			justify-self: stretch;
			width: 100%;
		}
		.detail-shell-grid--two .detail-shell-center {
			justify-self: stretch;
			max-width: var(--detail-center-max);
		}
		.detail-shell-grid--single .detail-shell-center {
			grid-column: 1;
		}
		.detail-shell-grid--pane-owned .detail-shell-rail--left {
			position: static;
			grid-column: 1;
			width: 100%;
			max-height: none;
			overflow: visible;
			justify-self: stretch;
		}
		.detail-shell-grid--pane-owned .detail-shell-center {
			grid-column: 1;
			max-width: none;
			justify-self: stretch;
		}
	}

	@media (min-width: 1440px) {
		.detail-shell-grid--three {
			grid-template-columns:
				var(--detail-rail-width)
				minmax(var(--detail-center-min), var(--detail-center-max))
				var(--detail-support-rail-width);
			justify-content: center;
		}
		.detail-shell-grid--three .detail-shell-rail--right {
			position: sticky;
			grid-column: 3;
			grid-row: 1;
			justify-self: stretch;
			width: 100%;
			max-height: calc(100dvh - var(--chrome-offset));
			overflow-y: auto;
		}
	}

	@media (min-width: 1024px) and (max-width: 1279px) {
		.detail-shell-grid {
			gap: var(--detail-column-gap);
		}
		.detail-shell-rail--left,
		.detail-shell-rail--right,
		.detail-shell-center {
			width: 100%;
			justify-self: stretch;
		}
	}

	.detail-shell-cta {
		margin-block-start: 1rem;
	}
</style>

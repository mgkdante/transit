<!--
  VerticalSectionTitle — the giant rotated section word in the left gutter (D2).

  A single decorative display word, rotated vertical (writing-mode: vertical-rl +
  180° so it reads bottom-to-top on the LEFT edge), pinned in the page's left
  gutter/margin. Restores the yesid listing-page "edge word" ornament that S10
  retired from /metrics — but as a proper LEFT-GUTTER decoration this time, not a
  grid track, so it never steals horizontal space from the content or the rails.

  ≥xl (1280px) ONLY: the word appears where the gutter is wide enough to host it;
  below xl it is display:none (no reflow, no overlap). It rides the page scroll
  via position: sticky under the floating pill (top: var(--chrome-offset)).

  DECORATIVE by contract: aria-hidden + pointer-events:none. The real page
  heading (SurfaceHeader / SectionHeading h1) already carries the accessible page
  identity, so this word adds NO semantic content — it is pure theatre. It is
  localized (D2: «Réseau.» / «Fiabilité.» / «Mesure.» · Network. / Reliability. /
  Measure.) by the caller.

  COLLISION LAW: the outer rail is `position: absolute` spanning the Surface's
  left edge at ZERO width (it contributes no layout box), so the content lane and
  every sticky rail (ToC / ControlsRail live INSIDE the content lane) are
  untouched. The inner word is `position: sticky` and pulled LEFT into the
  `--space-page-x` gutter band via a negative transform, so it visually sits in
  the margin, left of the content, never over a rail. Must be mounted inside a
  `position: relative` Surface.

  GLOW LAW: no text-shadow. The period rides --primary as a static full-stop
  glyph (punctuation, not a data mark); everything else is --muted-foreground at
  a low opacity so it reads as background texture, never a competing heading.
-->
<script lang="ts">
	interface VerticalSectionTitleProps {
		/** The already-localized word (WITHOUT the trailing period — this adds the dot). */
		word: string;
	}
	let { word }: VerticalSectionTitleProps = $props();
</script>

<div class="vst-rail" data-slot="vertical-section-title" aria-hidden="true">
	<span class="vst-word">{word}<span class="vst-dot">.</span></span>
</div>

<style>
	/* Hidden by default (< xl): the rail is absent entirely, so no reflow and no
	   overlap with content or rails on narrow viewports. */
	.vst-rail {
		display: none;
	}

	/* ≥ xl: a zero-width absolute rail spanning the Surface's full height at its
	   LEFT CONTENT-BOX edge (inset-inline-start:0 = right of the app LeftRail,
	   which the <main> padding-left clears). It contributes NO layout box (0 width,
	   absolute), so the content lane and every sticky rail keep their geometry —
	   the word is pure overlay living in the content's own --space-page-x gutter
	   band, never over the LeftRail. */
	@media (min-width: 1280px) {
		.vst-rail {
			display: block;
			position: absolute;
			inset-block: 0;
			inset-inline-start: 0;
			width: 0;
			pointer-events: none;
			/* Behind the content: SOLID cards (the occlusion law) cover the word if
			   they ever reach it; in the gutter band they don't. */
			z-index: 0;
			overflow: visible;
		}

		/* The word pins under the pill and rides the scroll. It sits flush at the
		   content-box left edge, INSIDE the --space-page-x gutter band (right of the
		   LeftRail, left of the text), rotated vertical. Sized to the gutter so it
		   never crosses into the content lane or the rail. */
		.vst-word {
			position: sticky;
			top: var(--chrome-offset);
			display: inline-block;
			writing-mode: vertical-rl;
			transform: rotate(180deg);
			transform-origin: center;
			/* A hair of inset keeps the rotated glyph off the exact content edge. */
			margin-inline-start: 0.15rem;
			margin-block-start: 0.75rem;
			font-family: var(--font-heading);
			/* Sized to the gutter band (~--space-page-x wide): big enough to read as
			   the edge word, capped so it stays clear of the content and the rail and
			   WCAG 1.4.4 resize holds. */
			font-size: clamp(2rem, 2.6vw, 3rem);
			font-weight: 800;
			line-height: 1;
			letter-spacing: var(--tracking-tight);
			/* Background-texture tone — quiet marginalia, never a data mark or a
			   competing heading. */
			color: var(--muted-foreground);
			opacity: 0.28;
			white-space: nowrap;
			user-select: none;
		}

		/* The terminal full-stop — the ONE --primary accent (a static punctuation
		   glyph, not a data mark; matches the display-head dot idiom). */
		.vst-dot {
			color: var(--primary);
		}
	}
</style>

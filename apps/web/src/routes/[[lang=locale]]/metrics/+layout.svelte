<!--
  /metrics article shell.

  S10 (2026-07-02): the rotated writing-mode EDGE WORD ("METRICS." / "MESURE.")
  + its 2px accent-rail + the metro-station dots that used to bracket it are
  RETIRED (D1). The operator's "100% copy of yesid.dev/blog/[slug]" target is the
  measured detail-page reading experience, and yesid's blog/[slug] carries no
  rotated listing edge word (that ornament lived on the LISTING pages, not the
  detail pages). Dropping it collapses the old 3-track [edge | rail | content]
  grid and hands the reclaimed horizontal space to the reading column + the ToC
  rail inside MetricsExplainer's own `.body-grid` (which S10 widens to the yesid
  blog/[slug] proportions).

  The header hierarchy still reads without the edge word: the Masthead
  (kicker / heading / lede) inside MetricsExplainer carries the page identity, and
  the giant vertical title was `aria-hidden` decoration only — no semantic loss.

  What remains here is a bare pass-through: the surface's outer chrome (the
  full-bleed header band + the hazard stripe + the body grid) all live INSIDE
  MetricsExplainer, so the layout adds no structure of its own.
-->
<script lang="ts">
	let { children }: { children: import('svelte').Snippet } = $props();
</script>

{@render children()}

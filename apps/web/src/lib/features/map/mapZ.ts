// mapZ — the map's INTERNAL stacking ladder (P5.3d §C4 P5).
//
// Deliberately NOT design tokens: these values order overlays *within the map
// canvas only* and are meaningless outside it, so they must not pollute the
// global `--z-*` scale. The whole ladder is capped well under `--z-nav` (70) —
// the nav pill always wins over anything the map draws.
//
// Source of truth for the CSS custom properties `--z-map-*` declared on
// `.map-hero` (MapHero.svelte). Consumers read those vars in their `<style>`
// blocks (`z-index: var(--z-map-overlay)`); this module mirrors the numbers for
// any JS/inline-style consumer and documents the intended order in one place.
//
// Ladder (low → high), all < --z-nav (70):
//   behind        -1  pseudo-elements painted behind their host (rings, scrims)
//   canvas         1  the base GL canvas + inner detail content
//   popoverBehind  2  a popover's own behind-pseudo
//   scrim          5  the vignette/scrim layer sitting just over the canvas
//   overlay       10  floating chrome: nav, title, freshness, feed-stall, near-me
//   filter        12  the filter overlay (above nav chrome)
//   bannerContent 13  content stacking inside the feed-stall banner
//   detail        24  the selection-detail chrome band
//   detailPanel   32  the selection-detail panel (just above --z-rail 30)
export const MAP_Z = {
	behind: -1,
	canvas: 1,
	popoverBehind: 2,
	scrim: 5,
	overlay: 10,
	filter: 12,
	bannerContent: 13,
	detail: 24,
	detailPanel: 32,
} as const;

export type MapZLayer = keyof typeof MAP_Z;

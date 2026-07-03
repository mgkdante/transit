// Motion actions — Svelte actions for interaction signatures.
// The Snappy Doctrine limits this surface to the 9-signature vocabulary
// (boop, cursorGlow, magnetic, wordmarkHover, morphHover in 17e-5) + supporting types.
// Slice-23 adds sectionGlow as a section-scoped feedback signature (related
// to cursorGlow but applied to background layers rather than card surfaces).
//
// @yesid/motion Tier-1 barrel (2026-07-02): morphHover + scrollChain are NOT
// extracted — they are component/scrub-coupled (MorphSVG helpers, ScrollTrigger
// scrub machinery) and stay vendored app-side until they promote by rule of
// three. Their lines below are pruned relative to yesid.dev @ 2bdb611d.

export { boop, type BoopParams } from './boop.js';
// reveal — deleted in 17e-2 (Snappy Doctrine forbids entrance actions)
export { magnetic, type MagneticParams } from './magnetic.js';
// ripple — deleted in 17e-2 (not in vocabulary)
// tilt — deleted in 17e-2 (absorbed into magnetic or cut)
export { cursorGlow, type CursorGlowParams } from './cursorGlow.js';
export { sectionGlow } from './sectionGlow.js';
export { cardParallax } from './cardParallax.js';
export { wordmarkHover, type WordmarkHoverParams } from './wordmarkHover.js';
// morphHover — Tier 2, stays app-side (see header)
// scrollChain — Tier 2, stays app-side (see header)
export { pressBounce } from './pressBounce.js';
// tapRipple — deleted in slice-28.3 (#104, zero template consumers)

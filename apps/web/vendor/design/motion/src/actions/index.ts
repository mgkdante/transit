// Motion actions — Svelte actions for interaction signatures.
// The Snappy Doctrine limits this surface to its nine-signature vocabulary
// plus supporting types. sectionGlow provides section-scoped feedback on
// background layers, distinct from cursorGlow on card surfaces.
//
// morphHover and scrollChain are not exported: they remain component- or
// scrub-coupled to MorphSVG helpers and ScrollTrigger machinery. Consumers own
// them locally until the rule of three justifies a package contract.

export { boop, type BoopParams } from './boop.js';
// reveal is excluded because the Snappy Doctrine forbids entrance actions.
export { magnetic, type MagneticParams } from './magnetic.js';
// ripple is not part of the interaction-signature vocabulary.
// tilt is not part of the interaction-signature vocabulary.
export { cursorGlow, type CursorGlowParams } from './cursorGlow.js';
export { sectionGlow } from './sectionGlow.js';
export { cardParallax } from './cardParallax.js';
export { wordmarkHover, type WordmarkHoverParams } from './wordmarkHover.js';
// morphHover — Tier 2, stays app-side (see header)
// scrollChain — Tier 2, stays app-side (see header)
export { pressBounce } from './pressBounce.js';

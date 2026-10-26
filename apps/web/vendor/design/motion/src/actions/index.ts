// Motion actions — Svelte actions for interaction signatures.
// The Snappy Doctrine limits this surface to its nine-signature vocabulary
// plus supporting types. sectionGlow provides section-scoped feedback on
// background layers, distinct from cursorGlow on card surfaces.
//
// morphHover is not exported: it stays coupled to app-side MorphSVG helpers.

export { boop, type BoopParams } from './boop.js';
// reveal is excluded because the Snappy Doctrine forbids entrance actions.
export { magnetic, type MagneticParams } from './magnetic.js';
// ripple is not part of the interaction-signature vocabulary.
// tilt is not part of the interaction-signature vocabulary.
export { cursorGlow, type CursorGlowParams } from './cursorGlow.js';
export { sectionGlow } from './sectionGlow.js';
export { cardParallax } from './cardParallax.js';
export { wordmarkHover, type WordmarkHoverParams } from './wordmarkHover.js';
export { scrollChain } from './scrollChain.js';
export { pressBounce } from './pressBounce.js';

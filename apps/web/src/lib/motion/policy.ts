// Two-tier motion policy — the single decision point for "should this animation
// run right now?". Adapted from the yesid.dev operator rule, re-themed for the
// transit web app (no gsap/lenis/marketing specifics).
//
// SAFE-ALWAYS — runs even under `prefers-reduced-motion: reduce`:
//   opacity / colour / border / filter / shadow changes, tiny translations
//   (≤ 4px), and short user-initiated feedback (< 400ms) on small elements.
//   These read as instant feedback, not as "motion", so they are never gated.
//
// MOTION-GATED — must no-op under reduce:
//   parallax, pointer-tracking translation, scale jumps, content rotation,
//   infinite/ambient loops, scroll-scrubs and smooth-scroll easing.
//
// Gating is a sync snapshot at decision time. Components that want to react to
// the OS setting flipping mid-session should read `prefersReducedMotion.current`
// from `./reduced-motion.svelte.ts` directly.

import { isPrefersReducedMotion } from './reduced-motion.svelte';

export type MotionTier = 'safe-always' | 'motion-gated';

/** Single decision point for "should this animation run right now?". */
export function shouldAnimate(tier: MotionTier): boolean {
	if (tier === 'safe-always') return true;
	return !isPrefersReducedMotion();
}

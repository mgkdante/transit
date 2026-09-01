// Two-tier motion policy.
//
// SAFE-ALWAYS — runs even under `prefers-reduced-motion: reduce`:
//   opacity / color / border / filter / shadow changes, translations ≤ 4px,
//   and user-initiated feedback < 400ms on small elements.
//   Members and categories: boop, cursorGlow, sectionGlow, pressBounce,
//   morphHover, global click ripple, tap-press/tap-feedback, icon/letter/link
//   draws, chip-settle pops and view-toggle arrow nudges.
//
// MOTION-GATED — must no-op under reduce:
//   pinned/scroll scrubs, cardParallax, pointer-tracking translation through
//   magnetic/wordmarkHover, scale jumps > 1.05 such as morph entrances and
//   image zooms, content rotation, infinite loops/pulses/particles,
//   smooth-scroll easing through Lenis, and FLIP filter transitions.
//
// Gating is mount-time-only because isPrefersReducedMotion() is a synchronous
// snapshot. An OS-setting change takes effect on the next initialization or
// navigation.

import { isPrefersReducedMotion } from './stores/reducedMotion.js';

export type MotionTier = 'safe-always' | 'motion-gated';

/** Single decision point for "should this animation run right now?". */
export function shouldAnimate(tier: MotionTier): boolean {
	if (tier === 'safe-always') return true;
	return !isPrefersReducedMotion();
}

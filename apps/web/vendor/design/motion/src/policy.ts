// Two-tier motion policy (GO-day Wave 2, Track 5) — formalizes the slice-23
// operator rule that was previously spread across in-file comments.
//
// SAFE-ALWAYS — runs even under `prefers-reduced-motion: reduce`:
//   opacity / color / border / filter / shadow changes, translations ≤ 4px,
//   and user-initiated feedback < 400ms on small elements.
//   Members: boop, cursorGlow, sectionGlow, pressBounce, morphHover,
//   global click ripple, tap-press/tap-feedback, SvgIcon entrance draws,
//   HomeServices icon draw-in, CloserGraffiti letter draw, link underline
//   draws, chip-settle pops, view-toggle arrow nudges.
//
// MOTION-GATED — must no-op under reduce:
//   pinned/scroll scrubs (hero timeline, crescendo, draw scrubs), parallax
//   (cardParallax), pointer-tracking translation (magnetic, wordmarkHover),
//   scale jumps > 1.05 (SvgIcon 'morph' entrance, ProjectCard image zoom),
//   content rotation, infinite ambient motion (DataFlowDiagram pulse,
//   ManifestoCanvas, AboutWeather particles, backgroundBreathing, AboutTrain
//   loop), smooth-scroll easing (Lenis), FLIP filter transitions.
//
// Gating is mount-time-only across the site (isPrefersReducedMotion() is a
// sync snapshot): toggling the OS setting mid-session takes effect on the
// next navigation. Accepted operator trade-off (Wave-1 research §5.6).

import { isPrefersReducedMotion } from './stores/reducedMotion.js';

export type MotionTier = 'safe-always' | 'motion-gated';

/** Single decision point for "should this animation run right now?". */
export function shouldAnimate(tier: MotionTier): boolean {
	if (tier === 'safe-always') return true;
	return !isPrefersReducedMotion();
}

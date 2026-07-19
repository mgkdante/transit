// @yesid/motion — the brand's pure motion layer, extracted from yesid.dev
// @ 2bdb611d91749dc437c07586cb82129eabe9dfec (Tier 1 of the design system).
//
// Runtime contract: consumers opt in to @yesid/tokens/tokens.css —
// magnetic/boop/cursorGlow read --duration-*/--ease-bounce/--primary-rgb CSS
// custom properties at runtime. No import is automatic.

export {
	boop,
	magnetic,
	cursorGlow,
	sectionGlow,
	cardParallax,
	wordmarkHover,
	pressBounce,
	type BoopParams,
	type MagneticParams,
	type CursorGlowParams,
	type WordmarkHoverParams,
} from './actions/index.js';

export { shouldAnimate, type MotionTier } from './policy.js';
export { duration, ease, durationSec, type DurationKey, type EaseKey } from './tokens.js';
export { prefersReducedMotion, isPrefersReducedMotion } from './stores/reducedMotion.js';
export { isTouchDevice, isViewportAtMost } from './utils/device.js';
export {
	findSettleTarget,
	initSectionMagnet,
	DESKTOP_TIER,
	TOUCH_TIER,
	type MagnetTier,
	type SectionMagnetOpts,
	type SettleTargetOpts,
} from './utils/sectionMagnet.js';

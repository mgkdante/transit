// GSAP plugin registration — ScrollTrigger + SplitText eager.
//
// DEVIATION MOTION-1 from yesid.dev @ 2bdb611d (dated 2026-07-02): the source
// file also eagerly imported MorphSVGPlugin and shipped lazy loaders
// (loadDrawSVG/loadMorphSVG/loadFlip/loadCustomEase). Their only consumers are
// the Tier-2 actions (morphHover, scrollChain) and app components that stay
// vendored app-side, so this package ships only what the Tier-1 vocabulary
// needs. Apps keep their own registration module for Tier-2 plugins until
// those actions promote. Everything kept below is byte-equivalent.
//
// Eager:
//   - ScrollTrigger  — config applied via initScrollTriggerConfig().
//   - SplitText      — wordmarkHover's action contract runs `new SplitText(...)`
//                       synchronously, so it can't await a dynamic import.

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

let configured = false;
const loadedPlugins = new Set<string>();

/**
 * Register ScrollTrigger and apply its site-wide config. The config
 * ignores viewport height changes < 25% (mobile address bar show/hide)
 * so ScrollTrigger doesn't recalculate pin positions when browser
 * chrome appears/disappears. Compatible with Lenis (unlike normalizeScroll).
 *
 * Idempotent — safe to call from any route/consumer mount. Every consumer
 * that creates a ScrollTrigger must call this first.
 */
export function initScrollTriggerConfig(): void {
	if (configured) return;
	gsap.registerPlugin(ScrollTrigger);
	ScrollTrigger.config({ ignoreMobileResize: true });
	configured = true;
}

/**
 * Sync SplitText registration — for wordmarkHover, whose action contract
 * requires `new SplitText(node, ...)` to run synchronously at mount.
 * Uses the eagerly-imported SplitText symbol (no dynamic import).
 * Idempotent.
 */
export function ensureSplitTextRegistered(): void {
	if (loadedPlugins.has('SplitText')) return;
	gsap.registerPlugin(SplitText);
	loadedPlugins.add('SplitText');
}

// Re-export for motion code that needs a direct symbol reference.
// gsap       — every consumer
// ScrollTrigger — sectionMagnet/lenis bridge
// SplitText  — wordmarkHover
export { gsap, ScrollTrigger, SplitText };

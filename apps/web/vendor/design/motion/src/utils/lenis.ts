// Lenis smooth scroll initialization with GSAP ScrollTrigger bridge.
// Initialized once at layout level. All ScrollTrigger instances automatically
// use Lenis scroll position instead of native scroll.
//
// Strategy:
// - Desktop: Lenis provides buttery easing for wheel scroll.
// - Touch devices: native browser scroll. NO scroll-jacking.
// - Reduced motion: native scroll, no Lenis (MOTION-GATED tier).
//
// Previous versions called `ScrollTrigger.normalizeScroll({ allowNestedScroll: true })`
// on touch devices. That call applied `touch-action: pan-x pinch-zoom` to html/body,
// which altered iOS click synthesis and misclassified vertical-scroll or
// horizontal-swipe gestures as taps.
// Removing it is the right fix. Touch pin recalculations are handled by
// `ScrollTrigger.config({ ignoreMobileResize: true })` (set in gsap.ts).

import Lenis from 'lenis';
import { gsap, initScrollTriggerConfig, ScrollTrigger } from './gsap.js';
import { shouldAnimate } from '../policy.js';

let instance: Lenis | null = null;
let tickerCallback: ((time: number) => void) | null = null;
let isTouchDevice = false;

/**
 * An element scroller in place of the window. `content` must wrap the whole scrolling flow so
 * Lenis sees its height change; Lenis would otherwise measure `document.documentElement`.
 */
export interface LenisScroller {
	readonly wrapper: HTMLElement;
	readonly content: HTMLElement;
}

export function initLenis(scroller?: LenisScroller): void {
	if (instance) return;

	// MOTION-GATED tier: reduced-motion users get native
	// browser scroll — no 1.2s eased scroll-jacking. Native scroll is the
	// correct reduce behavior; ScrollTrigger keeps working off native scroll.
	if (!shouldAnimate('motion-gated')) return;

	// ScrollTrigger.isTouch is only set once the plugin is registered.
	// 0 = no touch, 1 = touch only, 2 = touch + pointer
	initScrollTriggerConfig();
	isTouchDevice = ScrollTrigger.isTouch > 0;

	if (isTouchDevice) {
		// Touch: native browser scroll. Lenis disabled. No normalizeScroll.
		// ScrollTrigger still works with native scroll events.
		return;
	}

	// Desktop: Lenis for smooth wheel scroll
	instance = new Lenis({
		...scroller,
		autoRaf: false, // We drive RAF via GSAP ticker — prevent double-update
		duration: 1.2,
		easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
	});

	// Bridge: Lenis scroll events update GSAP ScrollTrigger
	instance.on('scroll', ScrollTrigger.update);

	// Drive Lenis from GSAP's RAF ticker for frame-perfect sync
	tickerCallback = (time: number) => {
		instance?.raf(time * 1000);
	};
	gsap.ticker.add(tickerCallback);
	gsap.ticker.lagSmoothing(0);
}

export function destroyLenis(): void {
	if (isTouchDevice) {
		// Nothing to destroy — no normalizeScroll active, no Lenis instance.
		return;
	}
	if (!instance) return;
	if (tickerCallback) {
		gsap.ticker.remove(tickerCallback);
		tickerCallback = null;
	}
	instance.destroy();
	instance = null;
}

export function getLenis(): Lenis | null {
	return instance;
}

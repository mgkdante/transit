// Blueprint header draw-on-scroll — the yesid listing-blueprint effect,
// re-implemented transit-local (P5-R R3).
//
// WHY not the yesid ScrollTrigger/DrawSVG port: transit pages scroll an INNER
// app-shell container, not the window, and ScrollTrigger's scroller wiring
// proved brittle against it (correct initial progress, then no updates). The
// effect itself is ~40 lines of rect math: stroke-dasharray = drawn length,
// progressed as the band travels through the viewport. A capture-phase scroll
// listener on `document` sees EVERY scroller's events (scroll does not bubble,
// but capture observes it), so this works identically for window scrolling,
// the app shell, or any future container — nothing to configure, no gsap
// plugins to download.
//
// Scope law (R3a review): only `.blueprint-bg svg path` — BlueprintShell's
// aria-hidden decoration root — is ever touched. The band also hosts
// INTERACTIVE chrome whose icons are stroked paths (QuietModeButton); a
// band-wide selector would blank working controls.
//
// Gates: SSR / prefers-reduced-motion / viewport ≤ 1023px never attach
// anything — the art renders fully drawn (an SVG stroke's default state), so
// the degraded experience is the complete drawing at zero cost. The listener
// detaches via the returned destroy callback; per-frame work is rAF-coalesced
// and only runs while scroll events actually fire.

import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
import { isViewportAtMost } from '@yesid/motion/utils/device';

/**
 * Start the draw-on-scroll scrub over a blueprint header's strokes: mostly
 * drawn on arrival, completing exactly as the band scrolls out of view.
 *
 * @param bandEl the header band element containing the blueprint art
 * @returns a destroy callback, or undefined when the scrub never mounted
 *          (SSR, reduced motion, viewport ≤ 1023px, no art strokes).
 */
export function startBlueprintScrub(bandEl: HTMLElement): (() => void) | undefined {
	if (typeof window === 'undefined') return undefined;
	if (isPrefersReducedMotion() || isViewportAtMost(1023)) return undefined;

	const paths = Array.from(bandEl.querySelectorAll<SVGPathElement>('.blueprint-bg svg path'));
	const lengths = paths.map((p) => {
		try {
			return p.getTotalLength();
		} catch {
			return 0; // unmeasurable path (defensive; leave it untouched)
		}
	});
	if (!lengths.some((l) => l > 0)) return undefined;

	// Progress through [band top reaches viewport bottom → band bottom reaches
	// viewport top]: ~0.6 on arrival (the band rests near the viewport top),
	// exactly 1 as the last art pixel leaves. Rect math is viewport-relative,
	// so WHICH element scrolls is irrelevant.
	function progress(): number {
		const r = bandEl.getBoundingClientRect();
		const total = window.innerHeight + r.height;
		if (total <= 0) return 1;
		return Math.min(1, Math.max(0, (window.innerHeight - r.top) / total));
	}

	function apply(p: number): void {
		for (let i = 0; i < paths.length; i += 1) {
			const length = lengths[i];
			if (length <= 0) continue;
			paths[i].style.strokeDasharray = `${length * p}px, ${length}px`;
			paths[i].style.strokeDashoffset = '0';
		}
	}

	let raf = 0;
	function onScroll(): void {
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			apply(progress());
		});
	}

	apply(progress());
	// Capture phase observes scroll events from EVERY scroll container.
	document.addEventListener('scroll', onScroll, { capture: true, passive: true });
	window.addEventListener('resize', onScroll, { passive: true });

	return () => {
		document.removeEventListener('scroll', onScroll, { capture: true });
		window.removeEventListener('resize', onScroll);
		if (raf) cancelAnimationFrame(raf);
	};
}

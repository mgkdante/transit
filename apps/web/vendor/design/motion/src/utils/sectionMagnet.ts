// Section magnetism (go2/w5) — ease-to-nearest-section on scroll settle for
// the home page. The magnet sits on top of whatever scroll engine is live
// (Lenis wheel easing on desktop, native touch scroll on mobile) by listening
// for settle and nudging the window.
//
// Taste round 2 (operator): the magnet is TIERED by input modality.
//   - Desktop (wheel / keyboard / mouse): STRONGER — a wider attraction
//     radius and a firmer, quicker ease make the pull into sections decisive.
//   - Touch: GENTLER — natural touch scrolling must never fight the magnet,
//     so the radius shrinks, the settle debounce waits out momentum, and the
//     nudge rides the browser's native smooth scroll (never Lenis).
//
// SOFT magnet, never hard paging: it only acts when the settle point is
// already within the attraction radius of a section top. Outside the radius
// nothing moves — free scrolling is untouched, and the hero pin interior
// (hundreds of vh from any boundary) can never be yanked.
//
// Reduced motion (operator-corrected): the magnet is ASSISTIVE, not
// vestibular — reduce users KEEP the alignment but get an instant settle
// (behavior: 'auto') instead of the smooth ease. This is deliberately NOT
// shouldAnimate('motion-gated')-gated off.
//
// Settle detection: debounced scroll events (works for Lenis-driven wheel,
// native touch momentum, scrollbar drags and keyboard scrolling alike).
// A held pointer (scrollbar drag) defers the magnet until release; wheel /
// touchstart cancel a pending settle so an actively-scrolling user is never
// fought.

import { isPrefersReducedMotion } from '../stores/reducedMotion.js';
import { getLenis } from './lenis.js';

export interface SettleTargetOpts {
	/** Attraction radius in px — beyond it the magnet stays off. */
	radius: number;
	/** Document max scroll (scrollHeight - viewport); targets clamp to it. */
	maxScroll: number;
	/** Already-aligned tolerance in px — within it, no nudge (no loops). */
	epsilon?: number;
}

/**
 * Pure settle-target math: nearest section top to `scrollY`, clamped to the
 * scrollable range; null when out of attraction range, already aligned, or
 * no sections exist.
 */
export function findSettleTarget(
	scrollY: number,
	sectionTops: readonly number[],
	{ radius, maxScroll, epsilon = 2 }: SettleTargetOpts,
): number | null {
	let best: number | null = null;
	let bestDist = Infinity;
	for (const top of sectionTops) {
		const clamped = Math.min(Math.max(top, 0), maxScroll);
		const dist = Math.abs(clamped - scrollY);
		if (dist < bestDist) {
			bestDist = dist;
			best = clamped;
		}
	}
	if (best === null) return null;
	if (bestDist > radius) return null;
	if (bestDist <= epsilon) return null;
	return best;
}

export interface MagnetTier {
	/** Attraction radius as a fraction of viewport height. */
	radiusVh: number;
	/** Hard cap on the radius in px. */
	maxRadiusPx: number;
	/** Debounce after the last scroll event before settling. */
	settleMs: number;
}

/** Desktop tier — decisive pull (taste round 2: radius up 0.22→0.32). */
export const DESKTOP_TIER: MagnetTier = { radiusVh: 0.32, maxRadiusPx: 360, settleMs: 150 };

/** Touch tier — gentler than round 1 (0.22→0.16) + waits out momentum. */
export const TOUCH_TIER: MagnetTier = { radiusVh: 0.16, maxRadiusPx: 160, settleMs: 260 };

export interface SectionMagnetOpts {
	/** Desktop (wheel/keyboard/mouse) tier overrides. */
	desktop?: Partial<MagnetTier>;
	/** Touch tier overrides. */
	touch?: Partial<MagnetTier>;
	/** Smooth-ease duration when Lenis drives the desktop nudge. Default 0.8s. */
	lenisDuration?: number;
	/**
	 * Optional predicate — when it returns true the magnet stands down (no
	 * settle nudge). slice-34.4 uses it to suppress the magnet while a
	 * locale-switch scroll restore is in flight: the restore's forced jump to a
	 * scroll fraction fires scroll events that would otherwise trip a settle and
	 * yank the just-restored position to the nearest section top.
	 */
	suppress?: () => boolean;
}

/**
 * Wire the section magnet. `getSections` is called lazily at each settle so
 * layout changes (hero collapse, pin spacers, resizes) are always measured
 * fresh. Returns a destroy function.
 */
export function initSectionMagnet(
	getSections: () => readonly HTMLElement[],
	opts: SectionMagnetOpts = {},
): () => void {
	const desktopTier: MagnetTier = { ...DESKTOP_TIER, ...opts.desktop };
	const touchTier: MagnetTier = { ...TOUCH_TIER, ...opts.touch };
	const lenisDuration = opts.lenisDuration ?? 0.8;
	const suppress = opts.suppress ?? (() => false);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let pointerDown = false;
	// Last observed input modality. Touch scrolling must never be fought, so
	// when in doubt (no input seen yet) fall back to the coarse-pointer media
	// query — i.e. phones default to the gentle tier before the first touch.
	let modality: 'precise' | 'touch' | null = null;

	function isTouchMode(): boolean {
		if (modality !== null) return modality === 'touch';
		return (
			typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
		);
	}

	function tier(): MagnetTier {
		return isTouchMode() ? touchTier : desktopTier;
	}

	function clearTimer(): void {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function schedule(): void {
		clearTimer();
		timer = setTimeout(settle, tier().settleMs);
	}

	function settle(): void {
		timer = null;
		if (pointerDown) return; // scrollbar drag in progress — wait for release
		if (suppress()) return; // standing down (e.g. locale-switch scroll restore)

		const touchMode = isTouchMode();
		const { radiusVh, maxRadiusPx } = touchMode ? touchTier : desktopTier;
		const viewport = window.innerHeight;
		const maxScroll = Math.max(0, document.documentElement.scrollHeight - viewport);
		const scrollY = window.scrollY;
		const tops = getSections().map((el) => el.getBoundingClientRect().top + scrollY);

		const target = findSettleTarget(scrollY, tops, {
			radius: Math.min(viewport * radiusVh, maxRadiusPx),
			maxScroll,
		});
		if (target === null) return;

		if (isPrefersReducedMotion()) {
			// Assistive settle, zero animation.
			window.scrollTo({ top: target, behavior: 'auto' });
			return;
		}

		if (!touchMode) {
			const lenis = getLenis();
			if (lenis) {
				// Decisive desktop pull: starts fast, lands soft (quart-out).
				lenis.scrollTo(target, {
					duration: lenisDuration,
					easing: (t: number) => 1 - Math.pow(1 - t, 4),
				});
				return;
			}
		}

		// Touch (and Lenis-less desktop): the browser's native smooth scroll —
		// interruptible by any user input, so touch is never fought.
		window.scrollTo({ top: target, behavior: 'smooth' });
	}

	function onScroll(): void {
		schedule();
	}
	function onPointerDown(e: PointerEvent): void {
		if (e.pointerType === 'touch') modality = 'touch';
		else if (e.pointerType === 'mouse' || e.pointerType === 'pen') modality = 'precise';
		pointerDown = true;
		clearTimer();
	}
	function onPointerUp(): void {
		pointerDown = false;
		schedule();
	}
	function onWheel(): void {
		modality = 'precise';
		// The user took over — never fight them.
		clearTimer();
	}
	function onTouchStart(): void {
		modality = 'touch';
		clearTimer();
	}
	function onKeyDown(): void {
		modality = 'precise';
		clearTimer();
	}

	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('pointerdown', onPointerDown as EventListener, { passive: true });
	window.addEventListener('pointerup', onPointerUp, { passive: true });
	window.addEventListener('pointercancel', onPointerUp, { passive: true });
	window.addEventListener('wheel', onWheel, { passive: true });
	window.addEventListener('touchstart', onTouchStart, { passive: true });
	window.addEventListener('keydown', onKeyDown);

	return () => {
		clearTimer();
		window.removeEventListener('scroll', onScroll);
		window.removeEventListener('pointerdown', onPointerDown as EventListener);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerUp);
		window.removeEventListener('wheel', onWheel);
		window.removeEventListener('touchstart', onTouchStart);
		window.removeEventListener('keydown', onKeyDown);
	};
}

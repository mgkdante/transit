// easterWordHover — the browser-only GSAP flourish for an easter word span.
//
// Reuses the house wordmarkHover EFFECT FAMILY (bounce / wiggle / wave / spin,
// rotating one per hover) but WITHOUT the wordmark's mandatory orange-dot pulse:
// an easter word is a run of prose, not the brand mark. The effect is pure
// decoration, so it self-disables on touch + under prefers-reduced-motion (the
// caller also guards, but the action is defensive) and GSAP is imported lazily so
// reduced-motion / touch readers never fetch it.
//
// SplitText wraps each character in a <div> for the transform; those wrappers are
// decoration artifacts, so the host span is marked aria-hidden-safe by the caller
// keeping the ORIGINAL text as the accessible content (SplitText reverts on
// destroy, restoring the plain text node). Zero layout shift: the split chars keep
// inline flow and only translate/rotate, and revert on cleanup.

import { isPrefersReducedMotion } from '$lib/motion/reduced-motion.svelte';
import { isTouchDevice } from '$lib/motion/utils/device';

// The four effect builders, byte-mirrored from wordmarkHover's family (minus the
// dot pulse). Each returns a gsap timeline over the split chars.
type Chars = Element[];
type EffectFn = (chars: Chars, gsap: typeof import('gsap').gsap) => gsap.core.Timeline;

const effectBounce: EffectFn = (chars, gsap) =>
	gsap
		.timeline()
		.fromTo(chars, { y: 0 }, { y: -15, stagger: 0.04, duration: 0.3, ease: 'back.out(1.7)' })
		.to(chars, { y: 0, stagger: 0.04, duration: 0.3, ease: 'power2.out' }, '>-0.15');

const effectWiggle: EffectFn = (chars, gsap) =>
	gsap
		.timeline()
		.to(chars, { rotation: 12, stagger: 0.03, duration: 0.15, ease: 'power1.out' })
		.to(chars, { rotation: -12, stagger: 0.03, duration: 0.15, ease: 'power1.out' })
		.to(chars, { rotation: 0, stagger: 0.03, duration: 0.3, ease: 'elastic.out(1, 0.3)' });

const effectWave: EffectFn = (chars, gsap) =>
	gsap.timeline().to(chars, {
		y: -10,
		stagger: { each: 0.05, from: 'start' },
		duration: 0.25,
		ease: 'sine.out',
		yoyo: true,
		repeat: 1,
	});

const effectSpin: EffectFn = (chars, gsap) =>
	gsap
		.timeline()
		.to(chars, { rotation: 360, stagger: 0.05, duration: 0.5, ease: 'power2.inOut' })
		.set(chars, { rotation: 0 });

const EFFECTS: readonly EffectFn[] = [effectBounce, effectWiggle, effectWave, effectSpin];

/**
 * A Svelte action for an easter-word span. On mouseenter it plays the next effect
 * in the rotating family. No-op (returns an empty destroy) on the server, on touch
 * devices, and under prefers-reduced-motion — those readers see the plain word.
 *
 * `startEffect` seeds the rotation so different words on the page do not all fire
 * the same effect first (the caller passes the word's index). `autoPlay` fires the
 * first effect once shortly after mount (used for the page title, mirroring the
 * BrandWordmark autoplay) — hover still rotates the family thereafter.
 */
export function easterWordHover(
	node: HTMLElement,
	params: { startEffect?: number; autoPlay?: boolean; autoPlayDelay?: number } = {},
): { destroy(): void } {
	if (typeof window === 'undefined') return { destroy() {} };
	if (isTouchDevice() || isPrefersReducedMotion()) return { destroy() {} };

	let effectIndex =
		(((params.startEffect ?? 0) % EFFECTS.length) + EFFECTS.length) % EFFECTS.length;
	let isAnimating = false;
	let destroyed = false;
	let autoId: ReturnType<typeof setTimeout> | undefined;
	// Loaded lazily on first hover; kept for revert on destroy.
	let split: { chars: Element[]; revert(): void } | null = null;
	let gsapRef: typeof import('gsap').gsap | null = null;

	async function ensureLoaded(): Promise<boolean> {
		if (split && gsapRef) return true;
		try {
			const { gsap, SplitText, ensureSplitTextRegistered } = await import('$lib/motion/utils/gsap');
			if (destroyed) return false;
			ensureSplitTextRegistered();
			gsapRef = gsap;
			split = new SplitText(node, { type: 'chars' }) as unknown as {
				chars: Element[];
				revert(): void;
			};
			return true;
		} catch {
			// GSAP failed to load — the word simply stays a plain, static word.
			return false;
		}
	}

	async function playEffect(): Promise<void> {
		if (isAnimating || destroyed) return;
		if (!(await ensureLoaded())) return;
		if (destroyed || !split || !gsapRef) return;
		isAnimating = true;
		const tl = EFFECTS[effectIndex](split.chars, gsapRef);
		effectIndex = (effectIndex + 1) % EFFECTS.length;
		tl.then(() => {
			isAnimating = false;
		});
	}

	node.addEventListener('mouseenter', playEffect);

	if (params.autoPlay) {
		autoId = setTimeout(() => void playEffect(), params.autoPlayDelay ?? 500);
	}

	return {
		destroy() {
			destroyed = true;
			if (autoId) clearTimeout(autoId);
			node.removeEventListener('mouseenter', playEffect);
			split?.revert();
		},
	};
}

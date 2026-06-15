// use:wordmarkHover — GSAP SplitText animation pool for the "yesid." brand wordmark.
//
// Ported verbatim from yesid.dev (lib/motion/actions/wordmarkHover.ts): four
// effects rotate on each hover (bounce, wiggle, wave, spin); the orange dot
// always pulses alongside. Disabled on touch + under prefers-reduced-motion.
// Shared brand interaction — the signature motion of the house wordmark.
//
// Driven from a component's onMount (NOT `use:` directly) so the dot element is
// already bound when the action initializes — see BrandWordmark.svelte.

import { isPrefersReducedMotion } from '../reduced-motion.svelte';
import { ensureSplitTextRegistered, gsap, SplitText } from '../utils/gsap';
import { isTouchDevice } from '../utils/device';

export interface WordmarkHoverParams {
	/** Reference to the dot element (the "." after "yesid"). */
	dotEl: HTMLElement;
	/** Play the first effect immediately on mount. Default: false. */
	autoPlay?: boolean;
	/** Delay in ms before autoPlay fires. Default: 500. */
	autoPlayDelay?: number;
}

export function wordmarkHover(node: HTMLElement, params: WordmarkHoverParams) {
	if (typeof window === 'undefined') return { destroy() {} };
	if (isTouchDevice() || isPrefersReducedMotion()) return { destroy() {} };

	const { dotEl, autoPlay = false, autoPlayDelay = 500 } = params;

	ensureSplitTextRegistered();
	const splitInstance = new SplitText(node, { type: 'chars' });

	let effectIndex = 0;
	let isAnimating = false;

	const effectBounce = (chars: Element[]) =>
		gsap
			.timeline()
			.fromTo(chars, { y: 0 }, { y: -15, stagger: 0.04, duration: 0.3, ease: 'back.out(1.7)' })
			.to(chars, { y: 0, stagger: 0.04, duration: 0.3, ease: 'power2.out' }, '>-0.15');

	const effectWiggle = (chars: Element[]) =>
		gsap
			.timeline()
			.to(chars, { rotation: 12, stagger: 0.03, duration: 0.15, ease: 'power1.out' })
			.to(chars, { rotation: -12, stagger: 0.03, duration: 0.15, ease: 'power1.out' })
			.to(chars, { rotation: 0, stagger: 0.03, duration: 0.3, ease: 'elastic.out(1, 0.3)' });

	const effectWave = (chars: Element[]) =>
		gsap.timeline().to(chars, {
			y: -10,
			stagger: { each: 0.05, from: 'start' },
			duration: 0.25,
			ease: 'sine.out',
			yoyo: true,
			repeat: 1,
		});

	const effectSpin = (chars: Element[]) =>
		gsap
			.timeline()
			.to(chars, { rotation: 360, stagger: 0.05, duration: 0.5, ease: 'power2.inOut' })
			.set(chars, { rotation: 0 });

	const effects = [effectBounce, effectWiggle, effectWave, effectSpin];

	function playEffect() {
		if (isAnimating || !splitInstance) return;
		isAnimating = true;

		const tl = effects[effectIndex](splitInstance.chars);
		tl.fromTo(
			dotEl,
			{ scale: 1 },
			{ scale: 1.4, duration: 0.15, ease: 'power2.out', yoyo: true, repeat: 1 },
			0,
		);
		tl.then(() => {
			isAnimating = false;
		});

		effectIndex = (effectIndex + 1) % effects.length;
	}

	node.addEventListener('mouseenter', playEffect);

	let autoId: ReturnType<typeof setTimeout> | undefined;
	if (autoPlay) autoId = setTimeout(playEffect, autoPlayDelay);

	return {
		destroy() {
			if (autoId) clearTimeout(autoId);
			node.removeEventListener('mouseenter', playEffect);
			splitInstance?.revert();
		},
	};
}

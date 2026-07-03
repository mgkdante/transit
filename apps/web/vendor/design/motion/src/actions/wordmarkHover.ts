// use:wordmarkHover — GSAP SplitText animation pool for the "yesid." brand wordmark.
//
// Four effects rotate on each hover (bounce, wiggle, wave, spin).
// The orange dot always pulses alongside any effect.
// Shared between Nav and Footer to keep the interaction consistent.
//
// Usage: <span use:wordmarkHover={{ dotEl: dotRef }}>yesid</span>

import { isPrefersReducedMotion } from '../stores/reducedMotion.js';
import { initScrollTriggerConfig, ensureSplitTextRegistered, gsap, SplitText } from '../utils/gsap.js';
import { isTouchDevice } from '../utils/device.js';
import { durationSec } from '../tokens';

export interface WordmarkHoverParams {
	/** Reference to the dot element (the "." after "yesid") */
	dotEl: HTMLElement;
	/** If true, play the first effect immediately on mount. Default: false */
	autoPlay?: boolean;
	/** Delay in ms before autoPlay fires. Default: 500 */
	autoPlayDelay?: number;
}

export function wordmarkHover(node: HTMLElement, params: WordmarkHoverParams) {
	if (isTouchDevice()) return { destroy() {} };
	if (isPrefersReducedMotion() || typeof window === 'undefined') {
		return { destroy() {} };
	}

	const { dotEl, autoPlay = false, autoPlayDelay = 500 } = params;

	// wordmarkHover's action contract runs synchronously — SplitText must be
	// registered via a sync path rather than awaiting loadSplitText().
	// initScrollTriggerConfig() covers ScrollTrigger even though this action
	// doesn't use it (harmless no-op if the layout already initialized it).
	initScrollTriggerConfig();
	ensureSplitTextRegistered();
	const splitInstance = new SplitText(node, { type: 'chars' });

	let effectIndex = 0;
	let isAnimating = false;

	// --- Effect pool ---

	const effectBounce = (chars: Element[]) =>
		gsap
			.timeline()
			.fromTo(chars, { y: 0 }, { y: -15, stagger: 0.04, duration: durationSec('slow'), ease: 'back.out(1.7)' })
			.to(chars, { y: 0, stagger: 0.04, duration: durationSec('slow'), ease: 'power2.out' }, '>-0.15');

	const effectWiggle = (chars: Element[]) =>
		gsap
			.timeline()
			.to(chars, { rotation: 12, stagger: 0.03, duration: durationSec('fast'), ease: 'power1.out' })
			.to(chars, { rotation: -12, stagger: 0.03, duration: durationSec('fast'), ease: 'power1.out' })
			.to(chars, { rotation: 0, stagger: 0.03, duration: durationSec('slow'), ease: 'elastic.out(1, 0.3)' });

	const effectWave = (chars: Element[]) =>
		gsap.timeline().to(chars, {
			y: -10,
			stagger: { each: 0.05, from: 'start' },
			duration: 0.25,
			ease: 'sine.out',
			yoyo: true,
			repeat: 1
		});

	const effectSpin = (chars: Element[]) =>
		gsap
			.timeline()
			.to(chars, { rotation: 360, stagger: 0.05, duration: durationSec('slower'), ease: 'power2.inOut' })
			.set(chars, { rotation: 0 });

	const effects = [effectBounce, effectWiggle, effectWave, effectSpin];

	function playEffect() {
		if (isAnimating || !splitInstance) return;
		isAnimating = true;

		const tl = effects[effectIndex](splitInstance.chars);

		tl.fromTo(
			dotEl,
			{ scale: 1 },
			{ scale: 1.4, duration: durationSec('fast'), ease: 'power2.out', yoyo: true, repeat: 1 },
			0
		);

		tl.then(() => {
			isAnimating = false;
		});

		effectIndex = (effectIndex + 1) % effects.length;
	}

	node.addEventListener('mouseenter', playEffect);

	if (autoPlay) {
		setTimeout(playEffect, autoPlayDelay);
	}

	return {
		destroy() {
			node.removeEventListener('mouseenter', playEffect);
			splitInstance?.revert();
		}
	};
}

// pressBounce — Svelte action for tactile tap-press feedback on touch devices.
// Layer 2 of the slice-19 two-layer hybrid primitive system.
//
// Gated by:
//   - isTouchDevice() — pointer-only devices use hover/active CSS instead.
//
// Reduced-motion: KEPT ACTIVE per operator policy (slice-23). pressBounce
// is <200ms scale feedback on user action — not a vestibular trigger.
//
// Pair with class="tap-press" (Layer 1 CSS baseline) for layered feedback.
// The Layer 1 CSS ships as a copy-paste consumer snippet, not an import —
// see packages/motion/tap-feedback.css.

import { gsap } from '../utils/gsap';
import { isTouchDevice } from '../utils/device';
import { durationSec } from '../tokens';

type ActionReturn = { destroy(): void };

export function pressBounce(node: HTMLElement): ActionReturn {
	if (!isTouchDevice()) {
		return { destroy() {} };
	}

	const onDown = () => {
		gsap.killTweensOf(node);
		gsap.to(node, {
			scale: 0.94,
			duration: durationSec('instant'),
			ease: 'power2.out',
		});
	};

	const onUp = () => {
		gsap.killTweensOf(node);
		gsap.to(node, {
			scale: 1,
			duration: durationSec('fast'),
			ease: 'back.out(2)', // bounce overshoot
		});
	};

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onUp);

	return {
		destroy() {
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointerup', onUp);
			node.removeEventListener('pointercancel', onUp);
			gsap.killTweensOf(node);
		},
	};
}

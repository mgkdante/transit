// use:magnetic — subtle element pull toward the cursor on desktop.
//
// Ported verbatim from yesid.dev: a 2-3px pull makes a control feel "aware" of
// the cursor. Disabled on touch devices + under prefers-reduced-motion.
//
// Usage: <a use:magnetic={{ strength: 6, radius: 50 }}>

import { isPrefersReducedMotion } from '../reduced-motion.svelte';
import { isTouchDevice } from '../utils/device';

export interface MagneticParams {
	/** Max displacement in px. Default: 3. */
	strength?: number;
	/** Distance from the element centre within which the pull applies, in px. Default: 50. */
	radius?: number;
}

export function magnetic(node: HTMLElement, params: MagneticParams = {}) {
	if (isPrefersReducedMotion() || isTouchDevice()) {
		return { update() {}, destroy() {} };
	}

	let { strength = 3, radius = 50 } = params;

	function onMouseMove(e: MouseEvent) {
		const rect = node.getBoundingClientRect();
		const centreX = rect.left + rect.width / 2;
		const centreY = rect.top + rect.height / 2;
		const dx = e.clientX - centreX;
		const dy = e.clientY - centreY;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance > radius) {
			node.style.transform = '';
			return;
		}

		const factor = (1 - distance / radius) * strength;
		const tx = (dx / radius) * factor;
		const ty = (dy / radius) * factor;
		node.style.transition = 'transform 0.1s ease-out';
		node.style.transform = `translate(${tx}px, ${ty}px)`;
	}

	function onMouseLeave() {
		node.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
		node.style.transform = '';
	}

	node.addEventListener('mousemove', onMouseMove);
	node.addEventListener('mouseleave', onMouseLeave);

	return {
		update(newParams: MagneticParams) {
			strength = newParams.strength ?? 3;
			radius = newParams.radius ?? 50;
		},
		destroy() {
			node.removeEventListener('mousemove', onMouseMove);
			node.removeEventListener('mouseleave', onMouseLeave);
			node.style.transform = '';
		},
	};
}

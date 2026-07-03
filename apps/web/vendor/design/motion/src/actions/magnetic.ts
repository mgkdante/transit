// use:magnetic — subtle element pull toward the cursor on desktop.
//
// WHY: Interactive elements should feel responsive to the cursor beyond just a colour
// change. A 2-3px pull makes a button feel "aware" and increases perceived interactivity.
//
// Disabled on:
//   - Touch devices (no cursor to track)
//   - Reduced-motion preference
//
// Usage: <a use:magnetic={{ strength: 3, radius: 50 }}>

import { isPrefersReducedMotion } from '../stores/reducedMotion.js';
import { isTouchDevice } from '../utils/device.js';

export interface MagneticParams {
	/** Max displacement in px. Default: 3 */
	strength?: number;
	/** Distance from element centre within which the pull applies, in px. Default: 50 */
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
		node.style.transition = 'transform var(--duration-instant) ease-out';
		node.style.transform = `translate(${tx}px, ${ty}px)`;
	}

	function onMouseLeave() {
		node.style.transition = 'transform var(--duration-slow) var(--ease-bounce)';
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
		}
	};
}

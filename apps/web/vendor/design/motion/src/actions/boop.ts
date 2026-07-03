// use:boop — brief transform on hover that resets itself after ~300ms.
//
// WHY a boop instead of a standard hover scale:
//   A standard hover state stays active as long as the cursor is over the element.
//   A boop fires once — like a tap — then immediately returns to rest. This creates a
//   "alive" feeling: the element responds to attention without staying in a transformed
//   state that can look stuck or heavy. Concept from joshwcomeau.com.
// SAFE-ALWAYS tier (GO-w2t5): ≤1.05 scale, user-initiated, self-resetting —
// runs under prefers-reduced-motion (pressBounce precedent, slice-23 policy).
//
// Usage: <button use:boop={{ scale: 1.05, rotation: 5, timing: 300 }}>

import { isTouchDevice } from '../utils/device.js';

export interface BoopParams {
	/** Scale multiplier. Default: 1.05 */
	scale?: number;
	/** Rotation in degrees. Default: 0 */
	rotation?: number;
	/** How long the boop transform stays before resetting, in ms. Default: 300 */
	timing?: number;
}

export function boop(node: HTMLElement, params: BoopParams = {}) {
	if (isTouchDevice()) return { update() {}, destroy() {} };

	let { scale = 1.05, rotation = 0, timing = 300 } = params;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	function applyBoop() {
		if (timeoutId !== null) clearTimeout(timeoutId);

		const parts: string[] = [];
		if (scale !== 1) parts.push(`scale(${scale})`);
		if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);

		node.style.transition = `transform ${timing}ms var(--ease-bounce)`;
		node.style.transform = parts.join(' ') || 'none';

		timeoutId = setTimeout(() => {
			node.style.transform = '';
			timeoutId = null;
		}, timing);
	}

	node.addEventListener('mouseenter', applyBoop);

	return {
		update(newParams: BoopParams) {
			scale = newParams.scale ?? 1.05;
			rotation = newParams.rotation ?? 0;
			timing = newParams.timing ?? 300;
		},
		destroy() {
			node.removeEventListener('mouseenter', applyBoop);
			if (timeoutId !== null) clearTimeout(timeoutId);
		}
	};
}

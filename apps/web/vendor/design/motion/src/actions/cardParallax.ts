import { isPrefersReducedMotion } from '../stores/reducedMotion.js';

/**
 * `cardParallax` — Svelte action.
 *
 * Tracks cursor position inside the host element and writes two CSS custom
 * properties as clamped pixel offsets (max ±4px from center):
 *   --parallax-x, --parallax-y
 *
 * Consumers wire these onto inner elements (icon, title, etc.) via
 * `transform: translate(var(--parallax-x), var(--parallax-y))` for a subtle
 * in-card micro-parallax effect — the content drifts a few pixels toward
 * the cursor as it moves across the card.
 *
 * On pointerleave the vars reset to 0px so the inner elements snap back.
 * The action is a no-op under `prefers-reduced-motion: reduce` and on
 * touch-only devices (no `(hover: hover)` capability).
 *
 * Slice-23 Task 6.
 */

const MAX_OFFSET = 4; // px — clamp magnitude on each axis

export function cardParallax(node: HTMLElement) {
	if (typeof window === 'undefined') return { destroy: () => {} };
	if (isPrefersReducedMotion()) return { destroy: () => {} };
	if (!window.matchMedia('(hover: hover)').matches) return { destroy: () => {} };

	function onMove(e: PointerEvent) {
		const rect = node.getBoundingClientRect();
		// Cursor relative to card center, normalized to [-1, 1].
		const relX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
		const relY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
		node.style.setProperty('--parallax-x', `${(relX * MAX_OFFSET).toFixed(2)}px`);
		node.style.setProperty('--parallax-y', `${(relY * MAX_OFFSET).toFixed(2)}px`);
	}

	function onLeave() {
		node.style.setProperty('--parallax-x', '0px');
		node.style.setProperty('--parallax-y', '0px');
	}

	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerleave', onLeave);

	return {
		destroy() {
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerleave', onLeave);
		},
	};
}

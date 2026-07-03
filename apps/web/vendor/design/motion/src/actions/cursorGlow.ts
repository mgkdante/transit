// use:cursorGlow — pointer-following radial glow on cards.
//
// WHY: Static hover glows feel flat. Tracking the cursor creates a spotlight effect
// that makes cards feel interactive and spatial — like light reacting to your hand.
//
// Enhanced in 17a-2: auto-injects overlay DOM element. Consumers no longer need
// a manual <div> with radial-gradient — the action creates and manages it.
//
// Pattern: same as tilt.ts — event listeners, cleanup in destroy().
// Disabled on touch devices. SAFE-ALWAYS under reduced motion (GO-w2t5 retier).
//
// Usage: <div use:cursorGlow={{ intensity: 0.06 }}>
//   That's it — overlay is auto-injected.

import { isTouchDevice } from '../utils/device.js';

export interface CursorGlowParams {
	/** Glow radius in px (informational — used by CSS, not JS). Default: 200 */
	radius?: number;
	/** Glow intensity 0-1. Default: 0.06 */
	intensity?: number;
	/** Skip auto-inject overlay (for manual overlay usage). Default: false */
	noOverlay?: boolean;
}

export function cursorGlow(node: HTMLElement, params: CursorGlowParams = {}) {
	// SAFE-ALWAYS tier (GO-w2t5): the glow is an opacity-only gradient that
	// follows the pointer — nothing translates or scales. Touch-gated only.
	if (isTouchDevice()) {
		return { update() {}, destroy() {} };
	}

	const intensity = params.intensity ?? 0.06;
	let overlay: HTMLDivElement | null = null;

	// Auto-inject overlay unless opted out
	if (!params.noOverlay) {
		// Ensure node can contain absolute children
		const pos = getComputedStyle(node).position;
		if (pos === 'static') {
			node.style.position = 'relative';
		}

		overlay = document.createElement('div');
		overlay.setAttribute('aria-hidden', 'true');
		overlay.setAttribute('data-glow-overlay', '');
		Object.assign(overlay.style, {
			position: 'absolute',
			inset: '0',
			borderRadius: 'inherit',
			pointerEvents: 'none',
			opacity: '0',
			transition: 'opacity var(--duration-slow) ease',
			background: `radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--primary-rgb) / ${intensity}), transparent 60%)`,
		});
		node.appendChild(overlay);
	}

	function onPointerMove(e: PointerEvent) {
		const rect = node.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		node.style.setProperty('--glow-x', `${x}px`);
		node.style.setProperty('--glow-y', `${y}px`);
		if (overlay) overlay.style.opacity = '1';
	}

	function onPointerLeave() {
		node.style.removeProperty('--glow-x');
		node.style.removeProperty('--glow-y');
		if (overlay) overlay.style.opacity = '0';
	}

	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerleave', onPointerLeave);

	return {
		update(newParams: CursorGlowParams) {
			// Update intensity on the overlay if it changes
			if (overlay && newParams.intensity !== undefined) {
				overlay.style.background = `radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 50%), rgba(var(--primary-rgb) / ${newParams.intensity}), transparent 60%)`;
			}
		},
		destroy() {
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerleave', onPointerLeave);
			node.style.removeProperty('--glow-x');
			node.style.removeProperty('--glow-y');
			if (overlay) {
				overlay.remove();
				overlay = null;
			}
		}
	};
}

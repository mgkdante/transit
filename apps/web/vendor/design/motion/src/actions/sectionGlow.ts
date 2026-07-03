/**
 * `sectionGlow` — Svelte action.
 *
 * Tracks cursor position inside the host element via three CSS custom
 * properties:
 *   --glow-x, --glow-y    (percentages, 0%–100% within the host's box)
 *   --glow-opacity        (0 or 1, transitioned by consumer CSS)
 *
 * Consumers paint a radial gradient in a background layer (e.g. `::before`)
 * referencing those vars, e.g.:
 *
 *   .section::before {
 *     content: '';
 *     position: absolute;
 *     inset: 0;
 *     background: radial-gradient(circle at var(--glow-x) var(--glow-y),
 *       color-mix(in srgb, var(--primary) calc(var(--glow-opacity) * 10%), transparent),
 *       transparent 70%);
 *     opacity: var(--glow-opacity, 0);
 *     transition: opacity 200ms ease-out;
 *   }
 *
 * SAFE-ALWAYS tier (GO-w2t5): output is an alpha-only radial gradient, so
 * the action runs under `prefers-reduced-motion: reduce`. It remains a
 * no-op on touch-only devices (no `(hover: hover)` capability).
 *
 * Pointerleave debounce: the opacity flip to 0 is delayed 200ms so that
 * a moving cursor that briefly crosses the section boundary doesn't
 * trigger a flicker.
 *
 * Slice-23 Task 5.
 */
export function sectionGlow(node: HTMLElement) {
	if (typeof window === 'undefined') return { destroy: () => {} };
	if (!window.matchMedia('(hover: hover)').matches) return { destroy: () => {} };

	let leaveTimer: ReturnType<typeof setTimeout> | null = null;

	function onMove(e: PointerEvent) {
		if (leaveTimer) {
			clearTimeout(leaveTimer);
			leaveTimer = null;
		}
		const rect = node.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * 100;
		const y = ((e.clientY - rect.top) / rect.height) * 100;
		node.style.setProperty('--glow-x', `${x}%`);
		node.style.setProperty('--glow-y', `${y}%`);
		node.style.setProperty('--glow-opacity', '1');
	}

	function onLeave() {
		leaveTimer = setTimeout(() => {
			node.style.setProperty('--glow-opacity', '0');
			leaveTimer = null;
		}, 200);
	}

	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerleave', onLeave);

	return {
		destroy() {
			if (leaveTimer) clearTimeout(leaveTimer);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerleave', onLeave);
		},
	};
}

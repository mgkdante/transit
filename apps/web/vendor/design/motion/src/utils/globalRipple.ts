// Site-wide click ripple — spawns a two-ring expanding ripple at the pointer
// position on every pointerdown. The optional public stylesheet owns the
// corresponding outer and inner ring classes.
//
// Outer ring  — 200px max, brand-primary border, 1.2s expansion
// Inner ring  — 100px max, accent      border, 0.8s expansion
//
// Mobile: pointerdown fires on touch, so taps trigger it too. The
// elements are position: fixed (relative to viewport) so they stay
// where the user pressed even if a mid-ripple scroll happens.
//
// Reduced-motion: the click ripple stays active because it is user-initiated,
// brief (<1.2s) and not a vestibular trigger.

const OUTER_DURATION_MS = 1200;
const INNER_DURATION_MS = 800;

export function initGlobalRipple(options: { exclude?: string } = {}): () => void {
	if (typeof window === 'undefined') return () => {};

	function spawnRipple(x: number, y: number) {
		const outer = document.createElement('div');
		outer.className = 'global-ripple';
		outer.style.left = `${x}px`;
		outer.style.top = `${y}px`;
		document.body.appendChild(outer);
		window.setTimeout(() => outer.remove(), OUTER_DURATION_MS);

		const inner = document.createElement('div');
		inner.className = 'global-ripple-inner';
		inner.style.left = `${x}px`;
		inner.style.top = `${y}px`;
		document.body.appendChild(inner);
		window.setTimeout(() => inner.remove(), INNER_DURATION_MS);
	}

	function onPointerDown(e: PointerEvent) {
		if (
			options.exclude &&
			e.target instanceof Element &&
			e.target.closest(options.exclude)
		) {
			return;
		}
		spawnRipple(e.clientX, e.clientY);
	}

	window.addEventListener('pointerdown', onPointerDown, { passive: true });

	return () => {
		window.removeEventListener('pointerdown', onPointerDown);
	};
}

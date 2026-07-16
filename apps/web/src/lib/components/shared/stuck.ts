// Sticky "stuck" detection — reports when a `position: sticky` element has
// pinned to its offset so the surface can flush it tight under the floating
// chrome (no dead padding band). ONE reusable observer for every sticky rail;
// same IntersectionObserver idiom as observeActiveToc (shared/toc.ts).
//
// Mechanism: an absolutely-positioned sentinel is inserted into the sticky
// element's parent, anchored at the sticky element's NATURAL (unpinned) top
// (`offsetTop`). It must be absolute — NOT a flex child in the normal flow —
// because parents here are flex columns with a large `gap`, and a flow sibling
// would open a dead gap band (the exact thing B2 kills). Being absolute it is
// out of flow (no gap), and it does NOT pin with the sticky box, so it marks a
// fixed point in the scroll content. Once that point scrolls above the pin line
// (`top: var(--chrome-offset)`), the sticky box has pinned → stuck. `rootMargin`
// = the negative chrome offset makes the trip point exactly the pin line.

import { findScrollParent } from './viewportPresence';

/** Observe a sticky element and toggle `data-stuck="true|false"` on it as it
 *  pins / unpins under the chrome. Returns a cleanup fn for onMount/$effect.
 *  No-op (returns a bare cleanup) when IntersectionObserver is unavailable. */
export function observeStuck(el: HTMLElement): () => void {
	const parent = el.parentElement;
	if (typeof IntersectionObserver === 'undefined' || !parent) return () => {};

	// The sentinel must anchor to the sticky box's offset parent; ensure the
	// parent is a positioned containing block (only add relative if it is static).
	const parentPosition = getComputedStyle(parent).position;
	const addedRelative = parentPosition === 'static';
	if (addedRelative) parent.style.position = 'relative';

	// Absolute, out-of-flow (no flex gap), pinned to the sticky box's natural top.
	// Full-width + 1px tall so it has real intersectable area (a 0/1px-wide target
	// inside a scroll container can go unreported).
	const sentinel = document.createElement('div');
	sentinel.setAttribute('aria-hidden', 'true');
	sentinel.style.cssText = `position:absolute;left:0;right:0;height:1px;pointer-events:none;top:${el.offsetTop}px;`;
	parent.appendChild(sentinel);

	// Trip line = the used `top` (var(--chrome-offset) resolved to px by the UA).
	const raw = getComputedStyle(el).getPropertyValue('top').trim();
	const topPx = raw.endsWith('px') ? parseFloat(raw) : 0;

	// Root = the nearest scrolling ancestor (transit scrolls inside #main, not the
	// window), so the observer fires as the sentinel crosses the pin line.
	const scrollRoot = findScrollParent(el);

	const observer = new IntersectionObserver(
		([entry]) => {
			// When the sentinel scrolls past the pin line (no longer intersecting the
			// margin-shrunk root), the host has pinned → stuck.
			el.setAttribute('data-stuck', entry.isIntersecting ? 'false' : 'true');
		},
		{
			root: scrollRoot,
			rootMargin: `-${Number.isFinite(topPx) ? topPx : 0}px 0px 0px 0px`,
			threshold: 0,
		},
	);
	observer.observe(sentinel);

	return () => {
		observer.disconnect();
		sentinel.remove();
		if (addedRelative) parent.style.position = parentPosition;
	};
}

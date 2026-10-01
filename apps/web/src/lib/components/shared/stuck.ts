import { findScrollParent } from './viewportPresence';

export function observeStuck(el: HTMLElement): () => void {
	const parent = el.parentElement;
	if (typeof IntersectionObserver === 'undefined' || !parent) return () => {};

	const parentPosition = getComputedStyle(parent).position;
	const addedRelative = parentPosition === 'static';
	if (addedRelative) parent.style.position = 'relative';

	const sentinel = document.createElement('div');
	sentinel.setAttribute('aria-hidden', 'true');
	sentinel.style.cssText = `position:absolute;left:0;right:0;height:1px;pointer-events:none;top:${el.offsetTop}px;`;
	parent.appendChild(sentinel);

	const raw = getComputedStyle(el).getPropertyValue('top').trim();
	const topPx = raw.endsWith('px') ? parseFloat(raw) : 0;

	const scrollRoot = findScrollParent(el);

	const observer = new IntersectionObserver(
		([entry]) => {
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

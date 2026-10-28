import { isPrefersReducedMotion } from '../stores/reducedMotion.js';
import { isViewportAtMost } from './device.js';

/**
 * Draws the blueprint art in `band` (`.blueprint-bg svg path`) as `trigger` scrolls through the
 * viewport: nothing while it is below the fold, everything once it has left the top. Redraws when
 * `trigger` resizes, so content rendered after mount can't leave a stale first draw. Fits
 * `ListingFrame`'s `onHeaderMount={blueprintScrub}`, which passes the header and the frame.
 * Scrolls of any inner scroller count. Off under reduced motion and at 1023px and below, where
 * the art stays fully drawn. Returns the cleanup.
 */
export function blueprintScrub(band: HTMLElement, trigger: HTMLElement = band): (() => void) | undefined {
	if (typeof window === 'undefined') return undefined;
	if (isPrefersReducedMotion() || isViewportAtMost(1023)) return undefined;

	const paths = Array.from(band.querySelectorAll<SVGPathElement>('.blueprint-bg svg path'));
	const lengths = paths.map((path) => {
		try {
			return path.getTotalLength();
		} catch {
			return 0;
		}
	});
	if (!lengths.some((length) => length > 0)) return undefined;

	function apply(): void {
		const rect = trigger.getBoundingClientRect();
		const total = window.innerHeight + rect.height;
		const progress = total <= 0 ? 1 : Math.min(1, Math.max(0, (window.innerHeight - rect.top) / total));
		paths.forEach((path, i) => {
			if (lengths[i] <= 0) return;
			path.style.strokeDasharray = `${lengths[i] * progress}px, ${lengths[i]}px`;
			path.style.strokeDashoffset = '0';
		});
	}

	let frame = 0;
	function onScroll(): void {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			apply();
		});
	}

	const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onScroll);
	resize?.observe(trigger);
	apply();
	document.addEventListener('scroll', onScroll, { capture: true, passive: true });
	window.addEventListener('resize', onScroll, { passive: true });

	return () => {
		document.removeEventListener('scroll', onScroll, { capture: true });
		window.removeEventListener('resize', onScroll);
		resize?.disconnect();
		if (frame) cancelAnimationFrame(frame);
	};
}

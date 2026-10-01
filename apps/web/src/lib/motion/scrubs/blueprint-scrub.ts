import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
import { isViewportAtMost } from '@yesid/motion/utils/device';

export function startBlueprintScrub(bandEl: HTMLElement): (() => void) | undefined {
	if (typeof window === 'undefined') return undefined;
	if (isPrefersReducedMotion() || isViewportAtMost(1023)) return undefined;

	const paths = Array.from(bandEl.querySelectorAll<SVGPathElement>('.blueprint-bg svg path'));
	const lengths = paths.map((p) => {
		try {
			return p.getTotalLength();
		} catch {
			return 0;
		}
	});
	if (!lengths.some((l) => l > 0)) return undefined;

	function progress(): number {
		const r = bandEl.getBoundingClientRect();
		const total = window.innerHeight + r.height;
		if (total <= 0) return 1;
		return Math.min(1, Math.max(0, (window.innerHeight - r.top) / total));
	}

	function apply(p: number): void {
		for (let i = 0; i < paths.length; i += 1) {
			const length = lengths[i];
			if (length <= 0) continue;
			paths[i].style.strokeDasharray = `${length * p}px, ${length}px`;
			paths[i].style.strokeDashoffset = '0';
		}
	}

	let raf = 0;
	function onScroll(): void {
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			apply(progress());
		});
	}

	apply(progress());
	document.addEventListener('scroll', onScroll, { capture: true, passive: true });
	window.addEventListener('resize', onScroll, { passive: true });

	return () => {
		document.removeEventListener('scroll', onScroll, { capture: true });
		window.removeEventListener('resize', onScroll);
		if (raf) cancelAnimationFrame(raf);
	};
}

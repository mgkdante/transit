import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
import { isTouchDevice } from '@yesid/motion/utils/device';

type Chars = Element[];
type EffectFn = (chars: Chars, gsap: typeof import('gsap').gsap) => gsap.core.Timeline;

const effectBounce: EffectFn = (chars, gsap) =>
	gsap
		.timeline()
		.fromTo(chars, { y: 0 }, { y: -15, stagger: 0.04, duration: 0.3, ease: 'back.out(1.7)' })
		.to(chars, { y: 0, stagger: 0.04, duration: 0.3, ease: 'power2.out' }, '>-0.15');

const effectWiggle: EffectFn = (chars, gsap) =>
	gsap
		.timeline()
		.to(chars, { rotation: 12, stagger: 0.03, duration: 0.15, ease: 'power1.out' })
		.to(chars, { rotation: -12, stagger: 0.03, duration: 0.15, ease: 'power1.out' })
		.to(chars, { rotation: 0, stagger: 0.03, duration: 0.3, ease: 'elastic.out(1, 0.3)' });

const effectWave: EffectFn = (chars, gsap) =>
	gsap.timeline().to(chars, {
		y: -10,
		stagger: { each: 0.05, from: 'start' },
		duration: 0.25,
		ease: 'sine.out',
		yoyo: true,
		repeat: 1,
	});

const effectSpin: EffectFn = (chars, gsap) =>
	gsap
		.timeline()
		.to(chars, { rotation: 360, stagger: 0.05, duration: 0.5, ease: 'power2.inOut' })
		.set(chars, { rotation: 0 });

const EFFECTS: readonly EffectFn[] = [effectBounce, effectWiggle, effectWave, effectSpin];

export function easterWordHover(
	node: HTMLElement,
	params: { startEffect?: number; autoPlay?: boolean; autoPlayDelay?: number } = {},
): { destroy(): void } {
	if (typeof window === 'undefined') return { destroy() {} };
	if (isTouchDevice() || isPrefersReducedMotion()) return { destroy() {} };

	let effectIndex =
		(((params.startEffect ?? 0) % EFFECTS.length) + EFFECTS.length) % EFFECTS.length;
	let isAnimating = false;
	let destroyed = false;
	let autoId: ReturnType<typeof setTimeout> | undefined;
	let split: { chars: Element[]; revert(): void } | null = null;
	let gsapRef: typeof import('gsap').gsap | null = null;

	async function ensureLoaded(): Promise<boolean> {
		if (split && gsapRef) return true;
		try {
			const { gsap, SplitText, ensureSplitTextRegistered } =
				await import('@yesid/motion/utils/gsap');
			if (destroyed) return false;
			ensureSplitTextRegistered();
			gsapRef = gsap;
			split = new SplitText(node, { type: 'chars' }) as unknown as {
				chars: Element[];
				revert(): void;
			};
			return true;
		} catch {
			return false;
		}
	}

	async function playEffect(): Promise<void> {
		if (isAnimating || destroyed) return;
		if (!(await ensureLoaded())) return;
		if (destroyed || !split || !gsapRef) return;
		isAnimating = true;
		const tl = EFFECTS[effectIndex](split.chars, gsapRef);
		effectIndex = (effectIndex + 1) % EFFECTS.length;
		tl.then(() => {
			isAnimating = false;
		});
	}

	node.addEventListener('mouseenter', playEffect);

	if (params.autoPlay) {
		autoId = setTimeout(() => void playEffect(), params.autoPlayDelay ?? 500);
	}

	return {
		destroy() {
			destroyed = true;
			if (autoId) clearTimeout(autoId);
			node.removeEventListener('mouseenter', playEffect);
			split?.revert();
		},
	};
}

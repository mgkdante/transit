import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BrandWordmark from './BrandWordmark.svelte';

const motion = vi.hoisted(() => {
	const destroy = vi.fn();
	return {
		reduced: false,
		touch: false,
		destroy,
		wordmarkHover: vi.fn(() => ({ destroy })),
	};
});

vi.mock('@yesid/motion/stores/reducedMotion', () => ({
	isPrefersReducedMotion: () => motion.reduced,
}));
vi.mock('@yesid/motion/utils/device', () => ({
	isTouchDevice: () => motion.touch,
}));
vi.mock('@yesid/motion/actions', () => ({
	wordmarkHover: motion.wordmarkHover,
}));

describe('BrandWordmark motion boundary', () => {
	beforeEach(() => {
		motion.reduced = false;
		motion.touch = false;
		motion.destroy.mockClear();
		motion.wordmarkHover.mockClear();
	});

	afterEach(() => cleanup());

	it.each([
		{ name: 'animation is disabled', props: { animate: false } },
		{ name: 'reduced motion is requested', props: {}, reduced: true },
		{ name: 'the device is touch-first', props: {}, touch: true },
	])('does not load the GSAP action when $name', async ({ props, reduced, touch }) => {
		motion.reduced = reduced ?? false;
		motion.touch = touch ?? false;
		render(BrandWordmark, { props });
		await Promise.resolve();

		expect(motion.wordmarkHover).not.toHaveBeenCalled();
	});

	it('loads the upstream action off the critical path and destroys it on unmount', async () => {
		const view = render(BrandWordmark);

		await waitFor(() => expect(motion.wordmarkHover).toHaveBeenCalledTimes(1));
		view.unmount();

		expect(motion.destroy).toHaveBeenCalledTimes(1);
	});
});

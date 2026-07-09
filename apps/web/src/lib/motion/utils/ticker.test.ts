import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import { _resetForTests, subscribe, unsubscribe } from './ticker';

describe('motion/utils/ticker', () => {
	let internalCallback: Parameters<typeof gsap.ticker.add>[0] | null = null;

	beforeEach(() => {
		_resetForTests();
		internalCallback = null;
		vi.restoreAllMocks();
		vi.spyOn(gsap.ticker, 'add').mockImplementation((callback) => {
			internalCallback = callback;
			return callback;
		});
		vi.spyOn(gsap.ticker, 'remove').mockImplementation(() => gsap.ticker);
	});

	it('fans every subscriber out from one GSAP ticker subscription', () => {
		const first = vi.fn();
		const second = vi.fn();
		subscribe('first', first);
		subscribe('second', second);

		expect(gsap.ticker.add).toHaveBeenCalledTimes(1);
		internalCallback?.(1, 16.67, 1, 16.67);
		expect(first).toHaveBeenCalledWith(1, 16.67);
		expect(second).toHaveBeenCalledWith(1, 16.67);
	});

	it('replaces a duplicate id with the latest callback', () => {
		const first = vi.fn();
		const replacement = vi.fn();
		subscribe('same', first);
		subscribe('same', replacement);

		internalCallback?.(2, 16.67, 2, 16.67);
		expect(first).not.toHaveBeenCalled();
		expect(replacement).toHaveBeenCalledWith(2, 16.67);
	});

	it('supports explicit unsubscribe and the returned disposer', () => {
		const explicit = vi.fn();
		const disposed = vi.fn();
		subscribe('explicit', explicit);
		const stop = subscribe('disposed', disposed);
		unsubscribe('explicit');
		stop();

		internalCallback?.(3, 16.67, 3, 16.67);
		expect(explicit).not.toHaveBeenCalled();
		expect(disposed).not.toHaveBeenCalled();
	});

	it('reset removes the single GSAP subscription and clears subscribers', () => {
		const callback = vi.fn();
		subscribe('reset-me', callback);
		const registered = internalCallback;

		_resetForTests();
		expect(gsap.ticker.remove).toHaveBeenCalledTimes(1);
		expect(gsap.ticker.remove).toHaveBeenCalledWith(registered);
		registered?.(4, 16.67, 4, 16.67);
		expect(callback).not.toHaveBeenCalled();
	});
});

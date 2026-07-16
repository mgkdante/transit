import { afterEach, describe, expect, it, vi } from 'vitest';
import { findScrollParent, observeViewportPresence } from './viewportPresence';

let callback: IntersectionObserverCallback | undefined;
const observe = vi.fn();
const disconnect = vi.fn();
let options: IntersectionObserverInit | undefined;

class IntersectionObserverStub {
	readonly root = null;
	readonly rootMargin = '0px';
	readonly thresholds = [0];

	constructor(next: IntersectionObserverCallback, nextOptions?: IntersectionObserverInit) {
		callback = next;
		options = nextOptions;
	}

	observe = observe;
	unobserve = vi.fn();
	disconnect = disconnect;
	takeRecords = () => [];
}

afterEach(() => {
	vi.unstubAllGlobals();
	callback = undefined;
	options = undefined;
	observe.mockClear();
	disconnect.mockClear();
	document.body.replaceChildren();
});

describe('viewport presence', () => {
	it('uses the nearest internal vertical scroller and reports entry and exit', () => {
		vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
		const scroller = document.createElement('main');
		scroller.style.overflowY = 'auto';
		const target = document.createElement('section');
		scroller.append(target);
		document.body.append(scroller);
		const onChange = vi.fn();

		const action = observeViewportPresence(target, onChange);

		expect(findScrollParent(target)).toBe(scroller);
		expect(options).toMatchObject({ root: scroller, threshold: 0 });
		expect(observe).toHaveBeenCalledWith(target);

		callback?.(
			[{ target, isIntersecting: true } as unknown as IntersectionObserverEntry],
			{} as IntersectionObserver,
		);
		callback?.(
			[{ target, isIntersecting: false } as unknown as IntersectionObserverEntry],
			{} as IntersectionObserver,
		);
		expect(onChange.mock.calls).toEqual([[true], [false]]);

		action.destroy();
		expect(disconnect).toHaveBeenCalledOnce();
	});

	it('falls back to visible controls when IntersectionObserver is unavailable', () => {
		vi.stubGlobal('IntersectionObserver', undefined);
		const target = document.createElement('section');
		const onChange = vi.fn();

		const action = observeViewportPresence(target, onChange);

		expect(onChange).toHaveBeenCalledWith(true);
		expect(() => action.destroy()).not.toThrow();
	});
});

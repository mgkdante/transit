// SPA View Transitions guard — unit coverage for the `onNavigate` decision.
//
// Runs in the "data" (node) project, where `document`/`window` are absent by
// default, so we stub the exact globals the helper feature-detects:
//   - `document.startViewTransition` (API support), and
//   - `window.matchMedia('(prefers-reduced-motion: reduce)')` (via
//     `isPrefersReducedMotion`, which the helper consults).
// Asserts the helper returns early (instant SvelteKit swap) when the API is
// absent OR the user prefers reduced motion, and only then drives a transition.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { runViewTransition, shouldRunViewTransition } from './view-transition';

type MatchMediaResult = { matches: boolean };

function stubEnvironment(opts: { hasViewTransition: boolean; reducedMotion: boolean }): {
	startViewTransition: ReturnType<typeof vi.fn>;
} {
	const startViewTransition = vi.fn((cb: () => unknown) => {
		// Mirror the real API enough for the helper: run the callback and hand
		// back a transition-like object. The callback's returned promise settles
		// independently; the helper only needs `startViewTransition` to be called.
		void cb();
		return {
			finished: Promise.resolve(),
			ready: Promise.resolve(),
			updateCallbackDone: Promise.resolve(),
		};
	});

	vi.stubGlobal('document', opts.hasViewTransition ? { startViewTransition } : {});
	vi.stubGlobal('window', {
		matchMedia: (query: string): MatchMediaResult => ({
			matches: query.includes('reduce') ? opts.reducedMotion : false,
		}),
	});

	return { startViewTransition };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('shouldRunViewTransition', () => {
	it('is false when document is undefined (SSR / no DOM)', () => {
		vi.stubGlobal('document', undefined);
		expect(shouldRunViewTransition()).toBe(false);
	});

	it('is false when startViewTransition is unsupported', () => {
		stubEnvironment({ hasViewTransition: false, reducedMotion: false });
		expect(shouldRunViewTransition()).toBe(false);
	});

	it('is false when the user prefers reduced motion', () => {
		stubEnvironment({ hasViewTransition: true, reducedMotion: true });
		expect(shouldRunViewTransition()).toBe(false);
	});

	it('is true when supported and motion is allowed', () => {
		stubEnvironment({ hasViewTransition: true, reducedMotion: false });
		expect(shouldRunViewTransition()).toBe(true);
	});
});

describe('runViewTransition', () => {
	const navigation = { complete: Promise.resolve() };

	it('returns undefined (instant swap) when the API is unsupported', () => {
		const { startViewTransition } = stubEnvironment({
			hasViewTransition: false,
			reducedMotion: false,
		});
		expect(runViewTransition(navigation)).toBeUndefined();
		expect(startViewTransition).not.toHaveBeenCalled();
	});

	it('returns undefined (instant swap) under reduced motion', () => {
		const { startViewTransition } = stubEnvironment({
			hasViewTransition: true,
			reducedMotion: true,
		});
		expect(runViewTransition(navigation)).toBeUndefined();
		expect(startViewTransition).not.toHaveBeenCalled();
	});

	it('drives a transition and resolves once the swap is committed', async () => {
		const { startViewTransition } = stubEnvironment({
			hasViewTransition: true,
			reducedMotion: false,
		});
		const result = runViewTransition(navigation);
		expect(result).toBeInstanceOf(Promise);
		expect(startViewTransition).toHaveBeenCalledTimes(1);
		await expect(result).resolves.toBeUndefined();
	});
});

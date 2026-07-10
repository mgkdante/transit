// toc.test.ts - the shared TOC model + DOM helpers.
//
// Gates:
//   - flattenToc orders parents then their children into one flat list (drives
//     the "N / total" counter + active lookup);
//   - tocElement resolves the data-toc anchor scheme (the one CollapsibleSection
//     emits) and falls back to a plain element id;
//   - observeActiveToc returns a no-op cleanup when there are no targets (the
//     IntersectionObserver path needs a browser, exercised in the render tests).

import { describe, it, expect, vi } from 'vitest';
import {
	flattenToc,
	resolveTocCounter,
	tocElement,
	settleLayout,
	observeActiveToc,
	type TocEntry,
} from './toc';

const entry = (id: string, title: string, children: TocEntry[] = []): TocEntry => ({
	id,
	title,
	level: 2,
	children,
});

describe('flattenToc', () => {
	it('flattens parents then children in order', () => {
		const entries: TocEntry[] = [
			entry('a', 'Alpha', [entry('a1', 'Alpha sub')]),
			entry('b', 'Bravo'),
		];
		expect(flattenToc(entries).map((e) => e.id)).toEqual(['a', 'a1', 'b']);
	});

	it('returns an empty list for no entries', () => {
		expect(flattenToc([])).toEqual([]);
	});
});

describe('resolveTocCounter', () => {
	it('uses canonical badges for a gapped flat numbered run', () => {
		const entries: TocEntry[] = [
			{ ...entry('freshness', 'Freshness'), badge: { kind: 'number', value: 2 } },
			{ ...entry('envelope', 'Build accountability'), badge: { kind: 'number', value: 8 } },
		];
		expect(resolveTocCounter(entries, 'freshness')).toEqual({ current: 2, total: 8 });
	});

	it('keeps positional counting for mixed badge runs', () => {
		const entries: TocEntry[] = [
			{ ...entry('overview', 'Overview'), badge: { kind: 'icon', name: 'eye' } },
			{ ...entry('metric', 'Metric'), badge: { kind: 'number', value: 4 } },
		];
		expect(resolveTocCounter(entries, 'metric')).toEqual({ current: 2, total: 2 });
	});
});

describe('tocElement', () => {
	it('resolves a data-toc anchor to its element', () => {
		const el = document.createElement('section');
		el.setAttribute('data-toc', 'overview');
		document.body.appendChild(el);
		expect(tocElement('overview')).toBe(el);
		document.body.removeChild(el);
	});

	it('falls back to a plain element id', () => {
		const el = document.createElement('h2');
		el.id = 'plain-heading';
		document.body.appendChild(el);
		expect(tocElement('plain-heading')).toBe(el);
		document.body.removeChild(el);
	});

	it('returns null when nothing matches', () => {
		expect(tocElement('does-not-exist')).toBeNull();
	});
});

describe('observeActiveToc', () => {
	it('returns a no-op cleanup when there are no TOC targets', () => {
		const cleanup = observeActiveToc(() => {});
		expect(typeof cleanup).toBe('function');
		// Must not throw.
		cleanup();
	});
});

describe('settleLayout', () => {
	it('resolves immediately for a null target', async () => {
		await expect(settleLayout(null)).resolves.toBeUndefined();
	});

	it('waits until the nearest scroll container height stops changing', async () => {
		const scroller = document.createElement('div');
		scroller.style.overflowY = 'auto';
		const target = document.createElement('div');
		scroller.appendChild(target);
		document.body.appendChild(scroller);
		// Height grows for three frames (an expanding disclosure), then stabilizes.
		let reads = 0;
		Object.defineProperty(scroller, 'scrollHeight', {
			configurable: true,
			get: () => {
				reads += 1;
				return reads < 4 ? reads * 100 : 400;
			},
		});
		try {
			await settleLayout(target);
			// Kept polling frames until two consecutive stable readings (4, 5, 6).
			expect(reads).toBeGreaterThanOrEqual(5);
		} finally {
			document.body.removeChild(scroller);
		}
	});

	it('does not declare stability before a delayed transition begins', async () => {
		const scroller = document.createElement('div');
		scroller.style.overflowY = 'auto';
		const target = document.createElement('div');
		scroller.appendChild(target);
		document.body.appendChild(scroller);
		let reads = 0;
		Object.defineProperty(scroller, 'scrollHeight', {
			configurable: true,
			get: () => {
				reads += 1;
				if (reads <= 4) return 100;
				if (reads === 5) return 200;
				if (reads === 6) return 300;
				return 400;
			},
		});
		try {
			await settleLayout(target);
			expect(reads).toBeGreaterThanOrEqual(8);
		} finally {
			document.body.removeChild(scroller);
		}
	});

	it('gives up at the max wait when the height never stabilizes', async () => {
		const scroller = document.createElement('div');
		scroller.style.overflowY = 'auto';
		const target = document.createElement('div');
		scroller.appendChild(target);
		document.body.appendChild(scroller);
		let height = 0;
		Object.defineProperty(scroller, 'scrollHeight', {
			configurable: true,
			get: () => (height += 10),
		});
		try {
			const started = performance.now();
			await settleLayout(target, 150);
			expect(performance.now() - started).toBeLessThan(5000);
		} finally {
			document.body.removeChild(scroller);
		}
	});

	it('honors the hard cap when animation frames stop firing', async () => {
		vi.useFakeTimers();
		const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
		const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
		globalThis.requestAnimationFrame = vi.fn(() => 7);
		globalThis.cancelAnimationFrame = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		let resolved = false;
		try {
			void settleLayout(target, 150).then(() => {
				resolved = true;
			});
			await vi.advanceTimersByTimeAsync(151);
			expect(resolved).toBe(true);
		} finally {
			document.body.removeChild(target);
			globalThis.requestAnimationFrame = originalRequestAnimationFrame;
			globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
			vi.useRealTimers();
		}
	});
});

// toc.test.ts - the shared TOC model + DOM helpers.
//
// Gates:
//   - flattenToc orders parents then their children into one flat list (drives
//     the "N / total" counter + active lookup);
//   - tocElement resolves the data-toc anchor scheme (the one CollapsibleSection
//     emits) and falls back to a plain element id;
//   - observeActiveToc returns a no-op cleanup when there are no targets (the
//     IntersectionObserver path needs a browser, exercised in the render tests).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tick } from 'svelte';
import { describe, it, expect, vi } from 'vitest';
import {
	flattenToc,
	resolveTocCounter,
	tocElement,
	settleLayout,
	observeActiveToc,
	revealTocTarget,
	openCollapsedTocTarget,
	reconcileActiveToc,
	type TocEntry,
} from './toc';

const entry = (id: string, title: string, children: TocEntry[] = []): TocEntry => ({
	id,
	title,
	level: 2,
	children,
});

describe('TocBadgeSpec authority', () => {
	it('re-exports the upstream package type instead of maintaining a local union', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/lib/components/shared/toc.ts'), 'utf8');

		expect(source).toMatch(
			/import\s+type\s+\{\s*TocBadgeSpec\s*\}\s+from\s+['"]@yesid\/ui\/brand['"]/,
		);
		expect(source).toMatch(/export\s+type\s+\{\s*TocBadgeSpec\s*\}/);
		expect(source).not.toContain("from './SectionIcon.svelte'");
		expect(source).not.toMatch(/export\s+type\s+TocBadgeSpec\s*=/);
	});
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

describe('openCollapsedTocTarget', () => {
	it('opens only the owning shared disclosure before a TOC jump', () => {
		const target = document.createElement('section');
		target.setAttribute('data-toc', 'collapsed-section');
		const trigger = document.createElement('button');
		trigger.setAttribute('data-section-trigger', '');
		trigger.setAttribute('aria-expanded', 'false');
		const click = vi.spyOn(trigger, 'click');
		target.appendChild(trigger);
		document.body.appendChild(target);

		try {
			expect(openCollapsedTocTarget('collapsed-section')).toBe(true);
			expect(click).toHaveBeenCalledOnce();
			expect(openCollapsedTocTarget('missing-section')).toBe(false);
		} finally {
			target.remove();
		}
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

	it('skips the transition-start grace when reduced motion is active', async () => {
		const media = vi
			.spyOn(window, 'matchMedia')
			.mockReturnValue({ matches: true } as MediaQueryList);
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
				return 400;
			},
		});
		try {
			await settleLayout(target);
			expect(reads).toBe(3);
		} finally {
			media.mockRestore();
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

describe('revealTocTarget', () => {
	it('runs beforeReveal before looking up the target', async () => {
		const target = document.createElement('section');
		target.scrollIntoView = vi.fn();
		const media = vi
			.spyOn(window, 'matchMedia')
			.mockReturnValue({ matches: true } as MediaQueryList);
		const beforeReveal = vi.fn((id: string) => {
			expect(id).toBe('late-target');
			expect(tocElement(id)).toBeNull();
			target.setAttribute('data-toc', id);
			document.body.appendChild(target);
		});
		try {
			await expect(
				revealTocTarget('late-target', { beforeReveal, behavior: 'auto' }),
			).resolves.toBe(true);
			expect(beforeReveal).toHaveBeenCalledOnce();
			expect(target.scrollIntoView).toHaveBeenCalledOnce();
		} finally {
			media.mockRestore();
			target.remove();
		}
	});

	it('waits for layout settlement before scrolling', async () => {
		const target = document.createElement('section');
		target.setAttribute('data-toc', 'settling-target');
		target.scrollIntoView = vi.fn();
		document.body.appendChild(target);
		const frames: FrameRequestCallback[] = [];
		const media = vi
			.spyOn(window, 'matchMedia')
			.mockReturnValue({ matches: true } as MediaQueryList);
		const requestFrame = vi
			.spyOn(globalThis, 'requestAnimationFrame')
			.mockImplementation((callback) => {
				frames.push(callback);
				return frames.length;
			});
		const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
		try {
			const result = revealTocTarget('settling-target', { behavior: 'smooth' });
			await tick();
			expect(target.scrollIntoView).not.toHaveBeenCalled();
			expect(frames).toHaveLength(1);

			frames.shift()?.(performance.now());
			frames.shift()?.(performance.now());
			expect(target.scrollIntoView).not.toHaveBeenCalled();

			frames.shift()?.(performance.now());
			await expect(result).resolves.toBe(true);
			expect(target.scrollIntoView).toHaveBeenCalledOnce();
		} finally {
			cancelFrame.mockRestore();
			requestFrame.mockRestore();
			media.mockRestore();
			target.remove();
		}
	});

	it.each(['smooth', 'auto'] as const)(
		'passes %s scroll behavior through unchanged',
		async (behavior) => {
			const target = document.createElement('section');
			target.setAttribute('data-toc', `${behavior}-target`);
			target.scrollIntoView = vi.fn();
			document.body.appendChild(target);
			const media = vi
				.spyOn(window, 'matchMedia')
				.mockReturnValue({ matches: true } as MediaQueryList);
			try {
				await revealTocTarget(`${behavior}-target`, { behavior });
				expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior, block: 'start' });
			} finally {
				media.mockRestore();
				target.remove();
			}
		},
	);

	it('cancels a stale scroll when isCurrent returns false', async () => {
		const target = document.createElement('section');
		target.setAttribute('data-toc', 'stale-target');
		target.scrollIntoView = vi.fn();
		document.body.appendChild(target);
		const media = vi
			.spyOn(window, 'matchMedia')
			.mockReturnValue({ matches: true } as MediaQueryList);
		const isCurrent = vi.fn(() => false);
		try {
			await expect(
				revealTocTarget('stale-target', { isCurrent, behavior: 'smooth' }),
			).resolves.toBe(false);
			expect(isCurrent).toHaveBeenCalledOnce();
			expect(target.scrollIntoView).not.toHaveBeenCalled();
		} finally {
			media.mockRestore();
			target.remove();
		}
	});

	it('returns false without throwing when the target is missing', async () => {
		await expect(revealTocTarget('missing-target', { behavior: 'auto' })).resolves.toBe(false);
	});
});

describe('reconcileActiveToc', () => {
	it('keeps an active id that still exists', () => {
		expect(reconcileActiveToc('coverage', ['overview', 'coverage'], ['coverage'])).toBe('coverage');
	});

	it('chooses the surviving id with the smallest distance in the previous order', () => {
		expect(
			reconcileActiveToc(
				'coverage',
				['overview', 'intro', 'coverage', 'freshness', 'envelope'],
				['overview', 'envelope', 'freshness'],
			),
		).toBe('freshness');
	});

	it('uses the first new id when no previous relationship exists', () => {
		expect(reconcileActiveToc('removed', ['old'], ['new-first', 'new-second'])).toBe('new-first');
	});

	it('returns an empty string when no cards remain', () => {
		expect(reconcileActiveToc('coverage', ['coverage'], [])).toBe('');
	});
});

// toc.test.ts - the shared TOC model + DOM helpers.
//
// Gates:
//   - flattenToc orders parents then their children into one flat list (drives
//     the "N / total" counter + active lookup);
//   - tocElement resolves the data-toc anchor scheme (the one CollapsibleSection
//     emits) and falls back to a plain element id;
//   - observeActiveToc returns a no-op cleanup when there are no targets (the
//     IntersectionObserver path needs a browser, exercised in the render tests).

import { describe, it, expect } from 'vitest';
import { flattenToc, tocElement, observeActiveToc, type TocEntry } from './toc';

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

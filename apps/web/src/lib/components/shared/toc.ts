// Shared table-of-contents model + DOM helpers. ONE source for every detail
// page's TOC (e.g. /metrics). The desktop nav (TocNav) and the mobile floating
// pill (TocPill) both consume this, so a card and its TOC entry always render
// the SAME badge (systematic, no ad-hoc per-page copies).
//
// Ported from yesid.dev shared/toc.ts. The observer selector is adapted to
// transit's anchor reality: CollapsibleSection emits `data-toc="<id>"`, so that
// is the primary scheme. `data-section-index` / `section-N` and plain element
// ids are kept so the resolver stays general across future surfaces.

import type { SectionIconName } from './SectionIcon.svelte';

/** A TOC entry's leading mark. Mirrors the badge on the matching section card:
 *  a numbered card (`index`) -> number; an icon card -> the same SectionIcon shape. */
export type TocBadgeSpec =
	| { kind: 'number'; value: number }
	| { kind: 'icon'; name: SectionIconName };

export interface TocEntry {
	id: string;
	title: string;
	level: number;
	/** Leading badge; omitted for nested sub-headings. */
	badge?: TocBadgeSpec;
	/** True for sections that live in the desktop SIDE RAIL. The desktop TocNav
	 *  omits these (the rail already shows them); the mobile TocPill keeps them
	 *  (there they sit in the page flow). */
	rail?: boolean;
	children: TocEntry[];
}

/** Flatten entries + their children into one ordered list for the "N / total"
 *  counter and the active-entry lookup. */
export function flattenToc(entries: TocEntry[]): TocEntry[] {
	const flat: TocEntry[] = [];
	for (const entry of entries) {
		flat.push(entry);
		for (const child of entry.children) flat.push(child);
	}
	return flat;
}

/** Resolve the visible counter shared by desktop TocNav and mobile TocPill.
 * A flat all-numbered run carries canonical section numbers, so conditional
 * gaps stay honest (02 / 08). Mixed, icon, and nested ToCs remain positional. */
export function resolveTocCounter(
	entries: TocEntry[],
	activeId: string,
): { current: number; total: number } {
	const flat = flattenToc(entries);
	const activeIndex = Math.max(
		0,
		flat.findIndex((entry) => entry.id === activeId),
	);
	const usesCanonicalNumbers =
		entries.length > 0 &&
		entries.every((entry) => entry.badge?.kind === 'number' && entry.children.length === 0);
	if (usesCanonicalNumbers) {
		const activeEntry = entries.find((entry) => entry.id === activeId) ?? entries[0];
		return {
			current: activeEntry.badge?.kind === 'number' ? activeEntry.badge.value : activeIndex + 1,
			total: Math.max(
				...entries.map((entry) => (entry.badge?.kind === 'number' ? entry.badge.value : 0)),
			),
		};
	}
	return { current: activeIndex + 1, total: flat.length };
}

/** Resolve a TOC id to its scroll-target element. Supports three anchor schemes
 *  so one resolver serves every detail page:
 *   - `section-N`            -> a locale-stable `[data-section-index="N"]`
 *   - `[data-toc="<id>"]`    -> CollapsibleSection sections; desktop+mobile dupes resolve to the first VISIBLE
 *   - plain element id       -> any heading with an `id` */
export function tocElement(id: string): Element | null {
	if (/^section-\d+$/.test(id)) {
		const el = document.querySelector(`[data-section-index="${id.slice('section-'.length)}"]`);
		if (el) return el;
	}
	const tagged = Array.from(document.querySelectorAll(`[data-toc="${id}"]`));
	if (tagged.length > 0) {
		const visible = tagged.find((el) => (el as HTMLElement).offsetParent !== null);
		return visible ?? tagged[0];
	}
	return document.getElementById(id);
}

/** Wait until the target's scroll container stops changing height. The card
 *  expand/collapse animates 300ms (grid-rows), and `scrollIntoView` computes —
 *  and CLAMPS — its destination against the geometry at call time, so
 *  positioning before the layout settles lands wrong: over-scroll when a
 *  remembered collapse shrinks the page under the scroll, short landings when
 *  the target's expansion grows it. Resolves after two consecutive same-height
 *  frames, or after `maxWaitMs` as a hard cap (fonts/images may keep trickling
 *  in). Reduced motion sets the transitions to `none`, so this settles in two
 *  frames there. */
export function settleLayout(target: Element | null, maxWaitMs = 700): Promise<void> {
	if (!target || typeof requestAnimationFrame !== 'function') return Promise.resolve();
	let scroller: Element | null = null;
	for (let node = target.parentElement; node; node = node.parentElement) {
		const overflowY = getComputedStyle(node).overflowY;
		if (overflowY === 'auto' || overflowY === 'scroll') {
			scroller = node;
			break;
		}
	}
	const measured = scroller ?? document.scrollingElement ?? document.documentElement;
	const transitionGraceMs =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
			? 0
			: 100;
	return new Promise((resolve) => {
		const startedAt = performance.now();
		let done = false;
		let frameId: number | null = null;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let last = -1;
		let stable = 0;
		let sawChange = false;
		const finish = (): void => {
			if (done) return;
			done = true;
			if (frameId !== null && typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(frameId);
			}
			if (timeoutId !== null) clearTimeout(timeoutId);
			resolve();
		};
		const frame = (): void => {
			const height = measured.scrollHeight;
			if (height === last) stable += 1;
			else {
				if (last !== -1) sawChange = true;
				stable = 0;
				last = height;
			}
			// Mount-time bulk signals can update aria state one paint before the
			// disclosure transition starts. Do not mistake those initial equal frames
			// for the final layout; once movement is observed, reduced-motion and
			// already-running transitions can still settle in the normal two frames.
			const transitionHadTimeToStart = performance.now() - startedAt >= transitionGraceMs;
			if (stable >= 2 && (sawChange || transitionHadTimeToStart)) finish();
			else frameId = requestAnimationFrame(frame);
		};
		timeoutId = setTimeout(finish, Math.max(0, maxWaitMs));
		frameId = requestAnimationFrame(frame);
	});
}

/** Observe every TOC-target element on the page and report the active id as the
 *  user scrolls. One observer drives BOTH the desktop nav and the mobile pill
 *  (the page owns the active id and passes it down; no duplicate observers).
 *  Returns a cleanup fn for onMount. */
export function observeActiveToc(setActive: (id: string) => void): () => void {
	const els = document.querySelectorAll('[data-section-index], [data-toc]');
	if (els.length === 0) return () => {};

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const el = entry.target as HTMLElement;
				const sectionIdx = el.getAttribute('data-section-index');
				const dataToc = el.getAttribute('data-toc');
				if (sectionIdx !== null) setActive(`section-${sectionIdx}`);
				else if (dataToc) setActive(dataToc);
				else if (el.id) setActive(el.id);
			}
		},
		{ rootMargin: '-20% 0px -70% 0px' },
	);
	els.forEach((el) => observer.observe(el));
	return () => observer.disconnect();
}

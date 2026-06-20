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

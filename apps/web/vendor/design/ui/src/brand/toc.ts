import { tick } from 'svelte';
import type { TocBadgeSpec } from './TocBadge.svelte';

export interface TocEntry {
	id: string;
	title: string;
	level: number;
	/** Leading mark, matching the section card's badge. Sub-headings omit it. */
	badge?: TocBadgeSpec;
	/** Lives in the desktop side rail: TocNav skips it, TocPill keeps it. */
	rail?: boolean;
	children: TocEntry[];
}

/** Elements `observeActiveToc` tracks unless the page passes its own selector. */
export const TOC_TARGET_SELECTOR = '[data-section-index], [data-toc]';

/** TOC jumps land a section's top this far down the viewport, and the active-section tracker reads the same line. */
const TOC_LINE = 0.25;

function landOnTocLine(target: HTMLElement, behavior: ScrollBehavior): void {
	const previous = target.style.scrollMarginTop;
	target.style.scrollMarginTop = `${TOC_LINE * 100}vh`;
	target.scrollIntoView({ behavior, block: 'start' });
	target.style.scrollMarginTop = previous;
}

export function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface RevealTocTargetOptions {
	beforeReveal?: (id: string) => void;
	isCurrent?: () => boolean;
	behavior: ScrollBehavior;
	block?: ScrollLogicalPosition;
}

export function flattenToc(entries: TocEntry[]): TocEntry[] {
	const flat: TocEntry[] = [];
	for (const entry of entries) {
		flat.push(entry);
		for (const child of entry.children) flat.push(child);
	}
	return flat;
}

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

export function reconcileActiveToc(
	activeId: string,
	previousIds: readonly string[],
	nextIds: readonly string[],
): string {
	if (nextIds.length === 0) return '';
	if (!activeId) return nextIds[0];
	if (nextIds.includes(activeId)) return activeId;
	const previousIndex = previousIds.indexOf(activeId);
	if (previousIndex < 0) return nextIds[0];
	let winner = nextIds[0];
	let winnerDistance = Number.POSITIVE_INFINITY;
	for (const id of nextIds) {
		const index = previousIds.indexOf(id);
		if (index < 0) continue;
		const distance = Math.abs(index - previousIndex);
		if (distance < winnerDistance) {
			winner = id;
			winnerDistance = distance;
		}
	}
	return winner;
}

/**
 * Resolves a TOC id: `section-N` to `[data-section-index="N"]`, then `[data-toc]` (first visible
 * of desktop and mobile duplicates), then a plain element id.
 */
export function tocElement(id: string): Element | null {
	if (/^section-\d+$/.test(id)) {
		const el = document.querySelector(`[data-section-index="${id.slice('section-'.length)}"]`);
		if (el) return el;
	}
	// Compared, not interpolated, so any id is safe.
	const tagged = Array.from(document.querySelectorAll('[data-toc]')).filter(
		(el) => el.getAttribute('data-toc') === id,
	);
	if (tagged.length > 0) {
		const visible = tagged.find((el) => (el as HTMLElement).offsetParent !== null);
		return visible ?? tagged[0];
	}
	return document.getElementById(id);
}

/** Lands the readable heading, including a closed card's visible trigger, on the TOC line. */
export function navigateToc(id: string): void {
	const element = tocElement(id);
	if (!element) return;
	const closed = element.closest('[inert]');
	const card = closed?.closest('.section-card') ?? element;
	const target = card.querySelector<HTMLElement>('.section-header') ?? (card as HTMLElement);
	landOnTocLine(target, prefersReducedMotion() ? 'auto' : 'smooth');
}

/** For `afterNavigate`: lands new fragment requests and leaves history to the router. */
export function onTocNavigate({ type, to }: { type: string; to: { url: URL } | null }): void {
	let id = to?.url.hash.slice(1);
	if (!id || type === 'popstate') return;
	try {
		id = decodeURIComponent(id);
	} catch {
		return;
	}
	navigateToc(id);
}

export function openCollapsedTocTarget(id: string): boolean {
	const target = tocElement(id);
	const trigger = target?.querySelector<HTMLButtonElement>(
		'[data-section-trigger][aria-expanded="false"]',
	);
	if (!trigger) return false;
	trigger.click();
	return true;
}

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
	const transitionGraceMs = prefersReducedMotion() ? 0 : 100;
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
			const transitionHadTimeToStart = performance.now() - startedAt >= transitionGraceMs;
			if (stable >= 2 && (sawChange || transitionHadTimeToStart)) finish();
			else frameId = requestAnimationFrame(frame);
		};
		timeoutId = setTimeout(finish, Math.max(0, maxWaitMs));
		frameId = requestAnimationFrame(frame);
	});
}

export async function revealTocTarget(
	id: string,
	{ beforeReveal, isCurrent = () => true, behavior, block = 'start' }: RevealTocTargetOptions,
): Promise<boolean> {
	beforeReveal?.(id);
	await tick();
	const target = tocElement(id);
	await settleLayout(target);
	if (!target || !isCurrent()) return false;
	if (block === 'start') landOnTocLine(target as HTMLElement, behavior);
	else target.scrollIntoView({ behavior, block });
	return true;
}

/**
 * One observer reports the active id for both TocNav and TocPill; the page owns that id.
 * Returns cleanup.
 */
export function observeActiveToc(
	setActive: (id: string) => void,
	selector: string = TOC_TARGET_SELECTOR,
): () => void {
	const els = document.querySelectorAll(selector);
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
		{ rootMargin: `-${TOC_LINE * 100}% 0px -${100 - TOC_LINE * 100 - 1}% 0px` },
	);
	els.forEach((el) => observer.observe(el));
	return () => observer.disconnect();
}

/**
 * Same-page fragment links bypass `afterNavigate`. Lands each requested fragment after the
 * router's own handling, unless history or another click supersedes it. Listens on `root`
 * (the page's `main` by default) so it sees cancellations before SvelteKit's app-root handler.
 * Returns cleanup.
 */
export function landTocFragments(
	root: Element | Document = document.querySelector('main') ?? document,
): () => void {
	let frame = 0;
	let pendingHref = '';
	const cancel = () => {
		cancelAnimationFrame(frame);
		pendingHref = '';
	};
	const onHistory = (event: PopStateEvent) => {
		// A new native hash entry has null state. Router history can revisit
		// the same URL at another reading position and must cancel the pending jump.
		if (event.state !== null || location.href !== pendingHref) cancel();
	};
	function onHashLink(event: MouseEvent) {
		if (
			event.defaultPrevented ||
			event.button ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return;
		const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
		if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
		const url = new URL(link.href);
		if (
			!url.hash ||
			url.origin !== location.origin ||
			url.pathname !== location.pathname ||
			url.search !== location.search
		)
			return;
		cancelAnimationFrame(frame);
		pendingHref = url.href;
		frame = requestAnimationFrame(() => {
			if (location.href === url.href) onTocNavigate({ type: 'link', to: { url } });
		});
	}
	root.addEventListener('click', onHashLink as EventListener);
	document.addEventListener('click', cancel, true);
	window.addEventListener('popstate', onHistory);
	return () => {
		root.removeEventListener('click', onHashLink as EventListener);
		document.removeEventListener('click', cancel, true);
		window.removeEventListener('popstate', onHistory);
		cancel();
	};
}

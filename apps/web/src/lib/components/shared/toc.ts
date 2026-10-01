import { tick } from 'svelte';
import type { TocBadgeSpec } from '@yesid/ui/brand';

export type { TocBadgeSpec };

export interface TocEntry {
	id: string;
	title: string;
	level: number;
	badge?: TocBadgeSpec;
	rail?: boolean;
	children: TocEntry[];
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
	target.scrollIntoView({ behavior, block });
	return true;
}

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

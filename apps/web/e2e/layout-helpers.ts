import type { Page } from '@playwright/test';

// A request can outlive its page: navigation or teardown disposes the fetched
// response before route.fulfill runs. That is not a layout finding, so drop it.
const TEARDOWN =
	/has been disposed|Target page, context or browser has been closed|Route is already handled/;
export async function forwardRoute(handle: () => Promise<void>): Promise<void> {
	try {
		await handle();
	} catch (error) {
		if (TEARDOWN.test(String(error))) return;
		throw error;
	}
}

// Inspect text nodes rather than a hand-maintained list of component classes. This
// includes bars, cards, panels, sheets and overlays, including content below fold.
export async function textDefects(page: Page) {
	return page.evaluate(() => {
		const findings: {
			kind: string;
			selector: string;
			text: string;
			sizes: number[];
			owner: string | null;
			rendered: { width: number; height: number };
		}[] = [];
		const seen = new Set<string>();
		const selector = (el: Element): string => {
			if (el.id) return `#${CSS.escape(el.id)}`;
			const slot = el.getAttribute('data-slot');
			if (slot) return `[data-slot="${slot}"]`;
			const parent = el.parentElement;
			return parent
				? `${selector(parent)} > ${el.localName}:nth-child(${[...parent.children].indexOf(el) + 1})`
				: el.localName;
		};
		const hidden = (el: Element) => {
			const css = getComputedStyle(el),
				box = el.getBoundingClientRect();
			return (
				css.display === 'none' ||
				css.visibility === 'hidden' ||
				css.opacity === '0' ||
				css.contentVisibility === 'hidden' ||
				(box.width > 0 && box.width <= 1 && box.height <= 1) ||
				css.clipPath === 'inset(50%)' ||
				(css.clip !== '' && css.clip !== 'auto')
			);
		};
		const report = (kind: string, el: HTMLElement, text: string) => {
			const key = `${kind}:${selector(el)}:${text}`;
			if (seen.has(key)) return;
			seen.add(key);
			const range = document.createRange();
			range.selectNodeContents(el);
			const rect = range.getBoundingClientRect();
			findings.push({
				kind,
				selector: selector(el),
				text,
				sizes: [el.clientWidth, el.scrollWidth, el.clientHeight, el.scrollHeight],
				owner: el.closest('[data-slot="absent-value"]')?.getAttribute('data-slot') ?? null,
				rendered: { width: rect.width, height: rect.height },
			});
		};
		const readable = (el: Element, text: string) => {
			const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
			const full = normalize(text);
			for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
				const description = (p.getAttribute('aria-describedby') ?? '')
					.split(/\s+/)
					.map((id) => document.getElementById(id)?.textContent ?? '')
					.join(' ');
				if (
					[p.getAttribute('title'), p.getAttribute('aria-label'), description].some(
						(value) => value && normalize(value).includes(full),
					)
				)
					return true;
				if (
					[...p.querySelectorAll('*')].some(
						(duplicate) =>
							duplicate !== el &&
							hidden(duplicate) &&
							getComputedStyle(duplicate).display !== 'none' &&
							getComputedStyle(duplicate).visibility !== 'hidden' &&
							normalize(duplicate.textContent ?? '') === full &&
							!duplicate.closest('[aria-hidden="true"], [hidden], [inert]'),
					)
				)
					return true;
			}
			return false;
		};
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const el = node.parentElement as HTMLElement;
			const text = node.textContent?.trim();
			if (!text || !el || el.closest('script,style,[data-allow-clip]')) continue;
			let invisible = false;
			for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
				if (hidden(p)) {
					invisible = true;
					break;
				}
			}
			if (invisible) continue;
			const full = el.textContent?.trim() ?? text;
			const textRange = document.createRange();
			textRange.selectNodeContents(node);
			const textRects = [...textRange.getClientRects()];
			for (let p: HTMLElement | null = el; p && p !== document.body; p = p.parentElement) {
				const css = getComputedStyle(p);
				// A nested scroller makes offscreen text reachable. Its enclosing
				// viewport does not clip that text permanently.
				if (/auto|scroll/.test(css.overflowY) && p.scrollHeight > p.clientHeight + 1) break;
				const x = p.scrollWidth > p.clientWidth + 1,
					y = p.scrollHeight > p.clientHeight + 1;
				if (css.textOverflow === 'ellipsis' && x) {
					if (!readable(p, p.textContent?.trim() ?? full))
						report('inaccessible-ellipsis', p, p.textContent?.trim() ?? full);
				} else if (
					(x && /hidden|clip/.test(css.overflowX)) ||
					(y && /hidden|clip/.test(css.overflowY))
				) {
					const box = p.getBoundingClientRect();
					if (
						textRects.some(
							(r) =>
								(x &&
									/hidden|clip/.test(css.overflowX) &&
									(r.left < box.left - 1 || r.right > box.right + 1)) ||
								(y &&
									/hidden|clip/.test(css.overflowY) &&
									(r.top < box.top - 1 || r.bottom > box.bottom + 1)),
						)
					)
						report('clipped', p, full);
				}
			}
			for (const match of (node.textContent ?? '').matchAll(/[\p{L}\p{N}]+/gu)) {
				const range = document.createRange();
				range.setStart(node, match.index!);
				range.setEnd(node, match.index! + match[0].length);
				const tops = [...range.getClientRects()]
					.filter((r) => r.width > 0)
					.map((r) => Math.round(r.top));
				if (tops.some((top) => Math.abs(top - tops[0]) > 2)) report('broken-word', el, match[0]);
			}
		}
		return findings;
	});
}

export async function chartOverlaps(page: Page) {
	return page.locator('main svg').evaluateAll((charts) =>
		charts.flatMap((chart) => {
			const labels = [...chart.querySelectorAll('text')].filter(
				(el) => el.checkVisibility() && el.textContent?.trim(),
			);
			return labels.flatMap((a, i) =>
				labels.slice(i + 1).flatMap((b) => {
					const x = a.getBoundingClientRect(),
						y = b.getBoundingClientRect();
					return x.width &&
						y.width &&
						Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 &&
						Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1
						? [`${a.textContent} overlaps ${b.textContent}`]
						: [];
				}),
			);
		}),
	);
}

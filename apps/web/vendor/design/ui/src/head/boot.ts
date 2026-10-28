/**
 * Runs in <head> before first paint. It applies the stored theme, then, as the parser adds marked
 * elements, each persisted collapsible's stored choice and a remembered quiet mode's close, so a
 * reload paints what hydration will render. The storage keys are the ones `../state` writes.
 * `boot.json` holds this text's CSP hash; edit both together.
 */
export const themeBootScript = `(() => {
	const root = document.documentElement;
	let theme = null;
	let quiet = false;
	try {
		theme = localStorage.getItem('theme');
		quiet = localStorage.getItem('quiet-mode') === 'true';
	} catch {}
	root.dataset.theme = theme === 'light' ? 'light' : 'dark';
	if (quiet) root.dataset.quietMode = 'true';

	const stored = new Map();
	try {
		for (let i = 0; i < sessionStorage.length; i++) {
			const key = sessionStorage.key(i);
			const value = key?.startsWith('persisted:') ? sessionStorage.getItem(key) : null;
			if (value === 'true' || value === 'false') stored.set(key.slice(10), value === 'true');
		}
	} catch {}
	if (stored.size === 0 && !quiet) return;

	const apply = (element) => {
		const body = element.hasAttribute('data-persisted-body');
		const open = quiet && element.hasAttribute('data-quiet')
			? false
			: stored.get(body ? element.dataset.persistedBody : element.dataset.persistedKey);
		if (open === undefined) return;
		if (element.hasAttribute('data-state')) element.dataset.state = open ? 'open' : 'closed';
		if (element.hasAttribute('aria-expanded')) element.setAttribute('aria-expanded', String(open));
		if (!body) return;
		element.toggleAttribute('inert', !open);
		if (open) element.removeAttribute('aria-hidden');
		else element.setAttribute('aria-hidden', 'true');
	};
	const marked = '[data-persisted-key], [data-persisted-body], [data-quiet]';
	const observer = new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (node.nodeType !== 1) continue;
				if (node.matches(marked)) apply(node);
				node.querySelectorAll(marked).forEach(apply);
			}
		}
	});
	observer.observe(root, { childList: true, subtree: true });
	document.addEventListener('DOMContentLoaded', () => observer.disconnect(), { once: true });
})();`;

/** Replaces `%yesid.themeBoot%` in app.html with the boot script; call it from `transformPageChunk`. */
export function injectThemeBoot(html: string): string {
	return html.replace('%yesid.themeBoot%', () => `<script>${themeBootScript}</script>`);
}

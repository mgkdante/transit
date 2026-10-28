/** The slice of SvelteKit's navigation hooks the header uses; pass the ones from `$app/navigation`. */
export interface NavigationEvent {
	type: string;
	to: { url: URL } | null;
	shallow?: boolean;
}
type NavigationResult = void | (() => void) | Promise<void | (() => void)>;
export type OnNavigate = (callback: (navigation: NavigationEvent) => NavigationResult) => void;
export interface SiteNavigation {
	beforeNavigate(callback: (navigation: NavigationEvent) => void): void;
	onNavigate: OnNavigate;
	afterNavigate(callback: (navigation: NavigationEvent) => void): void;
}

/**
 * For navigations that skip SvelteKit's reset (`data-sveltekit-reset="false"` or `reset: false`).
 * Call before navigating; the returned function restores Kit's focus reset without scrolling.
 */
export function resetFocusAfterNavigation(): () => void {
	const previous = document.activeElement;
	return () => {
		// Respect focus explicitly moved by the user or destination during navigation.
		if (document.activeElement !== previous && document.activeElement !== document.body) return;
		if (window.parent !== window && !document.hasFocus()) return;
		const autofocus = document.querySelector<HTMLElement>('[autofocus]');
		if (autofocus) {
			autofocus.focus({ preventScroll: true });
			return;
		}
		const body = document.body;
		const tabindex = body.getAttribute('tabindex');
		body.setAttribute('tabindex', '-1');
		body.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
		if (tabindex === null) body.removeAttribute('tabindex');
		else body.setAttribute('tabindex', tabindex);

		// Like Kit, clear selection only if navigation callbacks did not change it.
		const selection = getSelection();
		if (selection && selection.type !== 'None') {
			const ranges = Array.from({ length: selection.rangeCount }, (_, i) => {
				const range = selection.getRangeAt(i);
				return {
					container: range.commonAncestorContainer,
					start: range.startContainer, startOffset: range.startOffset,
					end: range.endContainer, endOffset: range.endOffset,
				};
			});
			setTimeout(() => {
				if (selection.rangeCount !== ranges.length) return;
				for (let i = 0; i < ranges.length; i++) {
					const before = ranges[i];
					const after = selection.getRangeAt(i);
					if (before.container !== after.commonAncestorContainer ||
						before.start !== after.startContainer || before.startOffset !== after.startOffset ||
						before.end !== after.endContainer || before.endOffset !== after.endOffset) return;
				}
				selection.removeAllRanges();
			});
		}
	};
}

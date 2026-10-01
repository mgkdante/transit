import { isPrefersReducedMotion } from '@yesid/motion/stores/reducedMotion';

export interface ViewTransitionNavigation {
	from: { url: URL } | null;
	to: { url: URL } | null;
	complete: Promise<unknown>;
}

export function shouldRunViewTransition(): boolean {
	if (typeof document === 'undefined') return false;
	if (typeof document.startViewTransition !== 'function') return false;
	return !isPrefersReducedMotion();
}

export function runViewTransition(navigation: ViewTransitionNavigation): Promise<void> | undefined {
	if (!shouldRunViewTransition()) return;
	if (navigation.from && navigation.from.url.pathname === navigation.to?.url.pathname) return;
	return new Promise<void>((resolve) => {
		document.startViewTransition(async () => {
			resolve();
			await navigation.complete;
		});
	});
}

import { isPrefersReducedMotion } from '../stores/reducedMotion.js';

/** The part of SvelteKit's `OnNavigate` argument a view transition needs. */
export interface ViewTransitionNavigation {
	from: { url: URL } | null;
	to: { url: URL } | null;
	complete: Promise<unknown>;
}

/**
 * Crossfades client-side navigations with the View Transitions API: `onNavigate(viewTransition)`.
 * Skips same-path navigations, browsers without the API and reduced motion. The animation
 * itself lives in `@yesid/ui/base.css`.
 */
export function viewTransition(navigation: ViewTransitionNavigation): Promise<void> | undefined {
	if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return;
	if (isPrefersReducedMotion()) return;
	if (navigation.from && navigation.from.url.pathname === navigation.to?.url.pathname) return;
	return new Promise<void>((resolve) => {
		document.startViewTransition(async () => {
			resolve();
			await navigation.complete;
		});
	});
}

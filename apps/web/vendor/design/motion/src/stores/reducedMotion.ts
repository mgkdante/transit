// Reads the OS-level "prefers-reduced-motion" setting and exposes it as a reactive
// Svelte store. Every animation action checks this before doing anything — motion is
// opt-out, not opt-in, so the default is false (animations enabled).
//
// WHY a store + a sync helper:
//   - The store is for Svelte components that want to subscribe reactively.
//   - isPrefersReducedMotion() is for plain TS actions that need a one-time boolean.

import { readable } from 'svelte/store';

const QUERY = '(prefers-reduced-motion: reduce)';

function getInitialValue(): boolean {
	// window is not available during SSR — default to false (allow animation).
	if (typeof window === 'undefined') return false;
	return window.matchMedia(QUERY).matches;
}

export const prefersReducedMotion = readable<boolean>(getInitialValue(), (set) => {
	if (typeof window === 'undefined') return;
	const mql = window.matchMedia(QUERY);
	const handler = (e: MediaQueryListEvent) => set(e.matches);
	mql.addEventListener('change', handler);
	return () => mql.removeEventListener('change', handler);
});

// Synchronous snapshot for use in Svelte actions (not reactive, one-time read).
export function isPrefersReducedMotion(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia(QUERY).matches;
}

// Navigation-as-intent — "panels, not pages".
//
// THE LOAD-BEARING ABSTRACTION of the web app: callers express WHERE they want
// to go as a semantic `SurfaceTarget` (open the stop drawer, focus this line,
// show network health) and `openSurface` resolves that intent against the
// current form factor:
//
//   - MOBILE (one surface at a time): push the canonical route for the target
//     via SvelteKit `goto`, localized to the active locale. The URL is the
//     surface; back/forward works; deep links are shareable.
//   - DESKTOP (master/detail panels): swap the in-memory `activePanel` store —
//     no navigation, no URL churn. The shell renders the panel for the active
//     target alongside the persistent map/list, so context is never lost.
//
// The SAME target therefore resolves to a route-push OR a panel-swap with zero
// caller awareness of which — that is the whole point. `routeFor` is the shared
// canonical map both halves agree on (mobile pushes it; a desktop deep-link /
// SSR load can hydrate `activePanel` from it).
//
// SSR-safe: the form-factor decision uses the non-reactive `isDesktopViewport()`
// snapshot (false on the server), and `activePanel` is a plain in-memory rune —
// no DOM access at module scope.

import { goto } from '$app/navigation';
import { getLocale, localizeHref } from '$lib/i18n';
import { isDesktopViewport } from './layout.svelte';

/**
 * The kinds of navigable surface in the app. A `vehicle`/`stop`/`line` carries an
 * `id`; `search`, `network-health`, and `home` are singletons. Matches the
 * SHARED nav contract exactly — other agents construct these.
 */
export type SurfaceKind = 'vehicle' | 'stop' | 'line' | 'search' | 'network-health' | 'home';

/**
 * A navigation intent: which surface, and (for id-bearing kinds) which entity.
 * `id` is required in practice for `vehicle`/`stop`/`line` and ignored for the
 * singleton kinds; `routeFor` falls back to the surface root if it is absent.
 */
export interface SurfaceTarget {
	kind: SurfaceKind;
	id?: string;
}

/** Canonical (unlocalized, EN) URL roots per surface kind. */
const SURFACE_ROOT: Record<SurfaceKind, string> = {
	home: '/',
	'network-health': '/network',
	search: '/search',
	line: '/lines',
	stop: '/stops',
	vehicle: '/vehicles',
};

/** True for kinds whose canonical route addresses a single entity by id. */
function isEntityKind(kind: SurfaceKind): boolean {
	return kind === 'vehicle' || kind === 'stop' || kind === 'line';
}

/**
 * The canonical, UNLOCALIZED page route for a target — the single map both the
 * mobile (route-push) and desktop (panel deep-link) halves agree on. Entity
 * kinds with an `id` resolve to `/{root}/{id}` (id URI-encoded); without an id,
 * or for singleton kinds, they resolve to the surface root.
 *
 * Localize at the navigation boundary with `localizeHref(routeFor(t), locale)` —
 * this function deliberately stays locale-agnostic so it is reusable for
 * canonical/sitemap/SSR contexts.
 */
export function routeFor(target: SurfaceTarget): string {
	const root = SURFACE_ROOT[target.kind];
	const id = target.id?.trim();
	if (isEntityKind(target.kind) && id) {
		return `${root}/${encodeURIComponent(id)}`;
	}
	return root;
}

/** Value-equality for targets — used to avoid redundant panel swaps. */
function sameTarget(a: SurfaceTarget | null, b: SurfaceTarget): boolean {
	return a !== null && a.kind === b.kind && (a.id ?? '') === (b.id ?? '');
}

/**
 * The desktop master/detail panel state. In-memory only — the URL is NOT the
 * source of truth on desktop (that is the deliberate inverse of mobile). `null`
 * means no detail panel is open (the shell shows just the persistent surface).
 *
 * Exposed as a getter so reassignments stay reactive for `.svelte` consumers;
 * `set`/`clear` are the only mutators.
 */
let panel = $state<SurfaceTarget | null>(null);

export const activePanel = {
	/** Reactive current detail-panel target, or `null` when none is open. */
	get current(): SurfaceTarget | null {
		return panel;
	},
	/** Open (or replace) the detail panel for a target. */
	set(target: SurfaceTarget): void {
		if (sameTarget(panel, target)) return;
		panel = target;
	},
	/** Close the detail panel. */
	clear(): void {
		panel = null;
	},
};

/**
 * Resolve a navigation intent against the current form factor.
 *
 *   - Desktop (>= 1024px): swap the in-memory `activePanel` — no navigation.
 *   - Mobile: push the localized canonical route via SvelteKit `goto`.
 *
 * `home` is special-cased: on desktop, opening `home` clears any detail panel
 * (returns to the bare surface) rather than parking a "home" panel.
 *
 * The form-factor read uses the synchronous viewport snapshot so this is a clean
 * one-shot decision (no reactive subscription leak per call); SSR resolves to the
 * mobile branch, which never runs `goto` outside the browser because SvelteKit's
 * `goto` is client-only — call sites invoke `openSurface` from event handlers.
 */
export function openSurface(target: SurfaceTarget): void {
	if (isDesktopViewport()) {
		if (target.kind === 'home') {
			activePanel.clear();
		} else {
			activePanel.set(target);
		}
		return;
	}
	void goto(localizeHref(routeFor(target), getLocale()));
}

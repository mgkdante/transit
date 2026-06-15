// Navigation-as-intent — "panels, not pages" (desktop panels deferred).
//
// THE LOAD-BEARING ABSTRACTION of the web app: callers express WHERE they want
// to go as a semantic `SurfaceTarget` (open the stop drawer, focus this line,
// show network health) and `openSurface` resolves that intent to a destination.
// Routing through ONE entry point is the point: the desktop master/detail
// behavior can be introduced in a single place without touching call sites.
//
// TARGET DESIGN (master/detail):
//   - MOBILE (one surface at a time): push the canonical route for the target
//     via SvelteKit `goto`, localized to the active locale. The URL is the
//     surface; back/forward works; deep links are shareable.
//   - DESKTOP (master/detail panels): swap the in-memory `activePanel` store —
//     no navigation, no URL churn. The shell renders the panel for the active
//     target alongside the persistent map/list, so context is never lost.
//
// CURRENT STATE: the desktop shell that READS `activePanel` is not wired yet
// (slice-9.3 brainstorm scope), so `openSurface` navigates on EVERY form factor
// for now — driving the panel store with no observer would leave clicks dead.
// `activePanel` + `sameTarget` remain as the reserved store for that shell.
// `routeFor` is the shared canonical map both halves agree on (mobile pushes it;
// a desktop deep-link / SSR load can hydrate `activePanel` from it).
//
// SSR-safe: `goto` is client-only and `activePanel` is a plain in-memory rune —
// no DOM access at module scope.

import { goto } from '$app/navigation';
import { getLocale, localizeHref } from '$lib/i18n';

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

/** Canonical (unlocalized, EN) INDEX / singleton route root per surface kind. */
const SURFACE_ROOT: Record<SurfaceKind, string> = {
	home: '/',
	'network-health': '/network',
	search: '/search',
	line: '/lines',
	stop: '/stops',
	vehicle: '/vehicles',
};

/**
 * Per-entity DETAIL route roots. These DELIBERATELY differ from the plural index
 * roots above: the line index is `/lines` but a single line's detail page is
 * `/route/[id]`; the stop index is `/stops` but a stop's detail is `/stop/[id]`.
 * A kind absent here has no detail route yet (vehicle) and falls back to its
 * index root.
 */
const ENTITY_DETAIL_ROOT: Partial<Record<SurfaceKind, string>> = {
	line: '/route',
	stop: '/stop',
};

/** True for kinds whose canonical route addresses a single entity by id. */
function isEntityKind(kind: SurfaceKind): boolean {
	return kind === 'vehicle' || kind === 'stop' || kind === 'line';
}

/**
 * The canonical, UNLOCALIZED page route for a target — the single map both the
 * mobile (route-push) and desktop (panel deep-link) halves agree on. An entity
 * kind WITH an `id` resolves to its DETAIL route `/{detailRoot}/{id}` (id
 * URI-encoded) — note the detail root differs from the plural index root
 * (`/route/[id]`, not `/lines/[id]`). Without an id, or for singleton kinds, it
 * resolves to the surface (index) root.
 *
 * Localize at the navigation boundary with `localizeHref(routeFor(t), locale)` —
 * this function deliberately stays locale-agnostic so it is reusable for
 * canonical/sitemap/SSR contexts.
 */
export function routeFor(target: SurfaceTarget): string {
	const id = target.id?.trim();
	if (isEntityKind(target.kind) && id) {
		const detailRoot = ENTITY_DETAIL_ROOT[target.kind];
		if (detailRoot) return `${detailRoot}/${encodeURIComponent(id)}`;
		// No detail route for this kind yet (vehicle) — fall back to the index root.
	}
	return SURFACE_ROOT[target.kind];
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
 *
 * RESERVED for the desktop master/detail shell (slice-9.3 brainstorm scope). The
 * shell that READS this store — rendering the detail panel alongside the
 * persistent surface — is not wired yet, so `openSurface` navigates on every
 * form factor for now (see below). When the shell lands, restore the desktop
 * branch of `openSurface` to drive this store.
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
 * Resolve a navigation intent to a destination.
 *
 * Pushes the localized canonical route for the target via SvelteKit `goto`. This
 * is the SINGLE entry point every call site uses (hub `<button>` tiles, entity
 * rows) so navigation stays uniform and the desktop master/detail behavior can
 * be introduced in ONE place later.
 *
 * DESKTOP PANELS ("panels, not pages") are deferred: the shell that reads
 * `activePanel` to render a detail pane alongside the persistent surface is not
 * wired yet (slice-9.3 brainstorm scope). Until it is, we navigate on every form
 * factor — so hub tiles and entity rows all reach their target route rather than
 * mutating a store nothing observes. When the shell lands, branch here on
 * `isDesktopViewport()` to drive `activePanel.set(target)` (and `.clear()` for
 * `home`) on desktop while keeping this `goto` for mobile.
 *
 * SSR-safe: `goto` is client-only and call sites invoke `openSurface` from event
 * handlers, so it never runs during server render.
 */
export function openSurface(target: SurfaceTarget): void {
	void goto(localizeHref(routeFor(target), getLocale()));
}

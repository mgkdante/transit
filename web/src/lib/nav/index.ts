// $lib/nav — navigation-as-intent ("panels, not pages").
//
// Single import surface for the nav layer:
//   import { openSurface, activePanel, layout } from '$lib/nav';
//
// `openSurface(target)` is the one call sites use: it resolves a semantic
// `SurfaceTarget` to a route-push on mobile or an `activePanel` swap on desktop,
// branching on the reactive `layout.isDesktop` store. `routeFor` exposes the
// shared canonical route map for deep-link / SSR hydration.

export type { SurfaceKind, SurfaceTarget } from './intent';
export { openSurface, routeFor, activePanel } from './intent';

export { layout, isDesktopViewport } from './layout.svelte';

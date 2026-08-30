// $lib/nav — navigation-as-intent.
//
// Single import surface for the nav layer:
//   import { openSurface, routeFor, layout } from '$lib/nav';
//
// `openSurface(target)` resolves a semantic `SurfaceTarget` to a localized
// route push. `routeFor` exposes the shared canonical map for links and SSR.

export type { SurfaceKind, SurfaceTarget } from './intent.svelte';
export { openSurface, routeFor, mapHrefFor } from './intent.svelte';

export { layout, isDesktopViewport } from './layout.svelte';

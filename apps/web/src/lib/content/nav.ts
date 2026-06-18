// Transit navigation IA — the single source of truth for the chrome's links.
//
// Pure content (no imports, no runtime): declares WHICH surfaces the chrome links
// to and WHAT they are called in each locale. Every `href` is locale-LESS and is
// run through `localizeHref` at render time by the consumers (TopBar / LeftRail /
// Footer) — a locale-prefixed href here would double-localize on /fr.
//
// ONE manifest, three consumers. Before this, TopBar and LeftRail hand-rolled
// identical lists inline while Footer rendered a STALE inventory (/, /history,
// /data-trust) that shipped dead links. Keep every chrome surface iterating
// SURFACE_NAV so a route rename happens in exactly one place.

/** Bilingual string — consumers pick `en`/`fr` from the active locale. */
export interface BilingualLabel {
	readonly en: string;
	readonly fr: string;
}

/** A primary surface in the citizen dashboard's navigation. */
export interface SurfaceNavItem {
	/** Stable identity (icon lookup + #each keys). */
	readonly key: 'map' | 'lines' | 'stops' | 'network';
	/** Locale-LESS path, e.g. `/map`. */
	readonly href: string;
	/** Primary label. */
	readonly label: BilingualLabel;
	/** Secondary line (rail subtitle / mobile-menu small). */
	readonly description: BilingualLabel;
	/**
	 * Delocalized path prefixes that mark this surface active. A prefix matches
	 * when the current path equals it OR is nested beneath it — e.g. `/route/`
	 * keeps Lines active on a route-detail page.
	 */
	readonly activePrefixes: readonly string[];
}

/** An off-site link (portfolio) shown beside the IA nav. */
export interface ExternalNavLink {
	readonly href: string;
	readonly label: BilingualLabel;
}

/**
 * The primary surfaces, in wayfinding order: the live map hub first, then the
 * per-line and per-stop catalogues, then the network-health / data-trust surface.
 * These are the REAL shipped routes (verified against src/routes).
 */
export const SURFACE_NAV: readonly SurfaceNavItem[] = [
	{
		key: 'map',
		href: '/map',
		label: { en: 'Map', fr: 'Carte' },
		description: { en: 'live network', fr: 'réseau en direct' },
		activePrefixes: ['/map'],
	},
	{
		key: 'lines',
		href: '/lines',
		label: { en: 'Lines', fr: 'Lignes' },
		description: { en: 'routes and directions', fr: 'itinéraires et directions' },
		activePrefixes: ['/lines', '/route/'],
	},
	{
		key: 'stops',
		href: '/stops',
		label: { en: 'Stops', fr: 'Arrêts' },
		description: { en: 'departures and schedules', fr: 'départs et horaires' },
		activePrefixes: ['/stops', '/stop/'],
	},
	{
		key: 'network',
		href: '/network',
		label: { en: 'Network', fr: 'Réseau' },
		description: { en: 'reliability and health', fr: 'fiabilité et santé' },
		activePrefixes: ['/network'],
	},
] as const;

/** Off-site links — the portfolio at yesid.dev. */
export const MENU_EXTRAS: readonly ExternalNavLink[] = [
	{ href: 'https://yesid.dev', label: { en: 'yesid.dev', fr: 'yesid.dev' } },
] as const;

/**
 * True when `currentPath` (a DELOCALIZED pathname, e.g. `/route/1`) falls under
 * one of the surface's active prefixes. Pure — callers delocalize first.
 */
export function isSurfaceActive(item: SurfaceNavItem, currentPath: string): boolean {
	return item.activePrefixes.some((prefix) => {
		const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
		return currentPath === base || currentPath.startsWith(`${base}/`);
	});
}

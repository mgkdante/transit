// Transit navigation IA — the bilingual link inventory for the citizen dashboard.
//
// This is pure content (no imports, no runtime): the single source of truth for
// WHICH top surfaces the chrome links to and WHAT they are called in each locale.
// The Nav components own localization — every `href` here is locale-LESS and gets
// run through `localizeHref` at render time (see TopBar / MenuOverlay). Keep it
// that way: a locale-prefixed href would double-localize on /fr.
//
// `navLinks` are the primary header surfaces (the always-visible top row).
// `menuItems` is the fuller set behind the menu overlay — navLinks PLUS the
// external portfolio link + the methodology / à-propos page.
//
// Routes here are the planned information architecture for the 9.2 SvelteKit
// build — some may not exist as pages yet. That is intentional: this file
// declares the destination map; the route modules land alongside it.

/** A single bilingual navigation entry. */
export interface NavLink {
	/** Locale-LESS path (e.g. `/network`) or absolute URL for `external` links. */
	href: string;
	/** Bilingual label — the Nav picks `en`/`fr` from the active locale. */
	label: { en: string; fr: string };
	/** True for off-site links (e.g. the portfolio) — Nav adds rel/target + an icon. */
	external?: boolean;
	/**
	 * Wayfinding weight. `1` = top-level surface kept visible even when the header
	 * collapses; `2` = secondary, first to fold into the overflow menu. Absent =
	 * treated as secondary.
	 */
	priority?: 1 | 2;
}

/**
 * The primary header links — the planned top surfaces of the transit citizen
 * dashboard, in wayfinding order: the live map hub first, then the network,
 * history, and data-trust surfaces.
 */
export const navLinks: readonly NavLink[] = [
	{ href: '/', label: { en: 'Map', fr: 'Carte' }, priority: 1 },
	{ href: '/network', label: { en: 'Network', fr: 'Réseau' }, priority: 1 },
	{ href: '/history', label: { en: 'History', fr: 'Historique' }, priority: 2 },
	{ href: '/data-trust', label: { en: 'Data', fr: 'Données' }, priority: 2 },
] as const;

/**
 * The full menu-overlay set: every primary surface PLUS the methodology /
 * à-propos page and an external link back to the portfolio at yesid.dev.
 */
export const menuItems: readonly NavLink[] = [
	...navLinks,
	{ href: '/methodology', label: { en: 'Methodology', fr: 'À propos' }, priority: 2 },
	{ href: 'https://yesid.dev', label: { en: 'yesid.dev', fr: 'yesid.dev' }, external: true },
] as const;

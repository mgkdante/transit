export interface BilingualLabel {
	readonly en: string;
	readonly fr: string;
}

export interface SurfaceNavItem {
	readonly key: 'map' | 'lines' | 'stops' | 'network';
	readonly href: string;
	readonly label: BilingualLabel;
	readonly description: BilingualLabel;
	readonly activePrefixes: readonly string[];
}

export interface ExternalNavLink {
	readonly href: string;
	readonly label: BilingualLabel;
}

export interface SecondaryNavLink {
	readonly href: string;
	readonly label: BilingualLabel;
}

export interface AuditNavItem {
	readonly key: 'metrics' | 'status' | 'hotspots' | 'receipt' | 'repeatOffenders' | 'alerts';
	readonly href: string;
	readonly label: BilingualLabel;
	readonly activePrefixes: readonly string[];
}

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
		activePrefixes: ['/lines'],
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

export const YESID_HOUSE_LINK: ExternalNavLink = {
	href: 'https://yesid.dev',
	label: { en: 'Yesid', fr: 'Yesid' },
} as const;

export const AUDIT_NAV: readonly AuditNavItem[] = [
	{
		key: 'metrics',
		href: '/metrics',
		label: { en: 'How we measure', fr: 'Comment on mesure' },
		activePrefixes: ['/metrics'],
	},
	{
		key: 'status',
		href: '/status',
		label: { en: 'Data health', fr: 'Santé des données' },
		activePrefixes: ['/status'],
	},
	{
		key: 'hotspots',
		href: '/hotspots',
		label: { en: 'Hotspots', fr: 'Points chauds' },
		activePrefixes: ['/hotspots'],
	},
	{
		key: 'receipt',
		href: '/receipt',
		label: { en: 'Daily receipt', fr: 'Reçu quotidien' },
		activePrefixes: ['/receipt'],
	},
	{
		key: 'repeatOffenders',
		href: '/repeat-offenders',
		label: { en: 'Repeat offenders', fr: 'Récidivistes' },
		activePrefixes: ['/repeat-offenders'],
	},
	{
		key: 'alerts',
		href: '/alerts',
		label: { en: 'Alerts', fr: 'Avis' },
		activePrefixes: ['/alerts'],
	},
] as const;

export const LEGAL_NAV: readonly SecondaryNavLink[] = [
	{
		href: '/privacy',
		label: { en: 'Privacy', fr: 'Confidentialité' },
	},
	{
		href: '/terms',
		label: { en: 'Terms', fr: 'Conditions d’utilisation' },
	},
] as const;

export const SECONDARY_NAV: readonly SecondaryNavLink[] = [...AUDIT_NAV, ...LEGAL_NAV].map(
	(item) => ({
		href: item.href,
		label: item.label,
	}),
);

export function isSurfaceActive(
	item: { readonly activePrefixes: readonly string[] },
	currentPath: string,
): boolean {
	return item.activePrefixes.some((prefix) => {
		const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
		return currentPath === base || currentPath.startsWith(`${base}/`);
	});
}

export function mainLandmarkLabel(currentPath: string): BilingualLabel {
	const surface = SURFACE_NAV.find((item) => isSurfaceActive(item, currentPath));
	if (surface) return surface.label;
	const secondary = SECONDARY_NAV.find((link) => {
		const base = link.href.endsWith('/') ? link.href.slice(0, -1) : link.href;
		return currentPath === base || currentPath.startsWith(`${base}/`);
	});
	if (secondary) return secondary.label;
	return SURFACE_NAV[0].label;
}

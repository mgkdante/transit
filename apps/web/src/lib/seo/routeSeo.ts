// routeSeo, per-surface SEO copy for the citizen dashboard (the route-seo
// factory, adapted from yesid.dev's $lib/adapters/route-seo-factories.ts).
//
// One place maps a DELOCALIZED path to its bilingual <title>/description so the
// root layout can render a single <SeoHead> with real per-route metadata instead
// of one global title on every page. Descriptions sit in the ~120–160 char SEO
// sweet spot SeoHead warns about. Per-ENTITY detail SEO (a specific line/stop
// name) is data-dependent and loads client-side today, these detail entries are
// the section-level fallback; richer per-entity titles are a tracked follow-up.

import { delocalizePath, type Locale } from '$lib/i18n';

export interface RouteSeo {
	title: string;
	description: string;
}

interface BilingualSeo {
	readonly title: { readonly en: string; readonly fr: string };
	readonly description: { readonly en: string; readonly fr: string };
}

const HOME: BilingualSeo = {
	title: { en: 'Live STM map', fr: 'Carte STM en direct' },
	description: {
		en: 'Live Montréal STM transit dashboard, real-time buses, stops, lines, on-time performance and service alerts, measured from the open /v1 data contract.',
		fr: 'Tableau de bord STM de Montréal en direct, bus, arrêts, lignes, ponctualité et alertes en temps réel, mesurés depuis le contrat ouvert /v1.',
	},
};

const SURFACES: Record<string, BilingualSeo> = {
	'/map': {
		title: { en: 'Live map', fr: 'Carte en direct' },
		description: {
			en: 'Live map of every STM bus and stop across Montréal, real-time positions, crowding and service alerts, measured from the open /v1 data contract.',
			fr: 'Carte en direct de chaque bus et arrêt STM à Montréal, positions, achalandage et alertes en temps réel, mesurés depuis le contrat ouvert /v1.',
		},
	},
	'/lines': {
		title: { en: 'Lines', fr: 'Lignes' },
		description: {
			en: 'Every STM line, per-route schedule, direction and historic on-time reliability for Montréal buses and métro, measured from the open /v1 contract.',
			fr: 'Chaque ligne STM, horaire, direction et fiabilité historique de ponctualité pour les bus et le métro de Montréal, mesurés depuis le contrat /v1.',
		},
	},
	'/stops': {
		title: { en: 'Stops', fr: 'Arrêts' },
		description: {
			en: 'Find any STM stop in Montréal, next departures, schedules and per-stop reliability, measured from the open /v1 data contract. We never invent data.',
			fr: "Trouvez n'importe quel arrêt STM à Montréal, prochains départs, horaires et fiabilité par arrêt, mesurés depuis le contrat ouvert /v1, jamais inventés.",
		},
	},
	'/network': {
		title: { en: 'Network health', fr: 'Santé du réseau' },
		description: {
			en: 'Network-wide STM reliability for Montréal, live on-time performance, crowding and feed freshness, measured from the open /v1 contract. No fabricated data.',
			fr: 'Fiabilité du réseau STM de Montréal, ponctualité, achalandage et fraîcheur des données en direct, mesurés depuis le contrat ouvert /v1, jamais inventés.',
		},
	},
	'/search': {
		title: { en: 'Search', fr: 'Recherche' },
		description: {
			en: 'Search the Montréal STM network by line number, line name, stop name or stop code, results link straight to live, measured detail. We never invent data.',
			fr: 'Cherchez le réseau STM de Montréal par numéro, nom de ligne, nom ou code d’arrêt, les résultats mènent au détail mesuré en direct, jamais inventé.',
		},
	},
	'/metrics': {
		title: { en: 'How we measure', fr: 'Comment on mesure' },
		description: {
			en: 'How every STM reliability number on this dashboard is measured, definition, exact math, SQL and honest caveats for each metric. Proxy, not certified OTP.',
			fr: 'Comment chaque chiffre de fiabilité STM de ce tableau de bord est mesuré, définition, calcul exact, SQL et limites honnêtes par métrique. Un proxy, pas une ponctualité certifiée.',
		},
	},
};

const LINE_DETAIL: BilingualSeo = {
	title: { en: 'Line detail', fr: 'Détail de la ligne' },
	description: {
		en: 'STM line detail, schedule, direction and historic on-time reliability for this Montréal route, measured live from the open /v1 data contract.',
		fr: 'Détail de ligne STM, horaire, direction et fiabilité historique de ponctualité pour cette ligne de Montréal, mesurés en direct depuis le contrat /v1.',
	},
};

const STOP_DETAIL: BilingualSeo = {
	title: { en: 'Stop detail', fr: "Détail de l'arrêt" },
	description: {
		en: 'STM stop detail, next departures, schedule and reliability for this Montréal stop, measured live from the open /v1 data contract. We never invent data.',
		fr: "Détail d'arrêt STM, prochains départs, horaire et fiabilité pour cet arrêt de Montréal, mesurés en direct depuis le contrat ouvert /v1, jamais inventés.",
	},
};

function entryFor(path: string): BilingualSeo {
	if (path === '/') return HOME;
	if (SURFACES[path]) return SURFACES[path];
	if (path.startsWith('/route/')) return LINE_DETAIL;
	if (path.startsWith('/stop/')) return STOP_DETAIL;
	return HOME;
}

/** Resolve SEO copy for a (possibly locale-prefixed) pathname in the active locale. */
export function resolveRouteSeo(pathname: string, locale: Locale): RouteSeo {
	const entry = entryFor(delocalizePath(pathname));
	return { title: entry.title[locale], description: entry.description[locale] };
}

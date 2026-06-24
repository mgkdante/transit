// routeSeo, per-surface SEO copy for the citizen dashboard (the route-seo
// factory, adapted from yesid.dev's $lib/adapters/route-seo-factories.ts).
//
// One place maps a DELOCALIZED path to its bilingual <title>/description so the
// root layout can render a single <SeoHead> with real per-route metadata instead
// of one global title on every page. Descriptions sit in the ~120–160 char SEO
// sweet spot SeoHead warns about. Per-ENTITY detail SEO (a specific line/stop
// name) is data-dependent and loads client-side today, these detail entries are
// the section-level fallback; richer per-entity titles are a tracked follow-up.
//
// PROVIDER-AGNOSTIC: this module contains NO agency/city literals. The provider
// identity (short_name + city) is INJECTED at call time via the optional
// `identity` arg, sourced from the /v1 manifest at runtime and from env
// (PUBLIC_PROVIDER_SHORT_NAME / .city) at SSR. When BOTH tokens are present we
// render the KEYWORDED copy; otherwise we fall back to the NEUTRAL,
// network-generic copy. Both variants are held inside the 120–160 char budget.

import { delocalizePath, localizeHref, type Locale } from '$lib/i18n';

export interface RouteSeo {
	title: string;
	description: string;
}

/** One resolved breadcrumb crumb: a localized label and a delocalized path. */
export interface BreadcrumbTrailItem {
	/** Already-localized, human-facing label. */
	name: string;
	/** Delocalized path for this crumb (locale prefix applied by the consumer). */
	path: string;
}

/** Bilingual crumb labels for the breadcrumb trail (the leaf is the URL id). */
const CRUMB_LABELS = {
	home: { en: 'Home', fr: 'Accueil' },
	lines: { en: 'Lines', fr: 'Lignes' },
	stops: { en: 'Stops', fr: 'Arrêts' },
} satisfies Record<string, BilingualText>;

/** Bilingual name/description for the open-transit-data Dataset JSON-LD node. */
const DATASET_COPY = {
	name: { en: 'Open transit dataset', fr: 'Jeu de données de transport ouvert' },
	description: {
		en: 'Open transit reliability, schedule and live-feed data measured from the public /v1 contract, refreshed continuously and free to reuse under CC BY 4.0.',
		fr: 'Données ouvertes de fiabilité, horaires et flux en direct mesurées depuis le contrat public /v1, rafraîchies en continu et libres de réutilisation sous CC BY 4.0.',
	},
} satisfies Record<'name' | 'description', BilingualText>;

/**
 * Provider identity tokens injected into the keyworded SEO copy. When both
 * `shortName` AND `city` are non-empty, the keyworded copy is used; any other
 * shape (absent, partial, blank) falls back to the neutral, generic copy.
 */
export interface ProviderSeoIdentity {
	shortName?: string | null;
	city?: string | null;
}

/** Resolved, non-empty identity tokens (the keyworded branch precondition). */
interface ResolvedIdentity {
	shortName: string;
	city: string;
}

interface BilingualText {
	readonly en: string;
	readonly fr: string;
}

interface BilingualSeo {
	readonly title: BilingualText;
	/** Keyworded copy: a builder that injects the resolved provider tokens. */
	readonly description: (id: ResolvedIdentity) => BilingualText;
	/** Neutral, provider-generic copy used when no identity is resolved. */
	readonly neutralDescription: BilingualText;
	/** Keyworded title override (home only); falls back to `title` otherwise. */
	readonly keywordTitle?: (id: ResolvedIdentity) => BilingualText;
}

const HOME: BilingualSeo = {
	title: { en: 'Live transit map', fr: 'Carte du réseau en direct' },
	keywordTitle: (id) => ({
		en: `Live ${id.shortName} map`,
		fr: `Carte ${id.shortName} en direct`,
	}),
	description: (id) => ({
		en: `Live ${id.shortName} transit dashboard for ${id.city}: real-time buses, stops, lines, on-time performance and service alerts, measured from the open /v1 data contract.`,
		fr: `Tableau de bord ${id.shortName} de ${id.city} en direct: bus, arrêts, lignes, ponctualité et alertes de service en temps réel, mesurés depuis le contrat ouvert /v1.`,
	}),
	neutralDescription: {
		en: 'Live transit dashboard with real-time buses, stops, lines, on-time performance and service alerts across the network, measured from the open /v1 data contract.',
		fr: 'Tableau de bord du réseau en direct: bus, arrêts, lignes, ponctualité et alertes de service en temps réel, mesurés depuis le contrat ouvert /v1.',
	},
};

const SURFACES: Record<string, BilingualSeo> = {
	'/map': {
		title: { en: 'Live map', fr: 'Carte en direct' },
		description: (id) => ({
			en: `Live map of every ${id.shortName} bus and stop across ${id.city}: real-time positions, crowding and service alerts, measured from the open /v1 data contract.`,
			fr: `Carte en direct de chaque bus et arrêt ${id.shortName} à ${id.city}: positions, achalandage et alertes de service en temps réel, mesurés depuis le contrat ouvert /v1.`,
		}),
		neutralDescription: {
			en: 'Live map of every bus and stop across the network: real-time positions, crowding and service alerts, measured from the open /v1 data contract.',
			fr: 'Carte en direct de chaque bus et arrêt du réseau: positions, achalandage et alertes de service en temps réel, mesurés depuis le contrat ouvert /v1.',
		},
	},
	'/lines': {
		title: { en: 'Lines', fr: 'Lignes' },
		description: (id) => ({
			en: `Every ${id.shortName} line: per-route schedule, direction and historic on-time reliability for ${id.city} buses and métro, measured from the open /v1 data contract.`,
			fr: `Chaque ligne ${id.shortName}: horaire, direction et fiabilité historique de ponctualité pour les bus et le métro de ${id.city}, mesurés depuis le contrat ouvert /v1.`,
		}),
		neutralDescription: {
			en: 'Every transit line: per-route schedule, direction and historic on-time reliability across the network, measured from the open /v1 data contract.',
			fr: 'Chaque ligne du réseau: horaire, direction et fiabilité historique de ponctualité par ligne, mesurés depuis le contrat ouvert /v1, jamais inventés.',
		},
	},
	'/stops': {
		title: { en: 'Stops', fr: 'Arrêts' },
		description: (id) => ({
			en: `Find any ${id.shortName} stop in ${id.city}: next departures, schedules and per-stop reliability, measured from the open /v1 data contract. We never invent data.`,
			fr: `Trouvez n'importe quel arrêt ${id.shortName} à ${id.city}: prochains départs, horaires et fiabilité par arrêt, mesurés depuis le contrat ouvert /v1, jamais inventés.`,
		}),
		neutralDescription: {
			en: 'Find any stop across the network: next departures, schedules and per-stop reliability, measured from the open /v1 data contract. We never invent data.',
			fr: "Trouvez n'importe quel arrêt du réseau: prochains départs, horaires et fiabilité par arrêt, mesurés depuis le contrat ouvert /v1, jamais inventés.",
		},
	},
	'/network': {
		title: { en: 'Network health', fr: 'Santé du réseau' },
		description: (id) => ({
			en: `Network-wide ${id.shortName} reliability for ${id.city}: live on-time performance, crowding and feed freshness, measured from the open /v1 data contract. No fabricated data.`,
			fr: `Fiabilité du réseau ${id.shortName} de ${id.city}: ponctualité, achalandage et fraîcheur des données en direct, mesurés depuis le contrat ouvert /v1, jamais inventés.`,
		}),
		neutralDescription: {
			en: 'Network-wide transit reliability: live on-time performance, crowding and feed freshness, measured from the open /v1 data contract. No fabricated data here.',
			fr: 'Fiabilité de tout le réseau: ponctualité, achalandage et fraîcheur des données en direct, mesurés depuis le contrat ouvert /v1, jamais inventés du tout.',
		},
	},
	'/search': {
		title: { en: 'Search', fr: 'Recherche' },
		description: (id) => ({
			en: `Search the ${id.city} ${id.shortName} network by line number, line name, stop name or stop code; results link straight to live, measured detail. We never invent data.`,
			fr: `Cherchez le réseau ${id.shortName} de ${id.city} par numéro, nom de ligne, nom ou code d'arrêt; les résultats mènent au détail mesuré en direct, jamais inventé.`,
		}),
		neutralDescription: {
			en: 'Search the transit network by line number, line name, stop name or stop code; results link straight to live, measured detail. We never invent data here.',
			fr: "Cherchez le réseau par numéro de ligne, nom de ligne, nom ou code d'arrêt; les résultats mènent au détail mesuré en direct, jamais inventé.",
		},
	},
	'/metrics': {
		title: { en: 'How we measure', fr: 'Comment on mesure' },
		description: (id) => ({
			en: `How every ${id.shortName} reliability number for ${id.city} on this dashboard is measured: definition, exact math, SQL and honest caveats. A proxy, not certified OTP.`,
			fr: `Comment chaque chiffre de fiabilité ${id.shortName} de ${id.city} est mesuré: définition, calcul exact, SQL et limites honnêtes. Un proxy, pas une ponctualité certifiée.`,
		}),
		neutralDescription: {
			en: 'How every reliability number on this dashboard is measured: definition, exact math, SQL and honest caveats for each metric. A proxy, not certified OTP here.',
			fr: 'Comment chaque chiffre de fiabilité du réseau est mesuré: définition, calcul exact, SQL et limites honnêtes. Un proxy, pas une ponctualité certifiée ici.',
		},
	},
	'/status': {
		title: { en: 'Data health', fr: 'Santé des données' },
		description: (id) => ({
			en: `Data health for the ${id.shortName} feeds in ${id.city}: how fresh each source is, where it came from, known gaps, retention and feed conformance, from the /v1 contract.`,
			fr: `Santé des données des flux ${id.shortName} de ${id.city}: fraîcheur de chaque source, provenance, lacunes connues, conservation et conformité, depuis le contrat ouvert /v1.`,
		}),
		neutralDescription: {
			en: 'Data health for the network feeds: how fresh each source is, where it came from, known gaps, retention and feed conformance, from the open /v1 contract.',
			fr: 'Santé des données du réseau: fraîcheur de chaque source, provenance, lacunes connues, conservation et conformité, depuis le contrat ouvert /v1.',
		},
	},
	'/hotspots': {
		title: { en: 'Hotspots', fr: 'Points chauds' },
		description: (id) => ({
			en: `The ${id.shortName} lines and stops dragging ${id.city} down, ranked worst first by on-time points lost, measured from the open /v1 data contract.`,
			fr: `Les lignes et arrêts ${id.shortName} qui tirent ${id.city} vers le bas, classés du pire au moins pire selon la ponctualité perdue, depuis le contrat ouvert /v1.`,
		}),
		neutralDescription: {
			en: 'The transit lines and stops dragging the network down, ranked worst first by on-time points lost, measured from the open /v1 data contract.',
			fr: 'Les lignes et arrêts qui tirent le réseau vers le bas, classés du pire au moins pire selon la ponctualité perdue, depuis le contrat ouvert /v1.',
		},
	},
	'/receipt': {
		title: { en: 'Daily receipt', fr: 'Reçu quotidien' },
		description: (id) => ({
			en: `The ${id.shortName} daily service receipt for ${id.city}: one day's reliability, average delay and the worst route and stop, issued daily from the open /v1 contract.`,
			fr: `Le reçu de service ${id.shortName} quotidien de ${id.city}: fiabilité du jour, retard moyen et pire ligne et arrêt, émis chaque jour depuis le contrat ouvert /v1.`,
		}),
		neutralDescription: {
			en: "The daily transit service receipt: one day's reliability, average delay and the worst route and stop on the network, issued daily from the open /v1 contract.",
			fr: 'Le reçu de service quotidien du réseau: fiabilité du jour, retard moyen et pire ligne et arrêt, émis chaque jour depuis le contrat ouvert /v1, jamais inventés.',
		},
	},
	'/repeat-offenders': {
		title: { en: 'Repeat offenders', fr: 'Récidivistes' },
		description: (id) => ({
			en: `The ${id.shortName} routes and stops in ${id.city} that run late again and again, ranked worst first by how reliably they slip, from the open /v1 data contract.`,
			fr: `Les lignes et arrêts ${id.shortName} de ${id.city} qui accumulent les retards, classés du pire au moins pire selon la régularité des ratés, depuis le contrat ouvert /v1.`,
		}),
		neutralDescription: {
			en: 'The transit routes and stops that run late again and again, ranked worst first by how reliably they slip, measured from the open /v1 data contract.',
			fr: 'Les lignes et arrêts du réseau qui accumulent les retards, classés du pire au moins pire selon la régularité de leurs ratés, depuis le contrat ouvert /v1.',
		},
	},
	'/alerts': {
		title: { en: 'Alerts', fr: 'Avis' },
		description: (id) => ({
			en: `Past ${id.shortName} service alerts for ${id.city}, newest first, with their duration, cause, effect and reach, archived from the open /v1 data contract. Never invented.`,
			fr: `Les avis de service ${id.shortName} passés de ${id.city}, du plus récent au plus ancien, avec durée, cause, effet et portée, archivés depuis le contrat ouvert /v1.`,
		}),
		neutralDescription: {
			en: 'Past transit service alerts across the network, newest first, with their duration, cause, effect and reach, archived from the open /v1 data contract.',
			fr: 'Les avis de service passés du réseau, du plus récent au plus ancien, avec durée, cause, effet et portée, archivés depuis le contrat ouvert /v1.',
		},
	},
};

const LINE_DETAIL: BilingualSeo = {
	title: { en: 'Line detail', fr: 'Détail de la ligne' },
	description: (id) => ({
		en: `${id.shortName} line detail: schedule, direction and historic on-time reliability for this ${id.city} route, measured live from the open /v1 data contract.`,
		fr: `Détail de ligne ${id.shortName}: horaire, direction et fiabilité historique de ponctualité pour cette ligne de ${id.city}, mesurés en direct depuis le contrat ouvert /v1.`,
	}),
	neutralDescription: {
		en: 'Transit line detail: schedule, direction and historic on-time reliability for this route, measured live from the open /v1 data contract. We never invent data.',
		fr: 'Détail de ligne: horaire, direction et fiabilité historique de ponctualité pour cette ligne, mesurés en direct depuis le contrat ouvert /v1, jamais inventés.',
	},
};

const STOP_DETAIL: BilingualSeo = {
	title: { en: 'Stop detail', fr: "Détail de l'arrêt" },
	description: (id) => ({
		en: `${id.shortName} stop detail: next departures, schedule and reliability for this ${id.city} stop, measured live from the open /v1 data contract. We never invent data.`,
		fr: `Détail d'arrêt ${id.shortName}: prochains départs, horaire et fiabilité pour cet arrêt de ${id.city}, mesurés en direct depuis le contrat ouvert /v1, jamais inventés.`,
	}),
	neutralDescription: {
		en: 'Transit stop detail: next departures, schedule and reliability for this stop, measured live from the open /v1 data contract. We never invent data, ever.',
		fr: "Détail d'arrêt: prochains départs, horaire et fiabilité pour cet arrêt du réseau, mesurés en direct depuis le contrat ouvert /v1, jamais inventés du tout.",
	},
};

const TRIP_DETAIL: BilingualSeo = {
	title: { en: 'Trip detail', fr: 'Détail du trajet' },
	description: (id) => ({
		en: `${id.shortName} trip detail: live status, delay and remaining-stop predictions for one running ${id.city} trip, measured from the open /v1 data contract.`,
		fr: `Détail de trajet ${id.shortName}: statut, retard et prédictions des prochains arrêts pour un trajet en cours à ${id.city}, mesurés depuis le contrat ouvert /v1.`,
	}),
	neutralDescription: {
		en: 'Transit trip detail: live status, delay and remaining-stop predictions for one running trip, from the open /v1 data contract. Predictions, not guarantees.',
		fr: 'Détail de trajet: statut, retard et prédictions des prochains arrêts pour un trajet en cours, depuis le contrat ouvert /v1. Prédictions, pas garanties.',
	},
};

function entryFor(path: string): BilingualSeo {
	if (path === '/') return HOME;
	if (SURFACES[path]) return SURFACES[path];
	if (path.startsWith('/lines/')) return LINE_DETAIL;
	if (path.startsWith('/stop/')) return STOP_DETAIL;
	if (path.startsWith('/trip/')) return TRIP_DETAIL;
	return HOME;
}

/**
 * EPHEMERAL surfaces whose URL identifies a short-lived entity that should never
 * be indexed even when the site is indexable. A trip id rotates with each run of
 * the GTFS-rt feed, so /trip/[id] deep links go stale within minutes — indexing
 * them would fill search results with dead pages. Detail surfaces over STABLE
 * ids (/lines, /stop) stay indexable; only /trip is ephemeral today.
 */
export function isEphemeralPath(pathname: string): boolean {
	return delocalizePath(pathname).startsWith('/trip/');
}

/** Resolve a non-empty (shortName, city) pair, or null when either is missing. */
function resolveIdentity(identity?: ProviderSeoIdentity): ResolvedIdentity | null {
	const shortName = identity?.shortName?.trim();
	const city = identity?.city?.trim();
	if (!shortName || !city) return null;
	return { shortName, city };
}

/**
 * Resolve SEO copy for a (possibly locale-prefixed) pathname in the active
 * locale. When `identity` carries BOTH a non-empty shortName AND city, the
 * keyworded copy injects those tokens; otherwise the neutral, provider-generic
 * copy is returned. Called with no third arg, returns the neutral copy.
 */
export function resolveRouteSeo(
	pathname: string,
	locale: Locale,
	identity?: ProviderSeoIdentity,
): RouteSeo {
	const entry = entryFor(delocalizePath(pathname));
	const resolved = resolveIdentity(identity);
	if (resolved) {
		const title = (entry.keywordTitle ?? (() => entry.title))(resolved);
		return { title: title[locale], description: entry.description(resolved)[locale] };
	}
	return { title: entry.title[locale], description: entry.neutralDescription[locale] };
}

/**
 * Resolve the breadcrumb trail for a (possibly locale-prefixed) pathname. Only
 * the STABLE detail surfaces get a trail today: /lines/[id] → Home > Lines >
 * <id> and /stop/[id] → Home > Stops > <id>. The leaf label is the URL id
 * segment (route number / stop code) — crawler-visible at SSR with no client
 * data. Every other surface returns an empty trail (the caller omits the node).
 *
 * Paths are delocalized; the caller localizes each crumb path for the active
 * locale. Returns [] for surfaces without a meaningful hierarchy.
 *
 * TODO(seo): the leaf uses the URL id (route number / stop code), not the entity
 * NAME (line headsign / stop name). A per-entity leaf label — and matching per-
 * entity <title>/description — needs the data-binding SSR-seed (the /v1 entity
 * resolved server-side), which is out of scope for this header-level pass.
 */
export function resolveBreadcrumbTrail(pathname: string, locale: Locale): BreadcrumbTrailItem[] {
	const path = delocalizePath(pathname);
	const home: BreadcrumbTrailItem = { name: CRUMB_LABELS.home[locale], path: '/' };

	if (path.startsWith('/lines/')) {
		const id = decodeURIComponent(path.slice('/lines/'.length));
		if (!id) return [];
		return [home, { name: CRUMB_LABELS.lines[locale], path: '/lines' }, { name: id, path }];
	}
	if (path.startsWith('/stop/')) {
		const id = decodeURIComponent(path.slice('/stop/'.length));
		if (!id) return [];
		return [home, { name: CRUMB_LABELS.stops[locale], path: '/stops' }, { name: id, path }];
	}
	return [];
}

/** Bilingual Dataset JSON-LD copy (name + description) for the active locale. */
export function resolveDatasetSeo(locale: Locale): { name: string; description: string } {
	return { name: DATASET_COPY.name[locale], description: DATASET_COPY.description[locale] };
}

/** Build absolute, locale-prefixed breadcrumb items for the BreadcrumbList node. */
export function breadcrumbItemsForHead(
	pathname: string,
	locale: Locale,
	siteOrigin: string,
): { name: string; url: string }[] {
	return resolveBreadcrumbTrail(pathname, locale).map((crumb) => ({
		name: crumb.name,
		url: `${siteOrigin}${localizeHref(crumb.path, locale)}`,
	}));
}

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

const CRUMB_LABELS = {
	home: { en: 'Home', fr: 'Accueil' },
	lines: { en: 'Lines', fr: 'Lignes' },
	stops: { en: 'Stops', fr: 'Arrêts' },
} satisfies Record<string, BilingualText>;

const DATASET_COPY = {
	name: { en: 'Open transit dataset', fr: 'Jeu de données de transport ouvert' },
	description: {
		en: 'Open transit reliability, schedule and vehicle-report data, published under CC BY 4.0.',
		fr: 'Données ouvertes sur la fiabilité, les horaires et les véhicules du réseau, publiées sous CC BY 4.0.',
	},
} satisfies Record<'name' | 'description', BilingualText>;

/** Use provider-specific copy only when both identity fields are present. */
export interface ProviderSeoIdentity {
	shortName?: string | null;
	city?: string | null;
}

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
	readonly description: (id: ResolvedIdentity) => BilingualText;
	readonly neutralDescription: BilingualText;
	/** Keyworded title override (home only); falls back to `title` otherwise. */
	readonly keywordTitle?: (id: ResolvedIdentity) => BilingualText;
}

const HOME: BilingualSeo = {
	title: { en: 'Transit network overview', fr: 'Vue d’ensemble du réseau' },
	keywordTitle: (id) => ({
		en: `${id.shortName} network overview`,
		fr: `Vue du réseau ${id.shortName}`,
	}),
	description: (id) => ({
		en: `Explore ${id.shortName} transit in ${id.city}: live bus reports, route and stop information, service alerts and reliability trends.`,
		fr: `Explorez le réseau ${id.shortName} à ${id.city} : données des bus, lignes, arrêts, avis de service et tendances de fiabilité.`,
	}),
	neutralDescription: {
		en: 'Explore transit reports, route and stop information, service alerts and reliability trends across the network.',
		fr: 'Explorez les données du réseau : bus, lignes, arrêts, avis de service et tendances de fiabilité.',
	},
};

const PRIVACY_DESCRIPTION: BilingualText = {
	en: 'How Transit handles Cloudflare request analytics, address searches, device location, browser storage, retention and privacy requests.',
	fr: 'Comment Transit traite l’analyse Cloudflare, la recherche d’adresse, la localisation, le stockage du navigateur, la conservation et vos droits.',
};

const TERMS_DESCRIPTION: BilingualText = {
	en: 'Terms for using the hosted Transit site and public data endpoints, including attribution, acceptable use, service limits and separately licensed source.',
	fr: 'Conditions d’utilisation du site Transit hébergé et de ses données publiques : attribution, usage acceptable, limites du service et code sous licence distincte.',
};

const SURFACES: Record<string, BilingualSeo> = {
	'/map': {
		title: { en: 'Live map', fr: 'Carte en direct' },
		description: (id) => ({
			en: `View reported ${id.shortName} vehicle positions and stops in ${id.city}, with available crowding data and service alerts.`,
			fr: `Consultez les positions signalées des véhicules ${id.shortName} et les arrêts à ${id.city}, avec les avis et les données d’occupation disponibles.`,
		}),
		neutralDescription: {
			en: 'View reported vehicle positions and stops, with available crowding data and service alerts. Reports may be delayed or missing.',
			fr: 'Consultez les positions signalées, les arrêts, les avis et les données d’occupation disponibles. Certaines données peuvent manquer ou dater.',
		},
	},
	'/lines': {
		title: { en: 'Lines', fr: 'Lignes' },
		description: (id) => ({
			en: `Browse ${id.shortName} lines in ${id.city} by mode and available reliability. Open a line for its route, directions and schedule.`,
			fr: `Parcourez les lignes ${id.shortName} à ${id.city}, leurs modes et leur fiabilité disponible. Consultez le parcours et l’horaire d’une ligne.`,
		}),
		neutralDescription: {
			en: 'Browse transit lines by mode and available reliability. Open a line for its route, directions and schedule.',
			fr: 'Parcourez les lignes par mode et selon la fiabilité disponible, puis consultez leurs parcours, directions et horaires.',
		},
	},
	'/stops': {
		title: { en: 'Stops', fr: 'Arrêts' },
		description: (id) => ({
			en: `Find ${id.shortName} stops in ${id.city} by name, code or line, then view predicted departures and available reliability history.`,
			fr: `Trouvez un arrêt ${id.shortName} à ${id.city} par nom, code ou ligne, puis consultez les passages prévus et l’historique disponible.`,
		}),
		neutralDescription: {
			en: 'Find stops by name, code or line, then view predicted departures and available reliability history.',
			fr: 'Trouvez un arrêt par nom, code ou ligne, puis consultez les passages prévus et l’historique de fiabilité disponible.',
		},
	},
	'/network': {
		title: { en: 'Network health', fr: 'Santé du réseau' },
		description: (id) => ({
			en: `View the latest ${id.shortName} reports and historical trends in ${id.city}: punctuality, delays, crowding and reported service.`,
			fr: `Consultez les données récentes ${id.shortName} à ${id.city} et les tendances de ponctualité, retards, occupation et service signalé.`,
		}),
		neutralDescription: {
			en: 'View the latest network reports and historical trends in punctuality, delays, crowding and reported service.',
			fr: 'Consultez les données récentes du réseau et les tendances de ponctualité, retards, occupation et service signalé.',
		},
	},
	'/search': {
		title: { en: 'Search', fr: 'Recherche' },
		description: (id) => ({
			en: `Find ${id.shortName} lines, stops and reported buses in ${id.city} by name, number, stop code or vehicle ID.`,
			fr: `Recherchez les lignes, arrêts et bus signalés ${id.shortName} à ${id.city} par nom, numéro, code d’arrêt ou identifiant.`,
		}),
		neutralDescription: {
			en: 'Find a line, stop or reported bus by name, number, stop code or vehicle ID, with links to its details.',
			fr: 'Recherchez une ligne, un arrêt ou un bus signalé par nom, numéro, code d’arrêt ou identifiant, puis ouvrez sa fiche.',
		},
	},
	'/metrics': {
		title: { en: 'How we measure', fr: 'Comment on mesure' },
		description: (id) => ({
			en: `Read definitions, calculations and limits for ${id.shortName} reliability in ${id.city}. Indicators use predictions, not certified arrival times.`,
			fr: `Définitions, calculs et limites des indicateurs ${id.shortName} à ${id.city}, issus des prévisions et non d’arrivées certifiées.`,
		}),
		neutralDescription: {
			en: 'Read metric definitions, calculations and limitations. Reliability indicators use predictions, not certified arrival measurements.',
			fr: 'Consultez les définitions, calculs et limites des indicateurs de fiabilité issus des prévisions, et non d’arrivées certifiées.',
		},
	},
	'/status': {
		title: { en: 'Data health', fr: 'Santé des données' },
		description: (id) => ({
			en: `Check ${id.shortName} data for ${id.city}: feed freshness, sources, known gaps, retention, published history and schedule conformance.`,
			fr: `Consultez l’âge des données ${id.shortName} à ${id.city}, leurs sources, les lacunes, l’historique publié et la conformité des horaires.`,
		}),
		neutralDescription: {
			en: 'Check feed freshness, sources, known gaps, retention, published history coverage and schedule conformance.',
			fr: 'Consultez l’âge des données, leurs sources, les lacunes, la conservation, l’historique publié et la conformité des horaires.',
		},
	},
	'/hotspots': {
		title: { en: 'Hotspots', fr: 'Points chauds' },
		description: (id) => ({
			en: `Compare severe ${id.shortName} delays in ${id.city} across lines and stops, with observation counts and confidence intervals for the rankings.`,
			fr: `Comparez les retards graves ${id.shortName} à ${id.city} par ligne et arrêt, avec le nombre d’observations et les intervalles de confiance.`,
		}),
		neutralDescription: {
			en: 'Compare severe delays across lines and stops, with observation counts and confidence intervals for the published rankings.',
			fr: 'Comparez les retards graves par ligne et arrêt, avec le nombre d’observations et les intervalles de confiance du classement.',
		},
	},
	'/receipt': {
		title: { en: 'Daily receipt', fr: 'Reçu quotidien' },
		description: (id) => ({
			en: `Browse published ${id.shortName} daily reports for ${id.city}: punctuality, delays, reported service and affected lines and stops where available.`,
			fr: `Consultez les bilans quotidiens ${id.shortName} à ${id.city} : ponctualité, retards, service signalé et, selon les données, lignes et arrêts touchés.`,
		}),
		neutralDescription: {
			en: 'Browse published daily summaries of punctuality, delays and reported service, with affected lines and stops where available.',
			fr: 'Consultez les bilans quotidiens publiés : ponctualité, retards, service signalé et, selon les données, lignes et arrêts touchés.',
		},
	},
	'/repeat-offenders': {
		title: { en: 'Repeat offenders', fr: 'Récidivistes' },
		description: (id) => ({
			en: `Explore recurring ${id.shortName} delays in ${id.city} by trip and vehicle, with severe-delay rates, observed days and confidence intervals.`,
			fr: `Explorez les retards graves récurrents ${id.shortName} à ${id.city} par trajet et véhicule, avec les jours observés et les intervalles de confiance.`,
		}),
		neutralDescription: {
			en: 'Explore recurring severe delays by trip and vehicle, with observed days, delay rates and confidence intervals.',
			fr: 'Explorez les retards graves récurrents par trajet et véhicule, avec les jours observés, les taux et les intervalles de confiance.',
		},
	},
	'/alerts': {
		title: { en: 'Alerts', fr: 'Avis' },
		description: (id) => ({
			en: `Browse past ${id.shortName} service alerts for ${id.city} by date, line, stop or severity, with reported duration, cause and affected services.`,
			fr: `Parcourez les avis ${id.shortName} passés à ${id.city} par date, ligne, arrêt ou gravité, avec leur durée, cause et services touchés lorsqu’ils sont connus.`,
		}),
		neutralDescription: {
			en: 'Browse past service alerts by date, line, stop or severity, with reported duration, cause, effect and affected services.',
			fr: 'Parcourez les avis passés par date, ligne, arrêt ou gravité, avec leur durée, cause, effet et services touchés lorsqu’ils sont connus.',
		},
	},
	'/privacy': {
		title: { en: 'Privacy', fr: 'Confidentialité' },
		description: () => PRIVACY_DESCRIPTION,
		neutralDescription: PRIVACY_DESCRIPTION,
	},
	'/terms': {
		title: { en: 'Terms', fr: 'Conditions d’utilisation' },
		description: () => TERMS_DESCRIPTION,
		neutralDescription: TERMS_DESCRIPTION,
	},
};

const LINE_DETAIL: BilingualSeo = {
	title: { en: 'Line detail', fr: 'Détail de la ligne' },
	description: (id) => ({
		en: `View this ${id.shortName} line in ${id.city}: route, directions, schedule, reported vehicles, alerts and available reliability history.`,
		fr: `Consultez cette ligne ${id.shortName} à ${id.city} : parcours, directions, horaire, véhicules signalés, avis et historique de fiabilité disponible.`,
	}),
	neutralDescription: {
		en: 'View the line’s route, directions and schedule, with reported vehicles, service alerts and available reliability history.',
		fr: 'Consultez le parcours, les directions et l’horaire de la ligne, les véhicules signalés, les avis et l’historique de fiabilité disponible.',
	},
};

const STOP_DETAIL: BilingualSeo = {
	title: { en: 'Stop detail', fr: "Détail de l'arrêt" },
	description: (id) => ({
		en: `View this ${id.shortName} stop in ${id.city}: predicted departures, alerts, a sample weekday schedule and available reliability history.`,
		fr: `Consultez cet arrêt ${id.shortName} à ${id.city} : passages prévus, avis, exemple d’horaire en semaine et historique de fiabilité disponible.`,
	}),
	neutralDescription: {
		en: 'View predicted departures, service alerts, a sample weekday schedule and available reliability history for this stop.',
		fr: 'Consultez les passages prévus, les avis, un exemple d’horaire en semaine et l’historique de fiabilité disponible à cet arrêt.',
	},
};

const TRIP_DETAIL: BilingualSeo = {
	title: { en: 'Trip detail', fr: 'Détail du trajet' },
	description: (id) => ({
		en: `View reported ${id.shortName} trip status, delay and stop predictions for up to the next hour in ${id.city}. Predictions may change or be unavailable.`,
		fr: `Consultez un trajet ${id.shortName} à ${id.city} : statut, retard et passages prévus pour une heure au plus. Les prévisions peuvent changer ou manquer.`,
	}),
	neutralDescription: {
		en: 'View reported trip status, delay and stop predictions for up to the next hour. Predictions may change or be unavailable.',
		fr: 'Consultez le statut, le retard et les passages prévus du trajet pour une heure au plus. Les prévisions peuvent changer ou manquer.',
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

/** Report-specific trip pages may become unavailable; keep them out of search. */
export function isEphemeralPath(pathname: string): boolean {
	return delocalizePath(pathname).startsWith('/trip/');
}

function resolveIdentity(identity?: ProviderSeoIdentity): ResolvedIdentity | null {
	const shortName = identity?.shortName?.trim();
	const city = identity?.city?.trim();
	if (!shortName || !city) return null;
	return { shortName, city };
}

/** Resolve localized route metadata, using neutral copy for incomplete provider identity. */
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

/** Use URL identifiers for detail breadcrumbs; entity names are not guaranteed during SSR. */
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

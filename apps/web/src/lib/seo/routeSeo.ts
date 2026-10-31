import { delocalizePath, localizeHref, type Locale } from '$lib/i18n';
import cards from '../../../static/og/manifest.json';

export interface RouteSeo {
	title: string;
	description: string;
	siteName: string;
	providerId?: string;
	imagePath: string;
	imageAlt: string;
}

export interface BreadcrumbTrailItem {
	name: string;
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

export interface ProviderSeoIdentity {
	id?: string | null;
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
	readonly neutralDescription: BilingualText;
}

const HOME: BilingualSeo & {
	readonly description: (id: ResolvedIdentity) => BilingualText;
	readonly keywordTitle: (id: ResolvedIdentity) => BilingualText;
} = {
	title: { en: 'Transit network overview', fr: 'Vue d’ensemble du réseau' },
	keywordTitle: (id) => ({
		en: `${id.shortName} network overview`,
		fr: `Vue du réseau ${id.shortName}`,
	}),
	description: (id) => ({
		en: `Explore ${id.shortName} transit in ${id.city}: available vehicle reports, lines, stops and reliability trends.`,
		fr: `Explorez le réseau ${id.shortName} à ${id.city} : données disponibles sur les véhicules, les lignes, les arrêts et la fiabilité.`,
	}),
	neutralDescription: {
		en: 'Explore transit reports, route and stop information, and reliability trends across the network.',
		fr: 'Explorez les données du réseau : bus, lignes, arrêts et tendances de fiabilité.',
	},
};

const PRIVACY_DESCRIPTION: BilingualText = {
	en: 'How Transit handles address searches, device location, browser storage, retention and privacy requests.',
	fr: 'Comment Transit traite la recherche d’adresse, la localisation, le stockage du navigateur, la conservation et vos droits.',
};

const ACCESSIBILITY_DESCRIPTION: BilingualText = {
	en: 'Transit’s accessibility statement: the WCAG 2.2 AA target, what works today, known limitations and how to report a problem.',
	fr: 'Déclaration d’accessibilité de Transit : la cible WCAG 2.2 AA, ce qui fonctionne aujourd’hui, les limites connues et comment signaler un problème.',
};

const TERMS_DESCRIPTION: BilingualText = {
	en: 'Terms for using the hosted Transit site and public data endpoints, including attribution, acceptable use, service limits and separately licensed source.',
	fr: 'Conditions d’utilisation du site Transit hébergé et de ses données publiques : attribution, usage acceptable, limites du service et code sous licence distincte.',
};

const SURFACES: Record<string, BilingualSeo> = {
	'/map': {
		title: { en: 'Live map', fr: 'Carte en direct' },
		neutralDescription: {
			en: 'View reported vehicle positions and stops, with available crowding data. Reports may be delayed or missing.',
			fr: 'Consultez les positions signalées, les arrêts et les données d’occupation disponibles. Certaines données peuvent manquer ou dater.',
		},
	},
	'/lines': {
		title: { en: 'Lines', fr: 'Lignes' },
		neutralDescription: {
			en: 'Browse transit lines by mode and available reliability. Open a line for its route, directions and schedule.',
			fr: 'Parcourez les lignes par mode et selon la fiabilité disponible, puis consultez leurs parcours, directions et horaires.',
		},
	},
	'/stops': {
		title: { en: 'Stops', fr: 'Arrêts' },
		neutralDescription: {
			en: 'Find stops by name, code or line, then view predicted departures and available reliability history.',
			fr: 'Trouvez un arrêt par nom, code ou ligne, puis consultez les passages prévus et l’historique de fiabilité disponible.',
		},
	},
	'/network': {
		title: { en: 'Network health', fr: 'Santé du réseau' },
		neutralDescription: {
			en: 'View the latest network reports and historical trends in punctuality, delays, crowding and reported service.',
			fr: 'Consultez les données récentes du réseau et les tendances de ponctualité, retards, occupation et service signalé.',
		},
	},
	'/search': {
		title: { en: 'Search', fr: 'Recherche' },
		neutralDescription: {
			en: 'Find a line, stop or reported bus by name, number, stop code or vehicle ID, with links to its details.',
			fr: 'Recherchez une ligne, un arrêt ou un bus signalé par nom, numéro, code d’arrêt ou identifiant, puis ouvrez sa fiche.',
		},
	},
	'/metrics': {
		title: { en: 'How we measure', fr: 'Comment on mesure' },
		neutralDescription: {
			en: 'Read metric definitions, calculations and limitations. Reliability indicators use predictions, not certified arrival measurements.',
			fr: 'Consultez les définitions, calculs et limites des indicateurs de fiabilité issus des prévisions, et non d’arrivées certifiées.',
		},
	},
	'/status': {
		title: { en: 'Data health', fr: 'Santé des données' },
		neutralDescription: {
			en: 'Check feed freshness, sources, known gaps, retention, published history coverage and schedule conformance.',
			fr: 'Consultez l’âge des données, leurs sources, les lacunes, la conservation, l’historique publié et la conformité des horaires.',
		},
	},
	'/hotspots': {
		title: { en: 'Hotspots', fr: 'Points chauds' },
		neutralDescription: {
			en: 'Compare severe delays across lines and stops, with observation counts and confidence intervals for the published rankings.',
			fr: 'Comparez les retards graves par ligne et arrêt, avec le nombre d’observations et les intervalles de confiance du classement.',
		},
	},
	'/receipt': {
		title: { en: 'Daily receipt', fr: 'Reçu quotidien' },
		neutralDescription: {
			en: 'Browse published daily summaries of punctuality, delays and reported service, with affected lines and stops where available.',
			fr: 'Consultez les bilans quotidiens publiés : ponctualité, retards, service signalé et, selon les données, lignes et arrêts touchés.',
		},
	},
	'/repeat-offenders': {
		title: { en: 'Repeat offenders', fr: 'Récidivistes' },
		neutralDescription: {
			en: 'Explore recurring severe delays by trip and vehicle, with observed days, delay rates and confidence intervals.',
			fr: 'Explorez les retards graves récurrents par trajet et véhicule, avec les jours observés, les taux et les intervalles de confiance.',
		},
	},
	'/alerts': {
		title: { en: 'Alerts', fr: 'Avis' },
		neutralDescription: {
			en: 'Browse past service alerts by date, line, stop or severity, with reported duration, cause, effect and affected services.',
			fr: 'Parcourez les avis passés par date, ligne, arrêt ou gravité, avec leur durée, cause, effet et services touchés lorsqu’ils sont connus.',
		},
	},
	'/privacy': {
		title: { en: 'Privacy', fr: 'Confidentialité' },
		neutralDescription: PRIVACY_DESCRIPTION,
	},
	'/terms': {
		title: { en: 'Terms', fr: 'Conditions d’utilisation' },
		neutralDescription: TERMS_DESCRIPTION,
	},
	'/accessibility': {
		title: { en: 'Accessibility', fr: 'Accessibilité' },
		neutralDescription: ACCESSIBILITY_DESCRIPTION,
	},
};

const LINE_DETAIL: BilingualSeo = {
	title: { en: 'Line detail', fr: 'Détail de la ligne' },
	neutralDescription: {
		en: 'View the line’s route, directions and schedule, with reported vehicles and available reliability history.',
		fr: 'Consultez le parcours, les directions et l’horaire de la ligne, les véhicules signalés et l’historique de fiabilité disponible.',
	},
};

const STOP_DETAIL: BilingualSeo = {
	title: { en: 'Stop detail', fr: "Détail de l'arrêt" },
	neutralDescription: {
		en: 'View predicted departures, a sample weekday schedule and available reliability history for this stop.',
		fr: 'Consultez les passages prévus, un exemple d’horaire en semaine et l’historique de fiabilité disponible à cet arrêt.',
	},
};

const TRIP_DETAIL: BilingualSeo = {
	title: { en: 'Trip detail', fr: 'Détail du trajet' },
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

export function isEphemeralPath(pathname: string): boolean {
	return delocalizePath(pathname).startsWith('/trip/');
}

function resolveIdentity(identity?: ProviderSeoIdentity): ResolvedIdentity | null {
	const shortName = identity?.shortName?.trim();
	const city = identity?.city?.trim();
	if (!shortName || !city) return null;
	return { shortName, city };
}

export function resolveRouteSeo(
	url: string | URL,
	locale: Locale,
	identity?: ProviderSeoIdentity,
): RouteSeo {
	const request = typeof url === 'string' ? new URL(url, 'https://transit.local') : url;
	const path = delocalizePath(request.pathname);
	const entry = entryFor(path);
	const requested = request.searchParams.getAll('provider');
	// The caller supplies identity only from successful provider discovery.
	const providerId =
		requested.length === 1 && requested[0] === identity?.id
			? (identity?.id ?? undefined)
			: undefined;
	const resolved = resolveIdentity(identity);
	const homeProvider =
		path === '/' && providerId && resolved
			? cards.providers.find(
					(provider) =>
						provider.id === providerId &&
						provider.labels[locale].operator === resolved.shortName &&
						provider.labels[locale].city === resolved.city,
				)
			: undefined;
	const defaultImage = `/og/${locale}.png`;
	const variant = homeProvider ? `/og/home/${homeProvider.id}.${locale}.png` : defaultImage;
	const image = Object.hasOwn(cards.outputs, variant) ? variant : defaultImage;
	const fingerprint = cards.outputs[image as keyof typeof cards.outputs];
	const imagePath = `${image}?v=${fingerprint.slice(0, 16)}`;
	const imageAlt = homeProvider
		? `${homeProvider.labels[locale].operator} · ${homeProvider.labels[locale].city} · Transit`
		: HOME.title[locale];
	if (path === '/' && providerId && resolved) {
		const title = HOME.keywordTitle(resolved);
		return {
			title: title[locale],
			description: HOME.description(resolved)[locale],
			siteName: 'Transit',
			providerId,
			imagePath,
			imageAlt,
		};
	}
	return {
		title: entry.title[locale],
		description: entry.neutralDescription[locale],
		siteName: 'Transit',
		providerId,
		imagePath,
		imageAlt,
	};
}

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

export function resolveDatasetSeo(locale: Locale): { name: string; description: string } {
	return { name: DATASET_COPY.name[locale], description: DATASET_COPY.description[locale] };
}

export function breadcrumbItemsForHead(
	pathname: string,
	locale: Locale,
	siteOrigin: string,
	provider?: string,
): { name: string; url: string }[] {
	return resolveBreadcrumbTrail(pathname, locale).map((crumb) => ({
		name: crumb.name,
		url: `${siteOrigin}${localizeHref(crumb.path, locale, provider)}`,
	}));
}

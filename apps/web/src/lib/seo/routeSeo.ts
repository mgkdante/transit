import { shareCopy, shareKey, withShareCta } from './share-copy';
import { delocalizePath, localizeHref } from '../i18n/routing';
import type { Locale } from '../i18n/config';
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
}

const HOME: BilingualSeo & {
	readonly keywordTitle: (id: ResolvedIdentity) => BilingualText;
} = {
	title: { en: 'Transit network overview', fr: 'Vue d’ensemble du réseau' },
	keywordTitle: (id) => ({
		en: `${id.shortName} network overview`,
		fr: `Vue du réseau ${id.shortName}`,
	}),
};

const SURFACES: Record<string, BilingualSeo> = {
	'/map': {
		title: { en: 'Live map', fr: 'Carte en direct' },
	},
	'/lines': {
		title: { en: 'Lines', fr: 'Lignes' },
	},
	'/stops': {
		title: { en: 'Stops', fr: 'Arrêts' },
	},
	'/network': {
		title: { en: 'Network health', fr: 'Santé du réseau' },
	},
	'/search': {
		title: { en: 'Search', fr: 'Recherche' },
	},
	'/metrics': {
		title: { en: 'How we measure', fr: 'Comment on mesure' },
	},
	'/status': {
		title: { en: 'Data health', fr: 'Santé des données' },
	},
	'/hotspots': {
		title: { en: 'Hotspots', fr: 'Points chauds' },
	},
	'/receipt': {
		title: { en: 'Daily receipt', fr: 'Reçu quotidien' },
	},
	'/repeat-offenders': {
		title: { en: 'Repeat offenders', fr: 'Récidivistes' },
	},
	'/alerts': {
		title: { en: 'Alerts', fr: 'Avis' },
	},
	'/privacy': {
		title: { en: 'Privacy', fr: 'Confidentialité' },
	},
	'/terms': {
		title: { en: 'Terms', fr: 'Conditions d’utilisation' },
	},
	'/accessibility': {
		title: { en: 'Accessibility', fr: 'Accessibilité' },
	},
};

const LINE_DETAIL: BilingualSeo = {
	title: { en: 'Line detail', fr: 'Détail de la ligne' },
};

const STOP_DETAIL: BilingualSeo = {
	title: { en: 'Stop detail', fr: "Détail de l'arrêt" },
};

const TRIP_DETAIL: BilingualSeo = {
	title: { en: 'Trip detail', fr: 'Détail du trajet' },
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
	const copy = shareCopy(path, locale);
	const key = shareKey(path);
	const defaultImage =
		key === '/'
			? `/og/${locale}.png`
			: `/og/pages/${key.slice(1).replaceAll('/', '-')}.${locale}.png`;
	const variant = homeProvider ? `/og/home/${homeProvider.id}.${locale}.png` : defaultImage;
	const image = Object.hasOwn(cards.outputs, variant) ? variant : defaultImage;
	const fingerprint = cards.outputs[image as keyof typeof cards.outputs];
	const imagePath = `${image}?v=${fingerprint.slice(0, 16)}`;
	const imageAlt = homeProvider
		? `${homeProvider.labels[locale].operator} · ${homeProvider.labels[locale].city} · Transit`
		: entry.title[locale];
	if (path === '/' && providerId && resolved) {
		const title = HOME.keywordTitle(resolved);
		return {
			title: title[locale],
			description: withShareCta(
				`${resolved.shortName} · ${resolved.city}. ${copy.support}`,
				copy.cta,
			),
			siteName: 'Transit',
			providerId,
			imagePath,
			imageAlt,
		};
	}
	return {
		title: entry.title[locale],
		description: withShareCta(copy.support, copy.cta),
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

export function resolveCardTitle(path: string, locale: Locale): string {
	return entryFor(path).title[locale];
}

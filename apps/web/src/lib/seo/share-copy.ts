// Static invitations remain true when feeds are stale or unavailable.
import type { Locale } from '../i18n/config';
export const SHARE_COPY = {
	'/': {
		en: {
			support: 'Transit lines, stops and reliability reports',
			cta: 'Explore the network',
		},
		fr: {
			support: 'Lignes, arrêts et bilans de fiabilité',
			cta: 'Explorer le réseau',
		},
	},
	'/map': {
		en: {
			support: 'Reported vehicle positions and transit stops',
			cta: 'View the map',
		},
		fr: {
			support: 'Positions signalées des véhicules et arrêts',
			cta: 'Voir la carte',
		},
	},
	'/lines': {
		en: {
			support: 'Transit lines by mode, routes and schedules',
			cta: 'Browse lines',
		},
		fr: {
			support: 'Lignes par mode, parcours et horaires',
			cta: 'Voir les lignes',
		},
	},
	'/stops': {
		en: {
			support: 'Transit stops, predicted departures and schedules',
			cta: 'Find a stop',
		},
		fr: {
			support: 'Arrêts, passages prévus et horaires',
			cta: 'Trouver un arrêt',
		},
	},
	'/network': {
		en: {
			support: 'Transit punctuality, delays and reported service',
			cta: 'View network health',
		},
		fr: {
			support: 'Ponctualité, retards et service signalé',
			cta: 'Voir la santé du réseau',
		},
	},
	'/search': {
		en: {
			support: 'Transit lines, stops and reported vehicles',
			cta: 'Search Transit',
		},
		fr: {
			support: 'Lignes, arrêts et véhicules signalés',
			cta: 'Chercher dans Transit',
		},
	},
	'/metrics': {
		en: {
			support: 'Reliability metrics from predictions, with limits',
			cta: 'See how we measure',
		},
		fr: {
			support: 'Indicateurs de fiabilité issus des prévisions',
			cta: 'Voir comment on mesure',
		},
	},
	'/status': {
		en: {
			support: 'Feed age, sources and known data gaps',
			cta: 'Check data health',
		},
		fr: {
			support: 'Âge des données, sources et lacunes connues',
			cta: 'Voir la santé des données',
		},
	},
	'/hotspots': {
		en: {
			support: 'Severe transit delays by line and stop',
			cta: 'Compare hotspots',
		},
		fr: {
			support: 'Retards graves par ligne et arrêt',
			cta: 'Comparer les points chauds',
		},
	},
	'/receipt': {
		en: {
			support: 'Published daily transit reliability summaries',
			cta: 'View the daily receipt',
		},
		fr: {
			support: 'Bilans quotidiens publiés sur la fiabilité',
			cta: 'Voir le reçu quotidien',
		},
	},
	'/repeat-offenders': {
		en: {
			support: 'Recurring severe delays by trip and vehicle',
			cta: 'View repeat offenders',
		},
		fr: {
			support: 'Retards graves récurrents par trajet et véhicule',
			cta: 'Voir les récidivistes',
		},
	},
	'/alerts': {
		en: {
			support: 'Past transit service alerts and affected services',
			cta: 'Browse alerts',
		},
		fr: {
			support: 'Avis de service passés et services touchés',
			cta: 'Voir les avis',
		},
	},
	'/privacy': {
		en: {
			support: 'Visit measurement, location and browser storage',
			cta: 'Read the privacy policy',
		},
		fr: {
			support: 'Mesure des visites, localisation et stockage',
			cta: 'Lire la confidentialité',
		},
	},
	'/terms': {
		en: {
			support: 'Transit site and public data terms of use',
			cta: 'Read the terms',
		},
		fr: {
			support: 'Conditions du site Transit et des données publiques',
			cta: 'Lire les conditions',
		},
	},
	'/accessibility': {
		en: {
			support: 'Transit accessibility goals and known limitations',
			cta: 'Read the statement',
		},
		fr: {
			support: 'Objectifs d’accessibilité et limites connues',
			cta: 'Lire la déclaration',
		},
	},
	'/lines/detail': {
		en: {
			support: 'Line route, directions and schedule',
			cta: 'View the line',
		},
		fr: {
			support: 'Parcours, directions et horaire de la ligne',
			cta: 'Voir la ligne',
		},
	},
	'/stop/detail': {
		en: {
			support: 'Stop schedules and predicted departures',
			cta: 'View the stop',
		},
		fr: {
			support: 'Horaires et passages prévus à l’arrêt',
			cta: 'Voir l’arrêt',
		},
	},
	'/trip/detail': {
		en: {
			support: 'Reported trip status and stop predictions',
			cta: 'View the trip',
		},
		fr: {
			support: 'Statut signalé du trajet et passages prévus',
			cta: 'Voir le trajet',
		},
	},
} as const;
export function shareKey(path: string): keyof typeof SHARE_COPY {
	if (path.startsWith('/lines/')) return '/lines/detail';
	if (path.startsWith('/stop/')) return '/stop/detail';
	if (path.startsWith('/trip/')) return '/trip/detail';
	return Object.hasOwn(SHARE_COPY, path) ? (path as keyof typeof SHARE_COPY) : '/';
}
export function shareCopy(path: string, locale: Locale) {
	return SHARE_COPY[shareKey(path)][locale];
}
export function withShareCta(text: string, label: string): string {
	const trimmed = text.trim();
	const invitation = label + '.';
	if (trimmed.endsWith(invitation)) return trimmed;
	return trimmed.replace(/[.]+$/u, '') + '. ' + invitation;
}

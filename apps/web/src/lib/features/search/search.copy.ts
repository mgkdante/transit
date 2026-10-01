import { defineCopy, type Locale } from '$lib/i18n/copy';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const copy = defineCopy({
	en: {
		kicker: 'SEARCH',
		heading: 'Find a line, stop or bus',
		lede: 'Search the network by line number, line name, stop name, stop code or live bus id. Results link straight to live detail.',
		inputLabel: 'Search lines, stops and buses',
		inputPlaceholder: 'Search a line, stop or vehicle',
		linesLabel: 'Lines',
		stopsLabel: 'Stops',
		vehiclesLabel: 'Live buses',
		scopeLabel: 'Show',
		scopeAll: 'All',
		modeLabel: 'Mode',
		scopeCount: (label, n) => `${label} (${n})`,
		collectionNotice:
			'Lines, stops and buses are matched in your browser; address search is sent to our server and the Government of Canada Geo.ca service.',
		idleTitle: 'Search a line, stop or bus',
		idleBody: 'Type a line number, a line or stop name, a stop code, or a live bus id to find it.',
		census: {
			label: 'The network right now',
			lines: (n) => `${n} lines`,
			stops: (n) => `${n} stops`,
			examplesLabel: 'Try',
			examples: ['747', 'Berri-UQAM', 'Métro'],
		},
		more: (n) => `+${n} more`,
		resultCount: (n) => (n === 1 ? '1 result' : `${n} results`),
		vehicle: {
			busAria: (id) => `Live bus ${id}`,
			routeTag: (route) => `Route ${route}`,
			next: (stop) => `Next: ${stop}`,
			noNextStop: 'No next stop',
			heading: 'Heading',
			delay: 'Delay',
		},
	},
	fr: {
		kicker: 'RECHERCHE',
		heading: 'Trouver une ligne, un arrêt ou un bus',
		lede: 'Cherchez le réseau par numéro de ligne, nom de ligne, nom d’arrêt, code d’arrêt ou identifiant de bus en direct. Les résultats mènent directement au détail en direct.',
		inputLabel: 'Rechercher lignes, arrêts et bus',
		inputPlaceholder: 'Rechercher une ligne, un arrêt ou un véhicule',
		linesLabel: 'Lignes',
		stopsLabel: 'Arrêts',
		vehiclesLabel: 'Bus en direct',
		scopeLabel: 'Afficher',
		scopeAll: 'Tout',
		modeLabel: 'Mode',
		scopeCount: (label: string, n: number) => `${label} (${n})`,
		collectionNotice:
			'Les lignes, arrêts et bus sont trouvés dans votre navigateur ; la recherche d’adresse est envoyée à notre serveur et au service Géo.ca du gouvernement du Canada.',
		idleTitle: 'Rechercher une ligne, un arrêt ou un bus',
		idleBody:
			'Saisissez un numéro de ligne, un nom de ligne ou d’arrêt, un code d’arrêt, ou un identifiant de bus en direct pour le trouver.',
		census: {
			label: 'Le réseau en ce moment',
			lines: (n: string) => `${n} lignes`,
			stops: (n: string) => `${n} arrêts`,
			examplesLabel: 'Essayez',
			examples: ['747', 'Berri-UQAM', 'Métro'],
		},
		more: (n: number) => `+${n} de plus`,
		resultCount: (n: number) => (n === 1 ? '1 résultat' : `${n} résultats`),
		vehicle: {
			busAria: (id: string) => `Bus en direct ${id}`,
			routeTag: (route: string) => `Ligne ${route}`,
			next: (stop: string) => `Prochain : ${stop}`,
			noNextStop: 'Aucun prochain arrêt',
			heading: 'Direction',
			delay: 'Retard',
		},
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type SearchCopy = (typeof copy)[Locale];
export type VehicleResultCopy = SearchCopy['vehicle'];

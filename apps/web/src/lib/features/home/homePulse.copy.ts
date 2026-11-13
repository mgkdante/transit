import { defineCopy, type Locale } from '#lib/i18n/copy.ts';

type PulseKey =
	| 'title'
	| 'inService'
	| 'onTime'
	| 'onTimeNote'
	| 'severeLate'
	| 'severeLateNote'
	| 'ofCount'
	| 'early'
	| 'earlyNote'
	| 'notReporting'
	| 'notReportingNote'
	| 'liveUnavailable'
	| 'worstLines'
	| 'worstStops'
	| 'worstNote'
	| 'worstThrough'
	| 'worstUnavailable'
	| 'worstError'
	| 'unavailable'
	| 'lateRate'
	| 'allHotspots'
	| 'openMap'
	| 'openMapNote'
	| 'openNetwork'
	| 'openNetworkNote'
	| 'notMeasured';

export const homePulseCopy = defineCopy({
	fr: {
		title: 'En ce moment à {city}',
		inService: 'Bus en service',
		onTime: 'À l’heure',
		onTimeNote: 'de 1 min d’avance à 5 min de retard, parmi les bus mesurés',
		severeLate: 'Plus de 5 min de retard',
		severeLateNote: 'bus avec une mesure de retard',
		ofCount: 'sur {n}',
		early: 'Plus de 1 min d’avance',
		earlyNote: 'un bus en avance peut laisser des gens à l’arrêt',
		notReporting: 'Trajets sans signal',
		notReportingNote: 'prévus, mais aucun bus ne se signale',
		liveUnavailable: 'Chiffres en direct indisponibles pour le moment',
		worstLines: 'Lignes les plus en retard',
		worstStops: 'Arrêts les plus en retard',
		worstNote:
			'Part des mesures en retard de plus de 5 min, sur 7 jours. Le bilan est republié chaque semaine.',
		worstThrough: 'Données jusqu’au {date}',
		worstUnavailable: 'Aucun classement hebdomadaire publié pour l’instant.',
		worstError: 'Le classement n’a pas pu être chargé.',
		unavailable: 'indisponible',
		lateRate: '{pct} des mesures en retard de plus de 5 min',
		allHotspots: 'Tous les points chauds',
		openMap: 'Carte du réseau',
		openMapNote: 'Chaque bus en direct, là où il se signale',
		openNetwork: 'Santé du réseau',
		openNetworkNote: 'Retards, tendances et couverture des données',
		notMeasured: 'non mesuré',
	},
	en: {
		title: 'Right now in {city}',
		inService: 'Buses in service',
		onTime: 'On time',
		onTimeNote: '1 min early to 5 min late, among buses with a delay reading',
		severeLate: 'More than 5 min late',
		severeLateNote: 'buses with a delay reading',
		ofCount: 'of {n}',
		early: 'More than 1 min early',
		earlyNote: 'an early bus can leave riders behind',
		notReporting: 'Trips without a signal',
		notReportingNote: 'scheduled, but no bus is reporting',
		liveUnavailable: 'Live numbers unavailable right now',
		worstLines: 'Most delayed lines',
		worstStops: 'Most delayed stops',
		worstNote:
			'Share of readings more than 5 min late, over 7 days. The record is republished weekly.',
		worstThrough: 'Data through {date}',
		worstUnavailable: 'No weekly ranking has been published yet.',
		worstError: 'The rankings could not be loaded.',
		unavailable: 'unavailable',
		lateRate: '{pct} of readings more than 5 min late',
		allHotspots: 'All hotspots',
		openMap: 'Network map',
		openMapNote: 'Every bus, live, where it reports itself',
		openNetwork: 'Network health',
		openNetworkNote: 'Delays, trends and data coverage',
		notMeasured: 'not measured',
	},
} satisfies Readonly<Record<Locale, Readonly<Record<PulseKey, string>>>>);

export type HomePulseCopy = (typeof homePulseCopy)[Locale];

type InviteKey = 'title' | 'body' | 'contribute' | 'code' | 'contact' | 'support';

export const homeInviteCopy = defineCopy({
	fr: {
		title: 'Aidez à étendre Transit',
		body: 'Transit est un projet à code source ouvert, et nous cherchons des contributeurs. Il fonctionne avec toute société de transport qui publie des données GTFS et GTFS-Realtime, et les villes mesurées aujourd’hui ne sont que les premières. Ajoutez votre ville, améliorez une mesure, corrigez un défaut ou aidez à l’hébergement.',
		contribute: 'Comment contribuer',
		code: 'Voir le code',
		contact: 'Écrivez-nous',
		support:
			'Transit est un projet indépendant et bénévole. L’aide à l’hébergement est ce qui permet d’accueillir d’autres villes.',
	},
	en: {
		title: 'Help extend Transit',
		body: 'Transit is open source, and we are looking for contributors. It works with any agency that publishes GTFS and GTFS-Realtime data, and the cities measured today are only the first. Add your city, improve a metric, fix something or help with hosting.',
		contribute: 'How to contribute',
		code: 'View the code',
		contact: 'Get in touch',
		support:
			'Transit is an independent, volunteer project. Hosting help is what lets more cities join.',
	},
} satisfies Readonly<Record<Locale, Readonly<Record<InviteKey, string>>>>);

type SearchKey = 'label' | 'submit' | 'examplesLead';

export const homeSearchCopy = defineCopy({
	fr: {
		label: 'Cherchez votre ligne, votre arrêt ou votre adresse',
		submit: 'Rechercher',
		examplesLead: 'Par exemple :',
	},
	en: {
		label: 'Look up your line, stop or address',
		submit: 'Search',
		examplesLead: 'For example:',
	},
} satisfies Readonly<Record<Locale, Readonly<Record<SearchKey, string>>>>);

export const HOME_INVITE_LINKS = {
	contact: { en: 'https://yesid.dev/contact', fr: 'https://yesid.dev/fr/contact' },
	contribute: 'https://github.com/yesid-dev/transit/blob/main/CONTRIBUTING.md',
	code: 'https://github.com/yesid-dev/transit',
} as const;

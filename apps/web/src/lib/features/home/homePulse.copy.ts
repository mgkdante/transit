import { defineCopy, type Locale } from '#lib/i18n/copy.ts';

type PulseKey =
	| 'title'
	| 'inService'
	| 'onTime'
	| 'onTimeNote'
	| 'severeLate'
	| 'severeLateNote'
	| 'early'
	| 'earlyNote'
	| 'notReporting'
	| 'notReportingNote'
	| 'liveUnavailable'
	| 'worstLines'
	| 'worstStops'
	| 'worstNote'
	| 'worstUnavailable'
	| 'severeRate'
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
		severeLateNote: 'sur {n} bus avec une mesure de retard',
		early: 'Plus de 1 min d’avance',
		earlyNote: 'un bus en avance peut laisser des gens à l’arrêt',
		notReporting: 'Trajets sans signal',
		notReportingNote: 'prévus, mais aucun bus ne se signale',
		liveUnavailable:
			'Les chiffres en direct ne sont pas disponibles pour le moment. Ce n’est pas un zéro : la donnée manque.',
		worstLines: 'Lignes les plus en retard',
		worstStops: 'Arrêts les plus en retard',
		worstNote:
			'Taux de retards graves sur 7 jours, données jusqu’au {date}. Le bilan est republié chaque semaine.',
		worstUnavailable: 'Aucun classement hebdomadaire publié pour l’instant.',
		severeRate: '{pct} en retard grave',
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
		severeLateNote: 'of {n} buses with a delay reading',
		early: 'More than 1 min early',
		earlyNote: 'an early bus can leave riders behind',
		notReporting: 'Trips without a signal',
		notReportingNote: 'scheduled, but no bus is reporting',
		liveUnavailable: 'Live numbers are unavailable right now. That is missing data, not a zero.',
		worstLines: 'Most delayed lines',
		worstStops: 'Most delayed stops',
		worstNote:
			'Severe-delay rate over 7 days, data through {date}. The record is republished weekly.',
		worstUnavailable: 'No weekly ranking has been published yet.',
		severeRate: '{pct} severely late',
		allHotspots: 'All hotspots',
		openMap: 'Network map',
		openMapNote: 'Every bus, live, where it reports itself',
		openNetwork: 'Network health',
		openNetworkNote: 'Delays, trends and data coverage',
		notMeasured: 'not measured',
	},
} satisfies Readonly<Record<Locale, Readonly<Record<PulseKey, string>>>>);

export type HomePulseCopy = (typeof homePulseCopy)[Locale];

type InviteKey = 'title' | 'body' | 'contact' | 'code' | 'support';

export const homeInviteCopy = defineCopy({
	fr: {
		title: 'Amenez Transit dans votre ville',
		body: 'Transit fonctionne avec toute société de transport qui publie des données ouvertes GTFS et GTFS-Realtime. Les villes mesurées aujourd’hui ne sont que les premières. Vous voulez que votre ville soit mesurée, ou vous pouvez aider avec le code, les données ou l’hébergement? Parlons-en.',
		contact: 'Écrivez-moi',
		code: 'Voir le code',
		support:
			'Transit est indépendant et tourne sur le budget d’une seule personne. Les organisations qui peuvent prêter de l’hébergement, de la capacité d’API ou du financement rendent possibles d’autres villes.',
	},
	en: {
		title: 'Bring Transit to your city',
		body: 'Transit works with any agency that publishes open GTFS and GTFS-Realtime data. The cities measured today are only the first. Want your city measured, or can you help with code, data or hosting? Let’s talk.',
		contact: 'Get in touch',
		code: 'View the code',
		support:
			'Transit is independent and runs on one person’s budget. Organizations that can lend hosting, API capacity or funding make more cities possible.',
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
	code: 'https://github.com/yesid-dev/transit',
} as const;

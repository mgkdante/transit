import { serviceComparisonCopy } from '$lib/v1/serviceComparison';
import { defineCopy, type Locale } from '$lib/i18n/copy';
import { articleCopy } from '$lib/components/layout/articleCopy';
import { historyCopy } from '$lib/components/surface/historyCopy';
import type { SurfaceHeadCopy } from '$lib/components/surface';
import type { VerdictCopy, VerdictSentenceArgs } from '$lib/v1/verdict';

const positionShare = {
	fr: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
		`Parmi les positions actuelles de véhicules au statut connu, environ ${onTen} sur 10 sont dans la plage de ponctualité ${window}${hedge}; environ ${lateTen} sur 10 sont hors de cette plage, en avance ou en retard.`,
	en: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
		`Among current known-status vehicle positions, about ${onTen} in 10 are in the on-time band ${window}${hedge}; about ${lateTen} in 10 are outside that band, early or late.`,
};

export const networkReliabilityCopy = defineCopy({
	en: {
		kicker: 'NETWORK · LIVE',
		heading: 'Network health',
		lede: 'Live punctuality, crowding and reporting coverage, with daily trends.',
		article: articleCopy('en', {
			watermark: 'Network',
			tags: ['network', 'live service', 'reliability', 'crowding', 'open data'],
			generated: 'Generated',
			sections: (count: number) => `${count} sections`,
		}),
		liveTerminal: {
			title: 'control-room',
			tag: 'LIVE',
			footerLabel: 'SOURCE',
			footerValue: '/v1 live snapshot',
		},
		liveRegion: 'Live now',
		historicRegion: 'Historic trend',
		viewControlsLabel: 'View',
		rail: {
			toc: 'Jump to a section',
			pillOpen: 'Open view controls',
			pillClose: 'Close view controls',
		},
		liveSection: 'Live now',
		trendSection: 'Daily trend',
		cancelSection: 'Cancellations',
		occupancyTrendSection: 'Crowding by day',
		shiftSection: 'By time of day',
		dayTypeSection: 'Weekday vs weekend',
		statusSection: 'Status mix',
		occupancySection: 'Crowding',
		delayHistogramSection: 'Delay distribution',
		nonRespondingSection: 'Silent trips by line',
		completeness: {
			section: serviceComparisonCopy.en.section,
			metric: serviceComparisonCopy.en.label,
			explainer: serviceComparisonCopy.en.explanation,
			standDown: serviceComparisonCopy.en.unavailable,
		},
		metrics: {
			onTime: 'On-time',
			vehicles: 'Vehicle positions',
			notReporting: 'Trips without a signal',
			coverage: 'Coverage',
			delayP50: 'Median delay',
			delayP90: '90th-percentile delay',
		},
		feedAge: { label: 'FEED', a11yPrefix: 'Worker feed updated' },
		reporting: {
			heading: 'Reporting & coverage',
			caveat:
				'Coverage is the share of the fleet whose live status is known. “Not reporting” counts scheduled trips currently running with no live vehicle: a per-line silent-trip tally, not identifiable buses. Every vehicle shares one feed timestamp, so we can never single out one silent bus. Metro is excluded.',
		},
		statusBarLabel: 'Network status mix',
		occupancyBarLabel: 'Network crowding mix',
		trend: {
			onTimeLabel: 'On-time %',
			retardLabel: 'Slowest 10% (min)',
			retardP90: 'Slowest 10%',
			retardAvg: 'Average',
			retardAvgLabel: 'Average delay (min)',
			retardToggleLabel: 'Delay series',
			summary: 'Daily on-time % and the chosen delay series over the recent network trend.',
			delayOnlySummary: 'Chosen daily delay series over the selected network history.',
			onTimeOnlySummary: 'Daily on-time percentage over the selected network history.',
			vehiclesSpark: 'Vehicles in service, recent days',
			vehiclesContext: 'Vehicles reporting each day',
		},
		cancel: {
			metric: 'Canceled (latest day)',
			seriesLabel: '% canceled trip-days',
			summary: 'Daily share of canceled trip-days across the network.',
		},
		occupancyTrend: {
			summary: 'Crowding band mix per day across the recent network trend.',
		},
		shift: {
			shiftSummary: 'Network on-time performance ranked by time of day, worst punctuality first.',
			dayTypeSummary:
				'Network on-time performance for weekdays versus weekends, worst punctuality first.',
			rowCaption: 'On-time %, with average delay and severe-delay share',
			avgLabel: 'avg delay',
			severeLabel: 'severe',
			caveat:
				'A real on-time over known share across the network, measured over the trailing window. It is a punctuality proxy, not certified on-time performance, and small samples vary.',
		},
		delayHistogram: {
			summary: 'Distribution of trip-average delays across the network, earliest to latest.',
			caption:
				'How trip-average delays are spread right now, in signed minutes. Same basis as the median and slowest-10% numbers above: negative is ahead of schedule, positive is behind.',
			xLabel: 'Delay (min)',
			yLabel: 'Trips',
		},
		nonResponding: {
			summary: 'Lines with scheduled trips currently running with no live vehicle, most first.',
			caption:
				'Scheduled trips currently running with no live vehicle, by line. A silent trip has no vehicle to track, so this counts trips per line, not vehicles. Metro is excluded.',
			rowLabel: 'Line',
			viewDetail: (route) => `View line ${route}`,
			tripsUnit: (count) => (count === 1 ? 'trip' : 'trips'),
		},
		grain: { label: 'Trend grain', day: 'Day', week: 'Week', month: 'Month' },
		window: { label: 'Trend window', d7: '7d', d30: '30d', d90: '90d' },
		history: {
			navigator: historyCopy('en', {
				mode: 'range',
				group: 'Retained history',
				picker: {
					group: 'Retained history range',
					clear: 'Return to current snapshot',
					anyStart: 'Earliest',
					anyEnd: 'Latest',
				},
			}),
			coverage: (from, to) => `Retained coverage: ${from} to ${to}`,
			selection: (from, to) => `Selected range: ${from} to ${to}`,
			correction: {
				malformed: 'The invalid date range was replaced with the current snapshot.',
				'outside-coverage': 'The unavailable date range was replaced with the current snapshot.',
				gap: 'The range inside a retained-data gap was replaced with the current snapshot.',
				unpublished: 'The unpublished date range was replaced with the current snapshot.',
			},
			partial: 'Coverage is partial for this range. Missing dates and metrics remain no data.',
			currentOnly: 'Time-of-day and weekday views remain from the current snapshot.',
			dailyOnly:
				'Slowest-10% delay and vehicles are exact daily readings; they are not pooled into week or month.',
		},
		units: { pct: '%', min: ' min' },
		verdict: {
			windowPhrase: {
				day: 'right now',
				week: 'right now',
				month: 'right now',
				range: 'right now',
			},
			reliable: positionShare.en,
			patchy: positionShare.en,
			unreliable: positionShare.en,
			tentative: ({ window, otp, n, lo, hi }) =>
				`${otp}% of ${n} current known-status vehicle positions are in the on-time band ${window}. Nominal 95% Wilson bounds: ${lo}–${hi}%; positions may be dependent.`,
			tooFew: (window, n) => `Only ${n} current known-status vehicle positions ${window}.`,
			absent: 'No current vehicle positions with a known delay status.',
			hedgeSimple: (otp) => ` (${otp}%)`,
			hedgeCI: (otp, lo, hi) =>
				` (${otp}%; nominal 95% Wilson: ${lo}–${hi}%, potentially dependent positions)`,
		} satisfies VerdictCopy,
		verdictDelta: {
			label: 'Network verdict',
			chip: (signedPts) => `${signedPts} vs prior day`,
			a11y: 'Change versus the prior day:',
		},
	},
	fr: {
		kicker: 'RÉSEAU · EN DIRECT',
		heading: 'Santé du réseau',
		lede: 'La ponctualité, l’achalandage et la couverture des signalements en direct, avec leurs tendances quotidiennes.',
		article: articleCopy('fr', {
			watermark: 'Réseau',
			tags: ['réseau', 'service en direct', 'fiabilité', 'achalandage', 'données ouvertes'],
			generated: 'Généré',
			sections: (count: number) => `${count} sections`,
		}),
		liveTerminal: {
			title: 'salle-de-contrôle',
			tag: 'EN DIRECT',
			footerLabel: 'SOURCE',
			footerValue: 'instantané /v1 en direct',
		},
		liveRegion: 'En direct',
		historicRegion: 'Tendance historique',
		viewControlsLabel: 'Vue',
		rail: {
			toc: 'Aller à une section',
			pillOpen: 'Ouvrir les commandes de vue',
			pillClose: 'Fermer les commandes de vue',
		},
		liveSection: 'En direct',
		trendSection: 'Tendance quotidienne',
		cancelSection: 'Annulations',
		occupancyTrendSection: 'Achalandage par jour',
		shiftSection: 'Par moment de la journée',
		dayTypeSection: 'Semaine et fin de semaine',
		statusSection: 'Répartition des statuts',
		occupancySection: 'Achalandage',
		delayHistogramSection: 'Répartition des retards',
		nonRespondingSection: 'Voyages silencieux par ligne',
		completeness: {
			section: serviceComparisonCopy.fr.section,
			metric: serviceComparisonCopy.fr.label,
			explainer: serviceComparisonCopy.fr.explanation,
			standDown: serviceComparisonCopy.fr.unavailable,
		},
		metrics: {
			onTime: 'À l’heure',
			vehicles: 'Positions de véhicules',
			notReporting: 'Trajets sans signal',
			coverage: 'Couverture',
			delayP50: 'Retard médian',
			delayP90: 'Retard au 90e percentile',
		},
		feedAge: { label: 'FLUX', a11yPrefix: 'Flux du travailleur mis à jour' },
		reporting: {
			heading: 'Signalement et couverture',
			caveat:
				'La couverture est la part de la flotte dont le statut en direct est connu. « Sans signal » compte les voyages planifiés qui circulent actuellement sans véhicule en direct : un décompte de voyages silencieux par ligne, pas des véhicules identifiables. Chaque véhicule partage un seul horodatage de flux, on ne peut donc jamais isoler un véhicule silencieux précis. Le métro est exclu.',
		},
		statusBarLabel: 'Répartition des statuts du réseau',
		occupancyBarLabel: 'Répartition de l’achalandage du réseau',
		trend: {
			onTimeLabel: 'Ponctualité %',
			retardLabel: '10 % les plus lents (min)',
			retardP90: '10 % les plus lents',
			retardAvg: 'Moyen',
			retardAvgLabel: 'Retard moyen (min)',
			retardToggleLabel: 'Série de retard',
			summary:
				'Ponctualité quotidienne et la série de retard choisie sur la tendance récente du réseau.',
			delayOnlySummary:
				'Série quotidienne de retard choisie sur l’historique sélectionné du réseau.',
			onTimeOnlySummary: 'Ponctualité quotidienne sur l’historique sélectionné du réseau.',
			vehiclesSpark: 'Véhicules en service, jours récents',
			vehiclesContext: 'Véhicules signalés chaque jour',
		},
		cancel: {
			metric: 'Annulé (dernier jour)',
			seriesLabel: '% de jours-voyages annulés',
			summary: 'Part quotidienne des jours-voyages annulés à l’échelle du réseau.',
		},
		occupancyTrend: {
			summary: 'Répartition des bandes d’achalandage par jour sur la tendance récente du réseau.',
		},
		shift: {
			shiftSummary:
				'Ponctualité du réseau classée par moment de la journée, la pire ponctualité d’abord.',
			dayTypeSummary:
				'Ponctualité du réseau en semaine et en fin de semaine, la pire ponctualité d’abord.',
			rowCaption: 'Ponctualité %, avec le retard moyen et la part de retards sévères',
			avgLabel: 'retard moyen',
			severeLabel: 'sévère',
			caveat:
				'Une part réelle à l’heure sur connus à l’échelle du réseau, mesurée sur la fenêtre glissante. C’est une estimation de ponctualité, pas une ponctualité certifiée, et les petits échantillons varient.',
		},
		delayHistogram: {
			summary:
				'Répartition des retards moyens par voyage à l’échelle du réseau, du plus tôt au plus tard.',
			caption:
				'La répartition actuelle des retards moyens par voyage, en minutes signées. Même base que le retard médian et les 10 % les plus lents ci-dessus : négatif signifie en avance, positif signifie en retard.',
			xLabel: 'Retard (min)',
			yLabel: 'Voyages',
		},
		nonResponding: {
			summary:
				'Lignes dont des voyages planifiés circulent sans véhicule en direct, les plus nombreuses d’abord.',
			caption:
				'Voyages planifiés qui circulent actuellement sans véhicule en direct, par ligne. Un voyage silencieux n’a aucun véhicule à suivre : on compte donc les voyages par ligne, pas les véhicules. Le métro est exclu.',
			rowLabel: 'Ligne',
			viewDetail: (route: string) => `Voir la ligne ${route}`,
			tripsUnit: (count: number) => (count <= 1 ? 'voyage' : 'voyages'),
		},
		grain: { label: 'Granularité de tendance', day: 'Jour', week: 'Semaine', month: 'Mois' },
		window: { label: 'Fenêtre de tendance', d7: '7 j', d30: '30 j', d90: '90 j' },
		history: {
			navigator: historyCopy('fr', {
				mode: 'range',
				group: 'Historique conservé',
				picker: {
					group: 'Plage de l’historique conservé',
					clear: 'Revenir à l’instantané actuel',
					anyStart: 'Au plus tôt',
					anyEnd: 'Au plus tard',
				},
			}),
			coverage: (from: string, to: string) => `Couverture conservée : du ${from} au ${to}`,
			selection: (from: string, to: string) => `Plage choisie : du ${from} au ${to}`,
			correction: {
				malformed: 'La plage de dates invalide a été remplacée par l’instantané actuel.',
				'outside-coverage':
					'La plage de dates non disponible a été remplacée par l’instantané actuel.',
				gap: 'La plage dans une lacune des données a été remplacée par l’instantané actuel.',
				unpublished: 'La plage non publiée a été remplacée par l’instantané actuel.',
			},
			partial:
				'La couverture est partielle pour cette plage. Les dates et mesures absentes restent sans données.',
			currentOnly:
				'Les vues par moment de la journée et par type de jour restent celles de l’instantané actuel.',
			dailyOnly:
				'Le retard des 10 % les plus lents et les véhicules sont des lectures quotidiennes exactes; ils ne sont pas regroupés par semaine ou par mois.',
		},
		units: { pct: '%', min: ' min' },
		verdict: {
			windowPhrase: {
				day: 'en ce moment',
				week: 'en ce moment',
				month: 'en ce moment',
				range: 'en ce moment',
			},
			reliable: positionShare.fr,
			patchy: positionShare.fr,
			unreliable: positionShare.fr,
			tentative: ({ window, otp, n, lo, hi }) =>
				`${otp} % de ${n} positions actuelles de véhicules au statut connu sont dans la plage de ponctualité ${window}. Bornes de Wilson nominales à 95 % : ${lo}–${hi} %; les positions peuvent être dépendantes.`,
			tooFew: (window: string, n: number) =>
				`Seulement ${n} positions actuelles de véhicules au statut connu ${window}.`,
			absent: 'Aucune position actuelle de véhicule avec un statut de retard connu.',
			hedgeSimple: (otp: number) => ` (${otp} %)`,
			hedgeCI: (otp: number, lo: number, hi: number) =>
				` (${otp} %; Wilson nominal à 95 % : ${lo}–${hi} %, positions potentiellement dépendantes)`,
		} satisfies VerdictCopy,
		verdictDelta: {
			label: 'Verdict du réseau',
			chip: (signedPts: string) => `${signedPts} vs la veille`,
			a11y: 'Variation par rapport à la veille :',
		},
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy & { readonly verdict: VerdictCopy }>>;

export type NetworkReliabilityCopy = (typeof networkReliabilityCopy)[Locale];

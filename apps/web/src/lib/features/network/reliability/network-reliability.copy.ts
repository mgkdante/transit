import type { VerdictCopy } from '#lib/v1/verdict.ts';
import { routeVerdictCopy } from '#lib/features/lines/reliability/routeVerdict.copy.ts';
import { serviceComparisonCopy } from '#lib/v1/serviceComparison.ts';
import { defineCopy, type Locale } from '#lib/i18n/copy.ts';
import { articleCopy } from '#lib/components/layout/articleCopy.ts';
import { historyCopy } from '#lib/components/surface/historyCopy.ts';
import type { SurfaceHeadCopy } from '#lib/components/surface/index.ts';

export const networkReliabilityCopy = defineCopy({
	en: {
		questions: {
			live: 'How is service running right now?',
			trend: 'Is reliability improving over time?',
			cancel: 'What share of trips was canceled?',
			crowdingTrend: 'Are vehicles more crowded on some days?',
			time: 'When during the day is the network most reliable?',
			weekday: 'Is service more reliable on weekdays or weekends?',
			reporting: 'How much service can we follow live?',
			status: 'Are vehicles early, on time, or late?',
			crowding: 'Is there room on board?',
			delays: 'How large are the delays?',
			completeness: 'How do observed trips compare with planned service?',
		},
		kicker: 'NETWORK · LIVE',
		heading: 'Network health',
		lede: 'Live punctuality, crowding and reporting coverage, with daily trends.',
		article: articleCopy('en', {
			watermark: 'Network',
			tags: ['network', 'live service', 'reliability', 'crowding', 'open data'],
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
		snapshotRefreshFailed: 'Snapshot refresh failed',
		feedAge: { label: 'FEED', a11yPrefix: 'Worker feed updated' },
		reporting: {
			heading: 'Reporting & coverage',
			caveat:
				'Coverage is the share of the fleet whose live status is known. “Silent trips” counts scheduled trips currently running with no live vehicle: a per-line silent-trip tally, not identifiable buses. Individual position reports can be older than the feed update. {excluded}',
		},
		statusBarLabel: 'Network status mix',
		occupancyBarLabel: 'Network crowding mix',
		trend: {
			through: (date: string) => `Through ${date}`,
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
			metricOn: (date: string) => `Canceled · ${date}`,
			metricUndated: 'Canceled',
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
				'All recorded days. It is a punctuality proxy, not certified on-time performance, and small samples vary.',
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
				'Scheduled trips currently running with no live vehicle, by line. A silent trip has no vehicle to track, so this counts trips per line, not vehicles. {excluded}',
			rowLabel: 'Line',
			tripsUnit: (count) => (count === 1 ? 'trip' : 'trips'),
		},
		grain: { label: 'Trend grain', day: 'Day', week: 'Week', month: 'Month' },
		window: {
			reason: (n: number) => (n === 1 ? 'Only 1 day recorded' : `Only ${n} days recorded`),
			label: 'Trend window',
			d7: '7d',
			d30: '30d',
			d90: '90d',
		},
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
		verdict: routeVerdictCopy.en.verdict,
		verdictDelta: {
			label: 'Network verdict',
			chip: (signedPts: string, singular: boolean) =>
				`Daily on-time change: ${signedPts} percentage ${singular ? 'point' : 'points'}`,
			versus: 'vs',
		},
	},
	fr: {
		questions: {
			live: 'Comment le service se déroule-t-il en ce moment ?',
			trend: 'La fiabilité s’améliore-t-elle au fil des jours ?',
			cancel: 'Quelle part des trajets a été annulée ?',
			crowdingTrend: 'Les véhicules sont-ils plus remplis certains jours ?',
			time: 'À quel moment le réseau est-il le plus fiable ?',
			weekday: 'Le service est-il plus fiable en semaine ou le week-end ?',
			reporting: 'Quelle part du service peut-on suivre en direct ?',
			status: 'Les véhicules sont-ils en avance, à l’heure ou en retard ?',
			crowding: 'Y a-t-il de la place à bord ?',
			delays: 'Les retards sont-ils petits ou importants ?',
			completeness: 'Comment les trajets observés se comparent-ils au service prévu ?',
		},
		kicker: 'RÉSEAU · EN DIRECT',
		heading: 'Santé du réseau',
		lede: 'La ponctualité, l’achalandage et la couverture des signalements en direct, avec leurs tendances quotidiennes.',
		article: articleCopy('fr', {
			watermark: 'Réseau',
			tags: ['réseau', 'service en direct', 'fiabilité', 'achalandage', 'données ouvertes'],
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
		nonRespondingSection: 'Trajets silencieux par ligne',
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
		snapshotRefreshFailed: 'Actualisation de l’instantané échouée',
		feedAge: { label: 'FLUX', a11yPrefix: 'Flux du travailleur mis à jour' },
		reporting: {
			heading: 'Signalement et couverture',
			caveat:
				'La couverture est la part de la flotte dont le statut en direct est connu. « Trajets silencieux » compte les trajets planifiés qui circulent actuellement sans véhicule en direct : un décompte de trajets silencieux par ligne, pas des véhicules identifiables. Les positions individuelles peuvent être plus anciennes que la mise à jour du flux. {excluded}',
		},
		statusBarLabel: 'Répartition des statuts du réseau',
		occupancyBarLabel: 'Répartition de l’achalandage du réseau',
		trend: {
			through: (date: string) => `Jusqu’au ${date}`,
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
			metricOn: (date: string) => `Annulé · ${date}`,
			metricUndated: 'Annulé',
			seriesLabel: '% de jours-trajets annulés',
			summary: 'Part quotidienne des jours-trajets annulés à l’échelle du réseau.',
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
				'Tous les jours enregistrés. C’est une estimation de ponctualité, pas une ponctualité certifiée, et les petits échantillons varient.',
		},
		delayHistogram: {
			summary:
				'Répartition des retards moyens par trajet à l’échelle du réseau, du plus tôt au plus tard.',
			caption:
				'La répartition actuelle des retards moyens par trajet, en minutes signées. Même base que le retard médian et les 10 % les plus lents ci-dessus : négatif signifie en avance, positif signifie en retard.',
			xLabel: 'Retard (min)',
			yLabel: 'Trajets',
		},
		nonResponding: {
			summary:
				'Lignes dont des trajets planifiés circulent sans véhicule en direct, les plus nombreuses d’abord.',
			caption:
				'Trajets planifiés qui circulent actuellement sans véhicule en direct, par ligne. Un trajet silencieux n’a aucun véhicule à suivre : on compte donc les trajets par ligne, pas les véhicules. {excluded}',
			rowLabel: 'Ligne',
			tripsUnit: (count: number) => (count <= 1 ? 'trajet' : 'trajets'),
		},
		grain: { label: 'Granularité de tendance', day: 'Jour', week: 'Semaine', month: 'Mois' },
		window: {
			reason: (n: number) =>
				n === 1 ? 'Seulement 1 jour enregistré' : `Seulement ${n} jours enregistrés`,
			label: 'Fenêtre de tendance',
			d7: '7 j',
			d30: '30 j',
			d90: '90 j',
		},
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
		verdict: routeVerdictCopy.fr.verdict,
		verdictDelta: {
			label: 'Verdict du réseau',
			chip: (signedPts: string, singular: boolean) =>
				`Variation quotidienne de la ponctualité : ${signedPts} ${singular ? 'point' : 'points'} de pourcentage`,
			versus: 'contre',
		},
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy & { readonly verdict: VerdictCopy }>>;

export type NetworkReliabilityCopy = (typeof networkReliabilityCopy)[Locale];

export function providerNetworkReliabilityCopy(locale: Locale, providerId: string | undefined) {
	const copy = networkReliabilityCopy[locale];
	const exclusions: Record<string, Record<Locale, string>> = {
		stm: { en: 'Metro is excluded.', fr: 'Le métro est exclu.' },
		octranspo: { en: 'O-Train is excluded.', fr: 'L’O-Train est exclu.' },
	};
	const excluded = (providerId && exclusions[providerId]?.[locale]) || '';
	return {
		...copy,
		reporting: {
			...copy.reporting,
			caveat: copy.reporting.caveat.replace('{excluded}', excluded).trim(),
		},
		nonResponding: {
			...copy.nonResponding,
			caption: copy.nonResponding.caption.replace('{excluded}', excluded).trim(),
		},
	};
}

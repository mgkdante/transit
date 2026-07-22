// stops-reliability.copy.ts — co-located bilingual copy for the Stops RELIABILITY
// surface (S8A re-seat). Lifted verbatim out of stops.copy.ts's `reliability`
// subtree so the reliability sections + selectors read ONE bundle, and EXTENDED
// with the S8A daily-trend + range-verdict strings (the new dated-series section).
//
// FR is the canonical product voice; `locale` is threaded as a prop and this
// bundle is passed to every section, so no section performs its own i18n lookup.
// Domain-intrinsic labels (OTP / delay / occupancy bands) still live in the
// shared primitives / lines vocabulary and are NOT duplicated here.

import { defineCopy, type Locale } from '$lib/i18n/copy';
import { historyCopy } from '$lib/components/surface/historyCopy';
import type { VerdictCopy, VerdictSentenceArgs } from '$lib/v1/verdict';

export const stopReliabilityCopy = defineCopy({
	fr: {
		byRoute: 'Retard moyen par ligne',
		noRouteBreakdown: 'Aucun détail par ligne pour cet arrêt.',
		viewLine: (routeId: string) => `Voir la ligne ${routeId}`,
		paneHeading: 'Ponctualité et retard',
		metrics: {
			otp: 'Ponctualité',
			avgDelay: 'Retard moyen',
			severe: 'Part des retards graves',
		},
		controlsLabel: 'Vue',
		nav: {
			toc: 'Aller à une section',
			pillOpen: 'Ouvrir la vue et les sections',
			pillClose: 'Fermer la vue et les sections',
		},
		grain: {
			label: 'Période de regroupement',
			day: 'Jour',
			week: 'Semaine',
			month: 'Mois',
			window: (grain: string) =>
				grain === 'week'
					? 'Regroupé par semaine.'
					: grain === 'month'
						? 'Regroupé par mois.'
						: 'Regroupé par jour.',
		},
		history: {
			navigator: historyCopy('fr', {
				mode: 'range',
				group: 'Historique de fiabilité de l’arrêt',
				picker: {
					group: 'Plage de dates',
					clear: 'Revenir au portrait actuel',
					anyStart: 'Première date',
					anyEnd: 'Dernière date',
				},
			}),
			coverage: (from: string, to: string) => `Historique disponible du ${from} au ${to}.`,
			selection: (from: string, to: string) => `Plage choisie : du ${from} au ${to}.`,
			correction: {
				malformed: 'La plage invalide a été remplacée par le portrait actuel.',
				'outside-coverage': 'La plage non disponible a été remplacée par le portrait actuel.',
				gap: 'La plage traverse une lacune dans les données conservées.',
				unpublished: 'La plage non publiée a été remplacée par le portrait actuel.',
			},
			partial: 'Cette plage ne couvre qu’une partie des mesures conservées.',
			noData: 'Aucune donnée conservée pour cette plage.',
			currentOnly:
				'L’identité, les périodes, les habitudes, les jours, les heures et le détail par ligne restent basés sur le portrait actuel.',
			loading: 'Chargement de la plage conservée…',
			ready: 'Plage conservée chargée.',
			error: 'Impossible de charger cette plage conservée.',
			retry: 'Réessayer',
		},
		verdict: {
			windowPhrase: {
				day: 'aujourd’hui',
				week: 'cette semaine',
				month: 'ce mois-ci',
				range: 'sur la période',
			},
			reliable: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
				`Arrêt fiable ${window}, environ ${onTen} passages sur 10 à l’heure${hedge}; ${lateTen} sur 10 en retard.`,
			patchy: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
				`Arrêt inégal ${window}, environ ${onTen} passages sur 10 à l’heure${hedge}; ${lateTen} sur 10 en retard.`,
			unreliable: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
				`Arrêt peu fiable ${window}, seulement ${onTen} passages sur 10 à l’heure${hedge}; ${lateTen} sur 10 en retard.`,
			tentative: ({ window, otp, n, lo, hi }) =>
				`Environ ${otp} % des passages à l’heure ${window} (sûr à 95 % entre ${lo} et ${hi} %, n=${n}).`,
			tooFew: (window: string, n: number) =>
				`Mesure en cours ${window}, seulement ${n} passages suivis.`,
			absent: 'Mesure de l’arrêt en cours. Pas encore de lecture de ponctualité.',
			hedgeSimple: (otp: number) => ` (${otp} %)`,
			hedgeCI: (otp: number, lo: number, hi: number) =>
				` (${otp} %, sûr à 95 % entre ${lo} et ${hi} %)`,
		} satisfies VerdictCopy,
		percentiles: {
			heading: 'Retard journalier',
			typical: 'Retard typique',
			typicalCaption: 'La moitié des passages (médiane)',
			worstCase: 'Pire des cas',
			worstCaseCaption: '10 % les plus lents (p90)',
		},
		habits: {
			heading: 'Retards graves par heure',
			label: 'Carte thermique des retards graves par jour et par heure',
			cellValueLabel: 'Intensité',
			hourAxisLabel: 'Heure de la journée',
			dayAxisLabel: 'Jour de la semaine',
			caption:
				'La couleur indique la fréquence des retards graves, comparée heure par heure au sein de chaque journée. Plus c’est chaud, plus le problème revient souvent.',
			legend: {
				low: 'Faible',
				medium: 'Moyen',
				high: 'Élevé',
				noData: 'Aucune donnée',
				tiers: ['Rarement grave', 'Parfois grave', 'Souvent grave', 'Très peu fiable'] as const,
			},
			weekdays: [
				'',
				'Lundi',
				'Mardi',
				'Mercredi',
				'Jeudi',
				'Vendredi',
				'Samedi',
				'Dimanche',
			] as const,
			weekdaysShort: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const,
		},
		weekday: {
			heading: 'Par jour de la semaine',
			avgDelay: 'Retard moyen',
			severeShare: 'Part des retards graves',
			caveat:
				'Estimation sur fenêtre glissante, pondérée par les observations, pas une ponctualité certifiée; les petits échantillons varient.',
		},
		timeOfDay: {
			heading: 'Par période de la journée',
			severeShare: 'Part des retards graves',
			dayType: 'Semaine vs fin de semaine',
			caveat:
				'Estimation sur fenêtre glissante, pondérée par les observations, pas une ponctualité certifiée; les petits échantillons varient.',
		},
		crowding: {
			heading: 'Encombrement des bus vus ici',
			window:
				'Répartition de l’occupation des bus observés à cet arrêt sur les 30 derniers jours, tous transporteurs confondus. Ce n’est pas une caractéristique de l’arrêt.',
			barLabel: 'Répartition de l’occupation des bus observés à cet arrêt',
			dominantLabel: 'Occupation la plus fréquente',
			noTelemetry: 'Aucune donnée d’occupation rattachée à cet arrêt.',
		},
		trend: {
			heading: 'Tendance journalière',
			chartTitle: 'Part des retards graves · par jour',
			severeLabel: 'Part des retards graves',
			avgLabel: 'Retard moyen',
			pctUnit: '%',
			minUnit: ' min',
			verdictHeading: 'Sur la période choisie',
			pooledSevere: 'Part des retards graves',
			pooledAvg: 'Retard moyen',
			observations: 'Observations',
			wilsonCaption: (lo: string, hi: string) => `Intervalle de confiance à 95 % : ${lo} – ${hi} %`,
			rangeWindow: (days: number, from: string, to: string) =>
				`${days} ${days === 1 ? 'jour' : 'jours'} avec données · ${from} au ${to}`,
			singleDay: (date: string) => `Journée du ${date}`,
			caveat:
				'La « part des retards graves » est un indicateur indirect (retards > 5 min); un arrêt n’a pas de ponctualité programmée. Ne pas comparer au taux de ponctualité d’une ligne.',
			belowMinN: (n: number) =>
				`Trop peu d’observations sur cette période (${n}) pour afficher un pourcentage fiable.`,
		},
		noDelay: 'Aucune donnée',
	},
	en: {
		byRoute: 'Avg delay by route',
		noRouteBreakdown: 'No per-route breakdown for this stop.',
		viewLine: (routeId) => `View line ${routeId}`,
		paneHeading: 'On-time and delay',
		metrics: {
			otp: 'On-time %',
			avgDelay: 'Average delay',
			severe: 'Severe-delay share',
		},
		controlsLabel: 'View',
		nav: {
			toc: 'Jump to a section',
			pillOpen: 'Open view and sections',
			pillClose: 'Close view and sections',
		},
		grain: {
			label: 'Roll-up period',
			day: 'Day',
			week: 'Week',
			month: 'Month',
			window: (grain) =>
				grain === 'week'
					? 'Rolled up by week.'
					: grain === 'month'
						? 'Rolled up by month.'
						: 'Rolled up by day.',
		},
		history: {
			navigator: historyCopy('en', {
				mode: 'range',
				group: 'Stop reliability history',
				picker: {
					group: 'Date range',
					clear: 'Return to current snapshot',
					anyStart: 'First date',
					anyEnd: 'Last date',
				},
			}),
			coverage: (from, to) => `History available from ${from} to ${to}.`,
			selection: (from, to) => `Selected range: ${from} to ${to}.`,
			correction: {
				malformed: 'The invalid date range was replaced with the current snapshot.',
				'outside-coverage': 'The unavailable date range was replaced with the current snapshot.',
				gap: 'The selected range crosses a gap in retained data.',
				unpublished: 'The unpublished date range was replaced with the current snapshot.',
			},
			partial: 'This range has only partial retained metric coverage.',
			noData: 'No data is retained for this range.',
			currentOnly:
				'Identity, periods, habits, weekday, time-of-day, and by-line detail still use the current snapshot.',
			loading: 'Loading retained range…',
			ready: 'Retained range loaded.',
			error: 'This retained range could not be loaded.',
			retry: 'Retry',
		},
		verdict: {
			windowPhrase: {
				day: 'today',
				week: 'this week',
				month: 'this month',
				range: 'over the range',
			},
			reliable: ({ window, onTen, lateTen, hedge }) =>
				`This stop ran reliably ${window}, about ${onTen} in 10 arrivals on time${hedge}; ${lateTen} in 10 ran late.`,
			patchy: ({ window, onTen, lateTen, hedge }) =>
				`This stop ran unevenly ${window}, about ${onTen} in 10 arrivals on time${hedge}; ${lateTen} in 10 ran late.`,
			unreliable: ({ window, onTen, lateTen, hedge }) =>
				`This stop ran poorly ${window}, only ${onTen} in 10 arrivals on time${hedge}; ${lateTen} in 10 ran late.`,
			tentative: ({ window, otp, n, lo, hi }) =>
				`About ${otp}% of arrivals on time ${window} (95% sure between ${lo} and ${hi}%, n=${n}).`,
			tooFew: (window, n) => `Still measuring ${window}, only ${n} arrivals tracked.`,
			absent: 'Still measuring this stop. No on-time reading yet.',
			hedgeSimple: (otp) => ` (${otp}%)`,
			hedgeCI: (otp, lo, hi) => ` (${otp}%, 95% sure between ${lo} and ${hi}%)`,
		} satisfies VerdictCopy,
		percentiles: {
			heading: 'Daily delay',
			typical: 'Typical delay',
			typicalCaption: 'Half of departures (median)',
			worstCase: 'Worst case',
			worstCaseCaption: 'Slowest 10% (p90)',
		},
		habits: {
			heading: 'Severe delays by hour',
			label: 'Severe-delay heatmap by day and hour',
			cellValueLabel: 'Intensity',
			hourAxisLabel: 'Hour of day',
			dayAxisLabel: 'Day of week',
			caption:
				'Colour shows how often severe delays repeat, compared hour-by-hour within each day. Hotter = the problem comes back more often.',
			legend: {
				low: 'Low',
				medium: 'Medium',
				high: 'High',
				noData: 'No data',
				tiers: ['Rarely severe', 'Sometimes severe', 'Often severe', 'Very unreliable'],
			},
			weekdays: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
			weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
		},
		weekday: {
			heading: 'By day of week',
			avgDelay: 'Avg delay',
			severeShare: 'Severe-delay share',
			caveat:
				'Trailing-window, observation-weighted estimate, not certified on-time; small samples vary.',
		},
		timeOfDay: {
			heading: 'By time of day',
			severeShare: 'Severe-delay share',
			dayType: 'Weekday vs weekend',
			caveat:
				'Trailing-window, observation-weighted estimate, not certified on-time; small samples vary.',
		},
		crowding: {
			heading: 'Crowding on buses seen here',
			window:
				'How full the buses observed at this stop ran over the last 30 days, across all carriers. This is not a property of the stop itself.',
			barLabel: 'Occupancy mix of buses observed at this stop',
			dominantLabel: 'Most common loading',
			noTelemetry: 'No occupancy telemetry attributed to this stop.',
		},
		trend: {
			heading: 'Daily trend',
			chartTitle: 'Severe-delay share · by day',
			severeLabel: 'Severe-delay share',
			avgLabel: 'Average delay',
			pctUnit: '%',
			minUnit: ' min',
			verdictHeading: 'Over the selected window',
			pooledSevere: 'Severe-delay share',
			pooledAvg: 'Average delay',
			observations: 'Observations',
			wilsonCaption: (lo, hi) => `95% confidence interval: ${lo}–${hi}%`,
			rangeWindow: (days, from, to) =>
				`${days} ${days === 1 ? 'day' : 'days'} with data · ${from} to ${to}`,
			singleDay: (date) => `Day of ${date}`,
			caveat:
				'“Severe-delay share” is a proxy (delays over 5 min); a stop has no scheduled on-time definition. Do not compare it to a line’s on-time rate.',
			belowMinN: (n) =>
				`Too few observations over this window (${n}) to print a reliable percentage.`,
		},
		noDelay: 'No data',
	},
}) satisfies Readonly<Record<Locale, { readonly verdict: VerdictCopy }>>;

export type StopReliabilityCopy = (typeof stopReliabilityCopy)[Locale];

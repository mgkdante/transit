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

const predictionShare = {
	fr: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
		`Dans ce résumé ${window}, environ ${onTen} prévisions connues sur 10 sont sans retard grave${hedge}; environ ${lateTen} sur 10 dépassent cinq minutes de retard.`,
	en: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
		`In this ${window}, about ${onTen} in 10 known predictions are not severely late${hedge}; about ${lateTen} in 10 exceed five minutes late.`,
};

export const stopReliabilityCopy = defineCopy({
	fr: {
		byRoute: 'Retard moyen par ligne',
		noRouteBreakdown: 'Aucun détail par ligne pour cet arrêt.',
		viewLine: (routeId: string) => `Voir la ligne ${routeId}`,
		paneHeading: 'Prévisions de retard',
		metrics: {
			otp: 'Prévisions sans retard grave',
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
			currentOnly:
				'L’identité, les périodes, les habitudes, les jours, les heures et le détail par ligne restent basés sur le portrait actuel.',
			loading: 'Chargement de la plage conservée…',
			ready: 'Plage conservée chargée.',
			error: 'Impossible de charger cette plage conservée.',
			retry: 'Réessayer',
		},
		verdict: {
			windowPhrase: {
				day: 'quotidien',
				week: 'hebdomadaire',
				month: 'mensuel',
				range: 'de la plage choisie',
			},
			reliable: predictionShare.fr,
			patchy: predictionShare.fr,
			unreliable: predictionShare.fr,
			tentative: ({ window, otp, n, lo, hi }) =>
				`Dans ce résumé ${window}, ${otp} % de ${n} prévisions connues sont sans retard grave. Bornes de Wilson nominales à 95 % : ${lo}–${hi} %; les relevés peuvent être dépendants.`,
			tooFew: (window: string, n: number) =>
				`Ce résumé ${window} contient seulement ${n} prévisions connues admissibles.`,
			absent: 'Aucune prévision de retard admissible dans ce résumé.',
			hedgeSimple: (otp: number) => ` (${otp} %)`,
			hedgeCI: (otp: number, lo: number, hi: number) =>
				` (${otp} %; Wilson nominal à 95 % : ${lo}–${hi} %, relevés potentiellement dépendants)`,
		} satisfies VerdictCopy,
		percentiles: {
			heading: 'Retard journalier',
			typical: 'Retard médian',
			typicalCaption: 'Médiane des relevés de retard prédit',
			p90: 'Retard au 90e percentile',
			p90Caption: '90e percentile des relevés de retard prédit',
		},
		habits: {
			heading: 'Score relatif des retards graves par heure',
			label: 'Score relatif au sein de cet arrêt, par jour et par heure',
			cellValueLabel: 'Score relatif',
			hourAxisLabel: 'Heure de la journée',
			dayAxisLabel: 'Jour de la semaine',
			caption:
				'Les comptes de relevés de retard grave sont divisés par le plus grand compte de cet arrêt, toutes journées et heures confondues. ◆ encadre les scores de 0,75 à 1 de ce maximum. Zéro signifie qu’un score nul est fourni; une case vide est indisponible. Cette échelle compare les heures au sein de cet arrêt, sans mesurer la probabilité de retard d’un trajet.',
			legend: {
				tiers: [
					'Score relatif faible',
					'Score relatif modéré',
					'Score relatif élevé',
					'Score relatif très élevé',
				] as const,
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
	},
	en: {
		byRoute: 'Avg delay by route',
		noRouteBreakdown: 'No per-route breakdown for this stop.',
		viewLine: (routeId) => `View line ${routeId}`,
		paneHeading: 'Predicted delays',
		metrics: {
			otp: 'Not-severe predictions',
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
			currentOnly:
				'Identity, periods, habits, weekday, time-of-day, and by-line detail still use the current snapshot.',
			loading: 'Loading retained range…',
			ready: 'Retained range loaded.',
			error: 'This retained range could not be loaded.',
			retry: 'Retry',
		},
		verdict: {
			windowPhrase: {
				day: 'daily summary',
				week: 'weekly summary',
				month: 'monthly summary',
				range: 'selected-range summary',
			},
			reliable: predictionShare.en,
			patchy: predictionShare.en,
			unreliable: predictionShare.en,
			tentative: ({ window, otp, n, lo, hi }) =>
				`In this ${window}, ${otp}% of ${n} known predictions are not severely late. Nominal 95% Wilson bounds: ${lo}–${hi}%; readings may be dependent.`,
			tooFew: (window, n) => `This ${window} contains only ${n} eligible known predictions.`,
			absent: 'No eligible predicted-delay readings in this summary.',
			hedgeSimple: (otp) => ` (${otp}%)`,
			hedgeCI: (otp, lo, hi) =>
				` (${otp}%; nominal 95% Wilson: ${lo}–${hi}%, potentially dependent readings)`,
		} satisfies VerdictCopy,
		percentiles: {
			heading: 'Daily delay',
			typical: 'Median delay',
			typicalCaption: 'Median of reported predicted delays',
			p90: '90th-percentile delay',
			p90Caption: '90th percentile of reported predicted delays',
		},
		habits: {
			heading: 'Relative severe-delay score by hour',
			label: 'Relative score within this stop, by day and hour',
			cellValueLabel: 'Relative score',
			hourAxisLabel: 'Hour of day',
			dayAxisLabel: 'Day of week',
			caption:
				'Severe-delay reading counts are divided by this stop’s highest count across all days and hours. ◆ outlines scores from 0.75 to 1 of that maximum. Zero means a supplied zero score; blank cells are unavailable. This scale compares hours within this stop, without measuring a trip’s chance of delay.',
			legend: {
				tiers: [
					'Low relative score',
					'Moderate relative score',
					'High relative score',
					'Very high relative score',
				],
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
	},
}) satisfies Readonly<Record<Locale, { readonly verdict: VerdictCopy }>>;

export type StopReliabilityCopy = (typeof stopReliabilityCopy)[Locale];

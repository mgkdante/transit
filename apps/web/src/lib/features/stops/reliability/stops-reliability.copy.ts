// stops-reliability.copy.ts — co-located bilingual copy for the Stops RELIABILITY
// surface (S8A re-seat). Lifted verbatim out of stops.copy.ts's `reliability`
// subtree so the reliability sections + selectors read ONE bundle, and EXTENDED
// with the S8A daily-trend + range-verdict strings (the new dated-series section).
//
// FR is the canonical product voice; `locale` is threaded as a prop and this
// bundle is passed to every section, so no section performs its own i18n lookup.
// Domain-intrinsic labels (OTP / delay / occupancy bands) still live in the
// shared primitives / lines vocabulary and are NOT duplicated here.

import type { Locale } from '$lib/i18n';
import type { VerdictCopy } from '$lib/v1/verdict';

export interface StopReliabilityCopy {
	readonly byRoute: string;
	readonly noRouteBreakdown: string;
	readonly viewLine: (routeId: string) => string;
	/** Section heading over the shared ReliabilityPane (OTP / delay / severe). */
	readonly paneHeading: string;
	/** Short metric NAMES the (i) explainer trigger announces beside a heading. */
	readonly metrics: {
		readonly otp: string;
		readonly avgDelay: string;
		readonly severe: string;
	};
	/** Controls-rail label collecting the grain picker + window caption ("View"). */
	readonly controlsLabel: string;
	/**
	 * P5.4 GLASS LEFT RAIL wayfinding: the section ToC heading + the mobile
	 * pill/sheet open+close aria. The rail merges the grain picker + this jump
	 * list into ONE menu (desktop panel / mobile sheet).
	 */
	readonly nav: {
		/** Section ToC heading ("Jump to"). */
		readonly toc: string;
		/** aria-label for the mobile rail pill's open control. */
		readonly pillOpen: string;
		/** aria-label for the mobile rail sheet's dismiss control. */
		readonly pillClose: string;
	};
	/** Grain (roll-up) picker affordances. */
	readonly grain: {
		/** Accessible group label over the grain segments. */
		readonly label: string;
		/** Day / week / month segment labels. */
		readonly day: string;
		readonly week: string;
		readonly month: string;
		/** Caption naming the resolved roll-up window. */
		readonly window: (grain: string) => string;
	};
	readonly history: {
		readonly navigator: import('$lib/components/surface/HistoryNavigator.svelte').HistoryNavigatorLabels;
		readonly coverage: (from: string, to: string) => string;
		readonly selection: (from: string, to: string) => string;
		readonly correction: Record<import('$lib/v1').HistoryCorrection['reason'], string>;
		readonly partial: string;
		readonly noData: string;
		readonly currentOnly: string;
		readonly loading: string;
		readonly ready: string;
		readonly error: string;
		readonly retry: string;
	};
	/**
	 * §C5.6 one-line reliability verdict at the top of the Reliability pane — the SHARED
	 * VerdictBanner + selectVerdict, at stop scope. Stop OTP is a punctuality PROXY (no
	 * scheduled-OTP concept at a stop), so the voice reads "on time" honestly off the
	 * proxy; the Wilson hedge rides the period's own observation_count (never fabricated).
	 */
	readonly verdict: VerdictCopy;
	/** Day-grain percentile clarity (typical vs worst-case delay). */
	readonly percentiles: {
		readonly heading: string;
		readonly typical: string;
		readonly typicalCaption: string;
		readonly worstCase: string;
		readonly worstCaseCaption: string;
	};
	/** Time-of-day habits heatmap (per-stop 7×24 severe-delay grid). */
	readonly habits: {
		readonly heading: string;
		readonly label: string;
		readonly cellValueLabel: string;
		readonly hourAxisLabel: string;
		readonly dayAxisLabel: string;
		readonly caption: string;
		readonly legend: {
			readonly low: string;
			readonly medium: string;
			readonly high: string;
			readonly noData: string;
			/**
			 * The four classed-tier labels, calmest → worst (P5.2 — the stop habits
			 * heatmap bins onto the same 4 tiers as the lines §1 hero; words mirror
			 * the severe-delay read). The worst tier also carries the ◆ glyph.
			 */
			readonly tiers: readonly [string, string, string, string];
		};
		readonly weekdays: readonly [string, string, string, string, string, string, string, string];
		readonly weekdaysShort: readonly [string, string, string, string, string, string, string];
	};
	/** Weekday seasonality (day_of_week). */
	readonly weekday: {
		readonly heading: string;
		readonly avgDelay: string;
		readonly severeShare: string;
		readonly caveat: string;
	};
	/** Time-of-day shift + day-type breakdown. */
	readonly timeOfDay: {
		readonly heading: string;
		readonly severeShare: string;
		readonly dayType: string;
		readonly caveat: string;
	};
	/** Crowding (occupancy_mix). */
	readonly crowding: {
		readonly heading: string;
		readonly window: string;
		readonly barLabel: string;
		readonly dominantLabel: string;
		readonly noTelemetry: string;
	};
	/**
	 * S8A daily delay-trend + range verdict (the new dated-series section). The
	 * trend plots the served daily[] severe-share over time on the fixed [0,100]
	 * domain; the verdict pools the counts over the selected window EXACTLY.
	 */
	readonly trend: {
		/** Section heading over the dated series. */
		readonly heading: string;
		/** Accessible chart title (data + window). */
		readonly chartTitle: string;
		/** Primary-series label (severe-delay share). */
		readonly severeLabel: string;
		/** Secondary-series label (avg delay). */
		readonly avgLabel: string;
		/** Percent unit suffix. */
		readonly pctUnit: string;
		/** Minutes unit suffix. */
		readonly minUnit: string;
		/** Verdict block heading (the pooled read over the window). */
		readonly verdictHeading: string;
		/** Pooled severe-share tile label. */
		readonly pooledSevere: string;
		/** Pooled avg-delay tile label. */
		readonly pooledAvg: string;
		/** Observation-count tile label. */
		readonly observations: string;
		/** Wilson-interval caption under the pooled severe-share. */
		readonly wilsonCaption: (lo: string, hi: string) => string;
		/** Names the pooled window ("N days · from → to"), honest about gaps. */
		readonly rangeWindow: (days: number, from: string, to: string) => string;
		/** Names a single pooled day. */
		readonly singleDay: (date: string) => string;
		/** Honest caveat: SEVERE-proxy, not a certified on-time rate. */
		readonly caveat: string;
		/** Shown below MIN_N: too few pooled observations to print a share. */
		readonly belowMinN: (n: number) => string;
	};
	/** No-data string for a route row whose delay is absent. */
	readonly noDelay: string;
}

export const stopReliabilityCopy: Record<Locale, StopReliabilityCopy> = {
	fr: {
		byRoute: 'Retard moyen par ligne',
		noRouteBreakdown: 'Aucun détail par ligne pour cet arrêt.',
		viewLine: (routeId) => `Voir la ligne ${routeId}`,
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
			window: (grain) =>
				grain === 'week'
					? 'Regroupé par semaine.'
					: grain === 'month'
						? 'Regroupé par mois.'
						: 'Regroupé par jour.',
		},
		history: {
			navigator: {
				group: 'Historique de fiabilité de l’arrêt',
				picker: {
					group: 'Plage de dates',
					start: 'Du',
					end: 'Au',
					clear: 'Revenir au portrait actuel',
					anyStart: 'Première date',
					anyEnd: 'Dernière date',
				},
				previous: 'Plage précédente',
				next: 'Plage suivante',
			},
			coverage: (from, to) => `Historique disponible du ${from} au ${to}.`,
			selection: (from, to) => `Plage choisie : du ${from} au ${to}.`,
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
			reliable: ({ window, onTen, lateTen, hedge }) =>
				`Arrêt fiable ${window}, environ ${onTen} passages sur 10 à l’heure${hedge}; ${lateTen} sur 10 en retard.`,
			patchy: ({ window, onTen, lateTen, hedge }) =>
				`Arrêt inégal ${window}, environ ${onTen} passages sur 10 à l’heure${hedge}; ${lateTen} sur 10 en retard.`,
			unreliable: ({ window, onTen, lateTen, hedge }) =>
				`Arrêt peu fiable ${window}, seulement ${onTen} passages sur 10 à l’heure${hedge}; ${lateTen} sur 10 en retard.`,
			tentative: ({ window, otp, n, lo, hi }) =>
				`Environ ${otp} % des passages à l’heure ${window} (sûr à 95 % entre ${lo} et ${hi} %, n=${n}).`,
			tooFew: (window, n) => `Mesure en cours ${window}, seulement ${n} passages suivis.`,
			absent: 'Mesure de l’arrêt en cours. Pas encore de lecture de ponctualité.',
			hedgeSimple: (otp) => ` (${otp} %)`,
			hedgeCI: (otp, lo, hi) => ` (${otp} %, sûr à 95 % entre ${lo} et ${hi} %)`,
		},
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
				tiers: ['Rarement grave', 'Parfois grave', 'Souvent grave', 'Très peu fiable'],
			},
			weekdays: ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
			weekdaysShort: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
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
			wilsonCaption: (lo, hi) => `Intervalle de confiance à 95 % : ${lo} – ${hi} %`,
			rangeWindow: (days, from, to) =>
				`${days} ${days === 1 ? 'jour' : 'jours'} avec données · ${from} au ${to}`,
			singleDay: (date) => `Journée du ${date}`,
			caveat:
				'La « part des retards graves » est un indicateur indirect (retards > 5 min); un arrêt n’a pas de ponctualité programmée. Ne pas comparer au taux de ponctualité d’une ligne.',
			belowMinN: (n) =>
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
			navigator: {
				group: 'Stop reliability history',
				picker: {
					group: 'Date range',
					start: 'From',
					end: 'To',
					clear: 'Return to current snapshot',
					anyStart: 'First date',
					anyEnd: 'Last date',
				},
				previous: 'Previous range',
				next: 'Next range',
			},
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
		},
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
};

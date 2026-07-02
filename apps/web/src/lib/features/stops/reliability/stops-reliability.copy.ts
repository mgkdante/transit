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

export interface StopReliabilityCopy {
	readonly byRoute: string;
	readonly noRouteBreakdown: string;
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
		/**
		 * S8B date-range picker labels (the DateRangePicker over the dated daily[]
		 * series). Bilingual, caller-owned — the primitive itself owns no copy.
		 */
		readonly range: {
			/** Accessible group label over the start/end pair. */
			readonly group: string;
			/** Start-bound select label. */
			readonly start: string;
			/** End-bound select label. */
			readonly end: string;
			/** Clear affordance (resets to the full window). */
			readonly clear: string;
			/** Neutral placeholder options (full-window sentinels). */
			readonly anyStart: string;
			readonly anyEnd: string;
		};
	};
	/** No-data string for a route row whose delay is absent. */
	readonly noDelay: string;
}

export const stopReliabilityCopy: Record<Locale, StopReliabilityCopy> = {
	fr: {
		byRoute: 'Retard moyen par ligne',
		noRouteBreakdown: 'Aucun détail par ligne pour cet arrêt.',
		paneHeading: 'Ponctualité et retard',
		metrics: {
			otp: 'Ponctualité',
			avgDelay: 'Retard moyen',
			severe: 'Part des retards graves',
		},
		controlsLabel: 'Vue',
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
			legend: { low: 'Faible', medium: 'Moyen', high: 'Élevé', noData: 'Aucune donnée' },
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
			rangeWindow: (days, from, to) => `${days} jours avec données · ${from} au ${to}`,
			singleDay: (date) => `Journée du ${date}`,
			caveat:
				'La « part des retards graves » est un indicateur indirect (retards > 5 min); un arrêt n’a pas de ponctualité programmée. Ne pas comparer au taux de ponctualité d’une ligne.',
			belowMinN: (n) =>
				`Trop peu d’observations sur cette période (${n}) pour afficher un pourcentage fiable.`,
			range: {
				group: 'Choisir une plage de dates',
				start: 'Du',
				end: 'Au',
				clear: 'Toute la période',
				anyStart: 'Début',
				anyEnd: 'Fin',
			},
		},
		noDelay: 'Aucune donnée',
	},
	en: {
		byRoute: 'Avg delay by route',
		noRouteBreakdown: 'No per-route breakdown for this stop.',
		paneHeading: 'On-time and delay',
		metrics: {
			otp: 'On-time %',
			avgDelay: 'Average delay',
			severe: 'Severe-delay share',
		},
		controlsLabel: 'View',
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
			legend: { low: 'Low', medium: 'Medium', high: 'High', noData: 'No data' },
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
			rangeWindow: (days, from, to) => `${days} days with data · ${from} to ${to}`,
			singleDay: (date) => `Day of ${date}`,
			caveat:
				'“Severe-delay share” is a proxy (delays over 5 min); a stop has no scheduled on-time definition. Do not compare it to a line’s on-time rate.',
			belowMinN: (n) =>
				`Too few observations over this window (${n}) to print a reliable percentage.`,
			range: {
				group: 'Pick a date range',
				start: 'From',
				end: 'To',
				clear: 'Full window',
				anyStart: 'Earliest',
				anyEnd: 'Latest',
			},
		},
		noDelay: 'No data',
	},
};

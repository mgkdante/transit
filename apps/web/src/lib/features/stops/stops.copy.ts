// stops.copy.ts — co-located bilingual copy for the Stops surface (slice-9.3).
//
// All user-facing strings the StopsIndex + StopDetail screens render live here,
// keyed by Locale, so the .svelte files carry zero inline copy. Domain-intrinsic
// labels (OTP / delay / "LIVE" / tab vocabulary inside the spine primitives)
// already live in those primitives and are NOT duplicated here.

import type { Locale } from '$lib/i18n';
import type { AffectedAlertsCopy, SurfaceHeadCopy } from '$lib/components/surface';

export interface StopsIndexCopy extends SurfaceHeadCopy {
	/** Search field placeholder. */
	readonly searchPlaceholder: string;
	/** Accessible label for the search field. */
	readonly searchLabel: string;
	/** Prompt shown before the rider types a query. */
	readonly searchPrompt: string;
	/** Shown when a query matches no stops. */
	readonly noMatches: string;
	/** "+N more" note builder when the filtered set exceeds the cap. */
	readonly more: (n: number) => string;
	/** Compact action linking one stop into the live map. */
	readonly mapAction: string;
	readonly viewStopOnMap: (stop: string) => string;
}

export interface StopDetailCopy {
	/** Station-voice kicker (EntityDetail). */
	readonly kicker: string;
	/** Back-link label into the stops index ("← Stops"), keeps nav in-chrome. */
	readonly back: string;
	/** Live-map drilldown action. */
	readonly viewOnMap: string;
	readonly viewStopOnMap: (stop: string) => string;
	/** Tab labels, keyed by tab key. */
	readonly tabs: {
		readonly next: string;
		readonly schedule: string;
		readonly info: string;
		readonly reliability: string;
	};
	/** "Next departures" pane. */
	readonly next: {
		/** Section label over the departures list. */
		readonly heading: string;
		/** Shown when the live board has no upcoming departures for this stop. */
		readonly none: string;
		/** Delay caption — "+N min late" / "N min early" / "on time". */
		readonly late: (min: number) => string;
		readonly early: (min: number) => string;
		readonly onTime: string;
		/** Fallback label when a departure has no route code. */
		readonly route: string;
		/** Controls-rail label collecting the departure filter chips + count. */
		readonly controlsLabel: string;
		/** Departures status / route filter affordances. */
		readonly filter: {
			/** Accessible group label over the status chips. */
			readonly statusLabel: string;
			/** On-time / late / early status chip labels. */
			readonly onTime: string;
			readonly late: string;
			readonly early: string;
			/** Accessible group label over the route chips. */
			readonly routeLabel: string;
			/** "All routes" reset chip. */
			readonly allRoutes: string;
			/** Shown when every departure is filtered out. */
			readonly noMatches: string;
			/** Live-region count of the shown vs total departures. */
			readonly showing: (shown: number, total: number) => string;
		};
	};
	/**
	 * Live service alerts affecting THIS stop (alerts whose stops[] lists this
	 * stop, or whose routes[] serve it). Surfaced in the info pane; stands down
	 * when none are active.
	 */
	readonly alerts: AffectedAlertsCopy;
	/** "Info" pane. */
	readonly info: {
		readonly position: string;
		readonly code: string;
		readonly wheelchair: string;
		readonly wheelchairYes: string;
		readonly wheelchairNo: string;
		readonly routesServed: string;
	};
	/** "Schedule" pane. */
	readonly schedule: {
		readonly heading: string;
		readonly none: string;
		/** "+N more times" note when a route's time list is capped. */
		readonly moreTimes: (n: number) => string;
	};
	/** "Reliability" pane. */
	readonly reliability: {
		readonly byRoute: string;
		readonly noRouteBreakdown: string;
		/** Controls-rail label collecting the grain picker + window caption. */
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
			/** Section heading over the typical/worst-case pair. */
			readonly heading: string;
			/** "Typical" (median, p50) tile label. */
			readonly typical: string;
			/** Plain caption under the typical tile. */
			readonly typicalCaption: string;
			/** "Worst-case" (p90) tile label. */
			readonly worstCase: string;
			/** Plain caption under the worst-case tile. */
			readonly worstCaseCaption: string;
		};
		/** Time-of-day habits heatmap (per-stop 7×24 severe-delay grid). */
		readonly habits: {
			/** Section heading over the heatmap. */
			readonly heading: string;
			/** Accessible summary for the heatmap (day × hour). */
			readonly label: string;
			/** Tooltip/SR row label — what a single cell encodes. */
			readonly cellValueLabel: string;
			/** X / Y axis captions. */
			readonly hourAxisLabel: string;
			readonly dayAxisLabel: string;
			/** Plain-language caption explaining the relative scale. */
			readonly caption: string;
			/** Legend ramp buckets (low→high) + the dedicated no-data swatch. */
			readonly legend: {
				readonly low: string;
				readonly medium: string;
				readonly high: string;
				readonly noData: string;
			};
			/** Full weekday names, ISO-indexed (index 0 unused; 1=Mon..7=Sun). */
			readonly weekdays: readonly [string, string, string, string, string, string, string, string];
			/** Heatmap row labels, Mon..Sun (length 7, in row order). */
			readonly weekdaysShort: readonly [string, string, string, string, string, string, string];
		};
		/**
		 * Weekday seasonality (day_of_week, ISO 1=Mon..7=Sun): which weekday drags
		 * this stop down most, ranked worst-first by mean delay. The weekday NAMES
		 * come from the shared shiftGrains vocabulary, not from here. A trailing-
		 * window observation-weighted proxy, NOT certified.
		 */
		readonly weekday: {
			/** Section heading over the weekday ranked list. */
			readonly heading: string;
			/** Per-row subtitle when the mean delay is the reading (no trusted severe share). */
			readonly avgDelay: string;
			/** Per-row subtitle prefix when a well-sampled severe share is the reading. */
			readonly severeShare: string;
			/** Honest caveat: trailing-window proxy, small samples vary. */
			readonly caveat: string;
		};
		/**
		 * Time-of-day shift + day-type breakdown (am_peak…night, weekday/weekend).
		 * Surfaced alongside the calendar grains; the SHIFT grains never enter the
		 * GrainPicker. A trailing-window observation-weighted proxy, NOT certified.
		 */
		readonly timeOfDay: {
			/** Section heading over the by-shift ranked list. */
			readonly heading: string;
			/** Per-row subtitle naming what the bar magnitude encodes (severe share). */
			readonly severeShare: string;
			/** Sub-heading over the weekday-vs-weekend comparison pair. */
			readonly dayType: string;
			/** Honest caveat: trailing-window proxy, small samples vary. */
			readonly caveat: string;
		};
		/**
		 * Crowding (occupancy_mix): the band-shares of buses OBSERVED AT this stop
		 * (GTFS-RT VehiclePosition stop_id) over a trailing window — NOT a stop
		 * attribute per se. The band NAMES come from the shared lines occupancy
		 * vocabulary, not from here. Stands down entirely when no telemetry.
		 */
		readonly crowding: {
			/** Section heading over the occupancy bar. */
			readonly heading: string;
			/** Window + provenance caption: WHAT this measures + over WHAT window. */
			readonly window: string;
			/** Accessible label for the proportion bar. */
			readonly barLabel: string;
			/** Headline label under the dominant band's share. */
			readonly dominantLabel: string;
			/** Honest empty state when no occupancy telemetry was attributed here. */
			readonly noTelemetry: string;
		};
		/** No-data string for a route row whose delay is absent. */
		readonly noDelay: string;
	};
}

export const indexCopy: Record<Locale, StopsIndexCopy> = {
	fr: {
		kicker: 'ARRÊTS · CATALOGUE',
		heading: 'Arrêts',
		subheading: '// RECHERCHE',
		lede: 'Cherchez un arrêt par nom ou par code pour voir ses prochains passages et sa fiabilité. On n’invente jamais de données.',
		searchPlaceholder: 'Nom ou code d’arrêt…',
		searchLabel: 'Rechercher un arrêt',
		searchPrompt: 'Commencez à taper pour filtrer les arrêts.',
		noMatches: 'Aucun arrêt ne correspond à cette recherche.',
		more: (n) => `+${n} autres arrêts, affinez la recherche`,
		mapAction: 'Carte',
		viewStopOnMap: (stop) => `Voir l’arrêt ${stop} sur la carte`,
	},
	en: {
		kicker: 'STOPS · CATALOGUE',
		heading: 'Stops',
		subheading: '// SEARCH',
		lede: 'Search a stop by name or code to see its next departures and reliability. We never invent data.',
		searchPlaceholder: 'Stop name or code…',
		searchLabel: 'Search stops',
		searchPrompt: 'Start typing to filter stops.',
		noMatches: 'No stops match this search.',
		more: (n) => `+${n} more stops, refine the search`,
		mapAction: 'Map',
		viewStopOnMap: (stop) => `View stop ${stop} on map`,
	},
};

export const detailCopy: Record<Locale, StopDetailCopy> = {
	fr: {
		kicker: 'ARRÊT',
		back: 'Arrêts',
		viewOnMap: 'Voir sur la carte',
		viewStopOnMap: (stop) => `Voir l’arrêt ${stop} sur la carte`,
		tabs: { next: 'Prochains', schedule: 'Horaire', info: 'Info', reliability: 'Fiabilité' },
		next: {
			heading: 'Prochains passages',
			none: 'Aucun passage à venir pour le moment.',
			late: (min) => `+${min} min de retard`,
			early: (min) => `${min} min d’avance`,
			onTime: 'à l’heure',
			route: 'Ligne',
			controlsLabel: 'Filtres',
			filter: {
				statusLabel: 'Filtrer par statut',
				onTime: 'À l’heure',
				late: 'En retard',
				early: 'En avance',
				routeLabel: 'Filtrer par ligne',
				allRoutes: 'Toutes les lignes',
				noMatches: 'Aucun passage ne correspond à ce filtre.',
				showing: (shown, total) => `${shown} sur ${total} passages affichés`,
			},
		},
		alerts: {
			heading: 'Avis de service',
			listLabel: 'Avis de service touchant cet arrêt',
			cause: 'Cause',
			effect: 'Effet',
			from: 'À partir de',
			until: 'Jusqu’à',
			severity: { critical: 'Critique', high: 'Élevé', watch: 'À surveiller' },
			more: (n) => `+${n} de plus`,
			showLess: 'Réduire',
		},
		info: {
			position: 'Position',
			code: 'Code d’arrêt',
			wheelchair: 'Accessibilité',
			wheelchairYes: 'Accessible en fauteuil roulant',
			wheelchairNo: 'Non accessible en fauteuil roulant',
			routesServed: 'Lignes desservies',
		},
		schedule: {
			heading: 'Horaire prévu',
			none: 'Aucun horaire prévu pour cet arrêt.',
			moreTimes: (n) => `+${n} autres passages`,
		},
		reliability: {
			byRoute: 'Retard moyen par ligne',
			noRouteBreakdown: 'Aucun détail par ligne pour cet arrêt.',
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
			noDelay: 'Aucune donnée',
		},
	},
	en: {
		kicker: 'STOP',
		back: 'Stops',
		viewOnMap: 'View on map',
		viewStopOnMap: (stop) => `View stop ${stop} on map`,
		tabs: { next: 'Next', schedule: 'Schedule', info: 'Info', reliability: 'Reliability' },
		next: {
			heading: 'Next departures',
			none: 'No upcoming departures right now.',
			late: (min) => `+${min} min late`,
			early: (min) => `${min} min early`,
			onTime: 'on time',
			route: 'Line',
			controlsLabel: 'Filters',
			filter: {
				statusLabel: 'Filter by status',
				onTime: 'On time',
				late: 'Late',
				early: 'Early',
				routeLabel: 'Filter by line',
				allRoutes: 'All lines',
				noMatches: 'No departures match this filter.',
				showing: (shown, total) => `Showing ${shown} of ${total} departures`,
			},
		},
		alerts: {
			heading: 'Service alerts',
			listLabel: 'Service alerts affecting this stop',
			cause: 'Cause',
			effect: 'Effect',
			from: 'From',
			until: 'Until',
			severity: { critical: 'Critical', high: 'High', watch: 'Watch' },
			more: (n) => `+${n} more`,
			showLess: 'Show less',
		},
		info: {
			position: 'Position',
			code: 'Stop code',
			wheelchair: 'Accessibility',
			wheelchairYes: 'Wheelchair accessible',
			wheelchairNo: 'Not wheelchair accessible',
			routesServed: 'Routes served',
		},
		schedule: {
			heading: 'Scheduled service',
			none: 'No scheduled service for this stop.',
			moreTimes: (n) => `+${n} more times`,
		},
		reliability: {
			byRoute: 'Avg delay by route',
			noRouteBreakdown: 'No per-route breakdown for this stop.',
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
				weekdays: [
					'',
					'Monday',
					'Tuesday',
					'Wednesday',
					'Thursday',
					'Friday',
					'Saturday',
					'Sunday',
				],
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
			noDelay: 'No data',
		},
	},
};

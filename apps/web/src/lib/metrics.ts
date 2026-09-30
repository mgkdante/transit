import { serviceComparisonCopy } from '$lib/v1/serviceComparison';
import { localizeHref, type Locale } from '$lib/i18n';

export type MetricKey =
	| 'otp'
	| 'avgDelay'
	| 'p50p90'
	| 'severe'
	| 'regularityCov'
	| 'headway'
	| 'excessWait'
	| 'cancellation'
	| 'skippedStop'
	| 'serviceSpan'
	| 'occupancy'
	| 'habits'
	| 'seasonality'
	| 'weakStops';

interface BilingualText {
	readonly en: string;
	readonly fr: string;
}

/** Shared short definitions for popovers and the full methodology entries. */
export const METRIC_SUMMARIES: Readonly<
	Record<
		MetricKey,
		{
			readonly anchor: string;
			readonly name: BilingualText;
			readonly oneLiner: BilingualText;
		}
	>
> = {
	otp: {
		anchor: 'otp',
		name: { fr: 'Ponctualité', en: 'On-time %' },
		oneLiner: {
			fr: 'La part des prédictions à retard connu entre une minute d’avance et moins de cinq minutes de retard.',
			en: 'The share of known-delay predictions between one minute early and less than five minutes late.',
		},
	},
	avgDelay: {
		anchor: 'avg-delay',
		name: { fr: 'Retard moyen', en: 'Average delay' },
		oneLiner: {
			fr: 'L’écart moyen prédit par rapport à l’horaire, en minutes : positif pour un retard, négatif pour une avance.',
			en: 'Average predicted deviation from the timetable, in minutes: positive for late, negative for early.',
		},
	},
	p50p90: {
		anchor: 'p50-p90',
		name: { fr: 'Retard médian et 90e percentile', en: 'Median and 90th-percentile delay' },
		oneLiner: {
			fr: 'La médiane situe le centre des retards prédits rapportés; le 90e percentile décrit leur partie haute. Il ne représente pas le retard maximal.',
			en: 'The median describes the centre of reported predicted delays; the 90th percentile describes their upper range. It is not the maximum delay.',
		},
	},
	severe: {
		anchor: 'severe',
		name: { fr: 'Part des retards graves', en: 'Severe-delay share' },
		oneLiner: {
			fr: 'La part des prédictions à plus de cinq minutes et au plus une heure de retard, parmi les observations de la vue affichée.',
			en: 'The share of predictions more than five minutes and at most one hour late, among the displayed view’s observations.',
		},
	},
	weakStops: {
		anchor: 'weak-stops',
		name: { fr: 'Arrêts les plus en retard', en: 'Weak stops' },
		oneLiner: {
			fr: 'Les arrêts d’une ligne où les prédictions de retard sont les moins favorables, selon la période affichée.',
			en: 'Stops on a line with less favorable delay predictions, for the displayed period.',
		},
	},
	regularityCov: {
		anchor: 'regularity',
		name: { fr: 'Régularité des intervalles (CV)', en: 'Headway regularity (CoV)' },
		oneLiner: {
			fr: 'La variabilité des intervalles entre apparitions de trajets dans le flux. Le CV augmente avec l’irrégularité; la part d’apparitions rapprochées estime les écarts inférieurs à la moitié de la médiane.',
			en: 'Variation in the gaps between trips appearing in the feed. CoV rises with irregularity; the closely spaced share estimates gaps below half the median.',
		},
	},
	headway: {
		anchor: 'headway',
		name: { fr: 'Intervalle dans le flux et prévu', en: 'Feed-appearance and scheduled headway' },
		oneLiner: {
			fr: 'L’intervalle médian entre les premières apparitions de trajets dans le flux, comparé aux départs prévus au premier arrêt. Il ne mesure pas votre attente à un arrêt.',
			en: 'The median gap between trips first appearing in the feed, compared with scheduled first-stop departures. It does not measure your wait at a stop.',
		},
	},
	excessWait: {
		anchor: 'excess-wait',
		name: { fr: 'Attente excédentaire', en: 'Excess wait' },
		oneLiner: {
			fr: "Estimation d'attente excédentaire fondée sur les apparitions de trajets et des arrivées uniformes des usagers, ramenée à zéro au minimum.",
			en: 'Modeled extra wait from trip appearances, assuming uniform rider arrivals and clamped to zero.',
		},
	},
	cancellation: {
		anchor: 'cancellation',
		name: { fr: "Taux d'annulation", en: 'Cancellation rate' },
		oneLiner: {
			fr: "Des trajets que le flux temps réel a RAPPORTÉS pour une ligne ce jour-là, la part qu'il a marqués annulés, pas la part de l'horaire complet (les trajets jamais mentionnés ne comptent pas).",
			en: 'Of the trips the realtime feed actually REPORTED for a route that day, the share it flagged canceled, not the share of the full timetable (trips the feed never mentions are not counted).',
		},
	},
	skippedStop: {
		anchor: 'skipped-stop',
		name: { fr: "Taux d'arrêts non desservis", en: 'Skipped-stop rate' },
		oneLiner: {
			fr: "La part des messages de prédiction d'arrêt qui portaient un drapeau « cet arrêt sera sauté », un drapeau déclaré par le flux, pas un dépassement physique vérifié.",
			en: 'The share of stop-prediction messages that carried a “this stop will be skipped” flag, a feed-declared flag, not a verified physical pass-by.',
		},
	},
	serviceSpan: {
		anchor: 'service-span',
		name: {
			fr: 'Écart entre premières apparitions de trajets',
			en: 'Span of trip first appearances',
		},
		oneLiner: {
			fr: 'L’écart entre la plus précoce et la plus tardive des premières captures de trajets d’une ligne pour un jour de service GTFS. Il ne prouve ni des départs réels ni une période de fonctionnement continu.',
			en: 'The gap between the earliest and latest first captured reports of a route’s trips for one GTFS service day. It establishes neither real departures nor continuous operation.',
		},
	},
	occupancy: {
		anchor: 'occupancy',
		name: { fr: 'Achalandage (parts par palier)', en: 'Occupancy mix (crowding)' },
		oneLiner: {
			fr: "La part des relevés de véhicules dans chacun des cinq paliers d'achalandage (vide, plusieurs places, peu de places, debout, plein), la part des bus-moments rapportés, PAS « % plein » ni « % d'usagers debout ».",
			en: 'The share of vehicle reports in each of five crowding levels (empty, many seats, few seats, standing, full), the share of reported bus-moments, NOT “% full” or “% of riders standing.”',
		},
	},
	habits: {
		anchor: 'habits',
		name: { fr: 'Scores horaires relatifs (7×24)', en: 'Relative hourly scores (7×24)' },
		oneLiner: {
			fr: 'Un score relatif par jour et heure au sein d’une ligne ou d’un arrêt. 1 désigne son plus grand score fourni, 0 un score fourni nul; une case vide est indisponible. Ce score ne mesure pas une probabilité de retard et ne compare pas les entités.',
			en: 'A relative score for each weekday and hour within one line or stop. 1 is its highest supplied score, 0 a supplied zero score; a blank cell is unavailable. The score measures neither delay probability nor differences between entities.',
		},
	},
	seasonality: {
		anchor: 'seasonality',
		name: { fr: 'Saisonnalité hebdomadaire', en: 'Weekday seasonality' },
		oneLiner: {
			fr: 'Regroupe les relevés par jour de la semaine (lun-dim, heure locale) et montre par jour le retard moyen et la part de retards graves, sur TOUT l’historique accumulé du spine (rétention 730 jours), donc un motif de long terme, pas les derniers jours.',
			en: 'Groups readings by weekday (Mon–Sun, local time) and shows, per weekday, the average lateness and severe-delay share over the route’s WHOLE accrued spine history (730-day retention), so a long-run pattern, not just the last few days.',
		},
	},
};

/** Localized name for a metric key (FR canonical / EN mirror). */
export function metricName(key: MetricKey, locale: Locale): string {
	return METRIC_SUMMARIES[key].name[locale];
}

// ── Supplemental (i) tips ──────────────────────────────────────────────────────
//
// Some surfaces label numbers that are NOT one of the 14 reliability families that
// drive the /metrics explainer page (live feed coverage,
// observation counts, and the /alerts GTFS-RT dimensions). They still deserve an
// honest one-line (i) tip with a deep link into /metrics, but they do NOT get their
// own explainer section, so they live here rather than in the METRICS array (which
// the explainer page renders 1:1 and the coverage test pins exactly).
//
// Each entry identifies its own population and missing-data rules. Its `anchor`
// links to the existing /metrics section that explains that source or methodology.
export type SupplementalMetricKey =
	| 'liveOtp'
	| 'liveDelayPercentiles'
	| 'stopNotSevere'
	| 'coverage'
	| 'serviceComparison'
	| 'vehicleCount'
	| 'affectedCounts'
	| 'silentTrip'
	| 'alertCause'
	| 'alertEffect'
	| 'alertSeverity'
	| 'alertDuration'
	| 'alertReach';

interface SupplementalMetricEntry {
	/** Deep-link target — an existing /metrics section anchor (no leading '#'). */
	readonly anchor: string;
	/** ONE-LINE plain explanation, the (i) hover tip (FR canonical / EN mirror). */
	readonly oneLiner: BilingualText;
}

export const SUPPLEMENTAL_METRIC_TIPS: Readonly<
	Record<SupplementalMetricKey, SupplementalMetricEntry>
> = {
	serviceComparison: {
		anchor: 'cancellation',
		oneLiner: { en: serviceComparisonCopy.en.tip, fr: serviceComparisonCopy.fr.tip },
	},
	liveOtp: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'Parmi les véhicules actuels admissibles sur la carte et au statut connu, la part dont le retard prédit moyen du trajet est compris entre −60 s inclus et 300 s exclus. Les statuts inconnus sont exclus du dénominateur.',
			en: 'Among current vehicle rows eligible for the map and with a known status, the share whose trip-average predicted delay is at least −60 s and below 300 s. Unknown statuses are excluded from the denominator.',
		},
	},
	stopNotSevere: {
		anchor: 'severe',
		oneLiner: {
			fr: 'La part des prévisions connues admissibles à cet arrêt dont le retard ne dépasse pas 300 secondes, y compris les avances. Les retards hors de [−3 600, 3 600] secondes sont exclus. Cette part est le complément des retards graves, pas une ponctualité mesurée.',
			en: 'The share of eligible known predictions at this stop no more than 300 seconds late, including early predictions. Delays outside [−3,600, 3,600] seconds are excluded. This is the complement of severe-delay share, not measured on-time performance.',
		},
	},
	liveDelayPercentiles: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'Médiane et 90e percentile des retards prédits moyens par trajet actuels, chaque agrégat de trajet ayant le même poids, arrondis à la minute. Valeur indisponible sans trajet mesuré; aucune pondération par les usagers.',
			en: 'Median and 90th percentile of current trip-average predicted delays, with equal weight per trip aggregate, rounded to whole minutes. Unavailable without measured trips; no passenger weighting.',
		},
	},
	coverage: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'La part des véhicules actuels admissibles sur la carte dont le statut de retard est connu. Sans position admissible, la valeur est indisponible. Les véhicules absents du flux ne sont pas au dénominateur.',
			en: 'The share of current vehicle-position rows eligible for the map with a known delay status. Unavailable without eligible positions. Vehicles absent from the feed are outside the denominator.',
		},
	},
	vehicleCount: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'Le nombre de positions de véhicules actuelles aux coordonnées valides dans la zone configurée, sans dédoublonnage supplémentaire par identifiant de véhicule. Ce décompte ne mesure ni la flotte officielle ni les véhicules distincts sur une journée.',
			en: 'The count of current vehicle-position rows with valid coordinates within configured map bounds, without additional deduplication by vehicle ID. This is neither the official fleet size nor a count of distinct vehicles over a day.',
		},
	},
	affectedCounts: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "Lignes et arrêts distincts ayant au moins une prévision attribuée de retard supérieur à 5 minutes et d'au plus 60 minutes ce jour-là. Les versions d'avis comptent les contenus distincts enregistrés, pas les incidents ni les usagers. Une source absente laisse le décompte de lignes ou d'arrêts inconnu.",
			en: 'Distinct lines and stops with at least one attributed delay prediction greater than 5 and at most 60 minutes that day. Alert versions count distinct recorded message content, not incidents or riders. Missing route or stop data leaves that count unknown.',
		},
	},
	silentTrip: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: 'Les trajets prévus en circulation maintenant, hors métro, sans véhicule correspondant dans l’instantané actuel. Un trajet peut avoir émis plus tôt; son absence actuelle ne confirme pas une annulation.',
			en: 'Scheduled non-metro trips running now with no matching vehicle in the current snapshot. A trip may have reported earlier; its current absence does not confirm a cancellation.',
		},
	},
	alertCause: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "La cause déclarée d'une alerte (p. ex. travaux, météo, panne), reprise telle quelle du flux GTFS-RT, pas une enquête ni une vérification indépendante.",
			en: 'The declared cause of an alert (e.g. construction, weather, breakdown), taken as-is from the GTFS-RT feed, not an investigation or independent check.',
		},
	},
	alertEffect: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "L'effet déclaré d'une alerte sur le service (p. ex. détour, retards, arrêt déplacé), repris tel quel du flux, pas un impact mesuré.",
			en: 'The declared effect of an alert on service (e.g. detour, delays, stop moved), taken as-is from the feed, not a measured impact.',
		},
	},
	alertSeverity: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "Le niveau de gravité que l'agence a attaché à l'alerte dans le flux, son propre étiquetage, pas un score calculé par nous.",
			en: 'The severity level the agency attached to the alert in the feed, its own labelling, not a score we computed.',
		},
	},
	alertDuration: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "La durée annoncée d'une alerte d'après ses fenêtres actives du flux, NULL quand la fenêtre est ouverte ou incohérente, jamais un 0 inventé.",
			en: 'An alert’s announced duration from its active windows in the feed, NULL when the window is open-ended or inconsistent, never a fabricated 0.',
		},
	},
	alertReach: {
		anchor: 'metrics-provenance',
		oneLiner: {
			fr: "Le nombre de lignes et d'arrêts qu'une alerte déclare toucher d'après le flux, un décompte d'entités nommées, pas une estimation d'usagers affectés.",
			en: 'How many routes and stops an alert declares it affects per the feed, a count of named entities, not an estimate of affected riders.',
		},
	},
};

export const metricInfoCopy = {
	confidenceIntervalLink: {
		fr: 'Méthode et limites',
		en: 'Method and limits',
	},
	fr: {
		trigger: (name: string) => `À propos de ${name}`,
		link: 'Comment c’est mesuré',
	},
	en: {
		trigger: (name: string) => `About ${name}`,
		link: 'How this is measured',
	},
};

/**
 * The (i)-affordance payload for a metric label on a data surface: the one-line
 * tip + a localized deep link to the explainer at that metric's anchor.
 *
 * Resolves BOTH the 14 reliability families (MetricKey, full explainer entry) and
 * the supplemental metrics (SupplementalMetricKey: coverage,
 * vehicle/silent-trip counts, the /alerts dimensions) that carry only a tip +
 * anchor. `localizeHref` strips/re-adds the locale prefix; the `#anchor` is
 * appended by us (localizeHref treats the hash as caller-owned), so EN →
 * `/metrics#otp` and FR → `/fr/metrics#otp`.
 */
export function metricInfoFor(
	key: MetricKey | SupplementalMetricKey,
	locale: Locale,
): { tip: string; href: string; anchor: string } {
	const entry: { oneLiner: BilingualText; anchor: string } =
		key in METRIC_SUMMARIES
			? METRIC_SUMMARIES[key as MetricKey]
			: SUPPLEMENTAL_METRIC_TIPS[key as SupplementalMetricKey];
	return {
		tip: entry.oneLiner[locale],
		href: `${localizeHref('/metrics', locale)}#${entry.anchor}`,
		anchor: entry.anchor,
	};
}

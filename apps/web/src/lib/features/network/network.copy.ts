// network.copy.ts — co-located bilingual copy for the Network-health surface.
//
// Co-located with NetworkHealth.svelte so the screen owns no inline strings.
// Domain-intrinsic component vocabulary (status/occupancy band labels, the LIVE
// chip, edge-state copy) already lives inside the spine + dataviz primitives;
// this file only carries the surface-level prose + metric/section captions.
//
// Shape: `Record<Locale, {...}>` with EN + FR. The FR voice is the canonical
// product voice (mirrors the raw-FR /v1 headers); EN is the parallel translation.

import type { Locale } from '$lib/i18n';
import type { OccupancyCode, StatusCode } from '$lib/v1/schemas';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export interface NetworkCopy extends SurfaceHeadCopy {
	/** Section caption above the live metric grid. */
	readonly liveSection: string;
	/** Section caption above the trend chart. */
	readonly trendSection: string;
	/** Section caption above the cancellation-rate trend. */
	readonly cancelSection: string;
	/** Section caption above the per-day crowding-mix small multiple. */
	readonly occupancyTrendSection: string;
	/** Section caption above the network "by time of day" readout. */
	readonly shiftSection: string;
	/** Section caption above the weekday-vs-weekend readout. */
	readonly dayTypeSection: string;
	/** Section caption above the status-mix bar. */
	readonly statusSection: string;
	/** Section caption above the occupancy-mix bar. */
	readonly occupancySection: string;
	/** Metric labels for the headline grid. */
	readonly metrics: {
		readonly onTime: string;
		readonly vehicles: string;
		readonly notReporting: string;
		readonly coverage: string;
		readonly delayP50: string;
		readonly delayP90: string;
	};
	/** Worker-cycle feed-staleness chip (distinct from snapshot-publish age). */
	readonly feedAge: {
		/** Leading label for the chip (e.g. "FEED"). */
		readonly label: string;
		/** Accessible prefix read before the formatted age. */
		readonly a11yPrefix: string;
	};
	/** A11y / legend labels for the two distribution bars. */
	readonly statusBarLabel: string;
	readonly occupancyBarLabel: string;
	/** Trend-chart series labels + accessible summary. */
	readonly trend: {
		readonly onTimeLabel: string;
		readonly retardLabel: string;
		/** The two retard-series choices for the toggle. */
		readonly retardP90: string;
		readonly retardAvg: string;
		/** Accessible group label for the retard-series toggle. */
		readonly retardToggleLabel: string;
		readonly summary: string;
		/** Accessible summary of the vehicles-in-service context sparkline. */
		readonly vehiclesSpark: string;
		/** Caption shown under the vehicles context sparkline. */
		readonly vehiclesContext: string;
	};
	/** Cancellation-rate trend labels. */
	readonly cancel: {
		/** Headline metric label (latest day's value). */
		readonly metric: string;
		/** Trend series + axis label. */
		readonly seriesLabel: string;
		/** Accessible chart summary. */
		readonly summary: string;
	};
	/** Per-day crowding small-multiple labels. */
	readonly occupancyTrend: {
		/** Accessible summary of the whole small-multiple. */
		readonly summary: string;
	};
	/** Network "by time of day" + weekday/weekend readouts (shared shift vocab). */
	readonly shift: {
		/** Accessible summary of the time-of-day ranked list. */
		readonly shiftSummary: string;
		/** Accessible summary of the weekday/weekend ranked list. */
		readonly dayTypeSummary: string;
		/** Per-row caption — what the headline value + magnitude bar encode. */
		readonly rowCaption: string;
		/** Subtitle prefix for the average-delay reading. */
		readonly avgLabel: string;
		/** Subtitle prefix for the severe-delay-share reading. */
		readonly severeLabel: string;
		/**
		 * Honest caveat: these grains are a real on-time/known OTP over the
		 * trailing window — a punctuality proxy, not certified OTP — so small
		 * samples vary.
		 */
		readonly caveat: string;
	};
	/** Window selector (7/30/90-day) labels. */
	readonly window: {
		/** Accessible group label for the window selector. */
		readonly label: string;
		/** Segment labels, keyed by day count. */
		readonly d7: string;
		readonly d30: string;
		readonly d90: string;
	};
	/** Shown in place of a metric value when the contract reports null. */
	readonly noData: string;
	/** Units appended to formatted values (kept out of the .svelte). */
	readonly units: {
		readonly pct: string;
		readonly min: string;
	};
}

export const copy: Record<Locale, NetworkCopy> = {
	en: {
		kicker: 'NETWORK · LIVE',
		heading: 'Network health',
		lede: 'Live network-wide on-time performance, crowding and feed freshness, measured from the /v1 contract. We never invent data: a missing signal shows as “no data”, not a fabricated zero.',
		liveSection: 'Live now',
		trendSection: 'Daily trend',
		cancelSection: 'Cancellations',
		occupancyTrendSection: 'Crowding by day',
		shiftSection: 'By time of day',
		dayTypeSection: 'Weekday vs weekend',
		statusSection: 'Status mix',
		occupancySection: 'Crowding',
		metrics: {
			onTime: 'On-time',
			vehicles: 'Vehicles in service',
			notReporting: 'Not reporting',
			coverage: 'Coverage',
			delayP50: 'Median delay',
			delayP90: 'Slowest 10%',
		},
		feedAge: { label: 'FEED', a11yPrefix: 'Worker feed updated' },
		statusBarLabel: 'Network status mix',
		occupancyBarLabel: 'Network crowding mix',
		trend: {
			onTimeLabel: 'On-time %',
			retardLabel: 'Slowest 10% (min)',
			retardP90: 'Slowest 10%',
			retardAvg: 'Typical',
			retardToggleLabel: 'Delay series',
			summary: 'Daily on-time % and the chosen delay series over the recent network trend.',
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
		window: { label: 'Trend window', d7: '7d', d30: '30d', d90: '90d' },
		noData: 'no data',
		units: { pct: '%', min: ' min' },
	},
	fr: {
		kicker: 'RÉSEAU · EN DIRECT',
		heading: 'Santé du réseau',
		lede: 'Ponctualité, achalandage et fraîcheur du flux à l’échelle du réseau, mesurés à partir du contrat /v1. On n’invente jamais de données : un signal absent s’affiche « aucune donnée », jamais un zéro fabriqué.',
		liveSection: 'En direct',
		trendSection: 'Tendance quotidienne',
		cancelSection: 'Annulations',
		occupancyTrendSection: 'Achalandage par jour',
		shiftSection: 'Par moment de la journée',
		dayTypeSection: 'Semaine et fin de semaine',
		statusSection: 'Répartition des statuts',
		occupancySection: 'Achalandage',
		metrics: {
			onTime: 'À l’heure',
			vehicles: 'Véhicules en service',
			notReporting: 'Sans signal',
			coverage: 'Couverture',
			delayP50: 'Retard médian',
			delayP90: '10 % les plus lents',
		},
		feedAge: { label: 'FLUX', a11yPrefix: 'Flux du travailleur mis à jour' },
		statusBarLabel: 'Répartition des statuts du réseau',
		occupancyBarLabel: 'Répartition de l’achalandage du réseau',
		trend: {
			onTimeLabel: 'Ponctualité %',
			retardLabel: '10 % les plus lents (min)',
			retardP90: '10 % les plus lents',
			retardAvg: 'Typique',
			retardToggleLabel: 'Série de retard',
			summary:
				'Ponctualité quotidienne et la série de retard choisie sur la tendance récente du réseau.',
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
		window: { label: 'Fenêtre de tendance', d7: '7 j', d30: '30 j', d90: '90 j' },
		noData: 'aucune donnée',
		units: { pct: '%', min: ' min' },
	},
};

/** Localized band labels for each StatusCode (status-mix bar segments + legend). */
export const STATUS_LABELS: Record<Locale, Record<StatusCode, string>> = {
	en: {
		early: 'Early',
		on_time: 'On-time',
		late: 'Late',
		severe: 'Severe',
		unknown: 'Unknown',
	},
	fr: {
		early: 'En avance',
		on_time: 'À l’heure',
		late: 'En retard',
		severe: 'Sévère',
		unknown: 'Inconnu',
	},
};

/** Localized band labels for each OccupancyCode (crowding bar segments + legend). */
export const OCCUPANCY_LABELS: Record<Locale, Record<OccupancyCode, string>> = {
	en: {
		empty: 'Empty',
		many_seats: 'Many seats',
		few_seats: 'Few seats',
		standing: 'Standing',
		full: 'Full',
	},
	fr: {
		empty: 'Vide',
		many_seats: 'Plusieurs places',
		few_seats: 'Peu de places',
		standing: 'Debout',
		full: 'Plein',
	},
};

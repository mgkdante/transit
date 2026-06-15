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

export interface NetworkCopy {
	/** Mono station-voice overline. */
	readonly kicker: string;
	/** Display heading. */
	readonly heading: string;
	/** Muted lede paragraph (~52ch). */
	readonly lede: string;
	/** Section caption above the live metric grid. */
	readonly liveSection: string;
	/** Section caption above the trend chart. */
	readonly trendSection: string;
	/** Section caption above the status-mix bar. */
	readonly statusSection: string;
	/** Section caption above the occupancy-mix bar. */
	readonly occupancySection: string;
	/** Metric labels for the headline grid. */
	readonly metrics: {
		readonly onTime: string;
		readonly vehicles: string;
		readonly coverage: string;
		readonly delayP50: string;
		readonly delayP90: string;
	};
	/** A11y / legend labels for the two distribution bars. */
	readonly statusBarLabel: string;
	readonly occupancyBarLabel: string;
	/** Trend-chart series labels + accessible summary. */
	readonly trend: {
		readonly onTimeLabel: string;
		readonly retardLabel: string;
		readonly summary: string;
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
		lede: 'Live network-wide on-time performance, crowding and feed freshness — measured from the /v1 contract. We never invent data: a missing signal shows as “no data”, not a fabricated zero.',
		liveSection: 'Live now',
		trendSection: 'Daily trend',
		statusSection: 'Status mix',
		occupancySection: 'Crowding',
		metrics: {
			onTime: 'On-time',
			vehicles: 'Vehicles in service',
			coverage: 'Coverage',
			delayP50: 'Median delay',
			delayP90: 'Slowest 10%',
		},
		statusBarLabel: 'Network status mix',
		occupancyBarLabel: 'Network crowding mix',
		trend: {
			onTimeLabel: 'On-time %',
			retardLabel: 'Slowest 10% (min)',
			summary: 'Daily on-time % and the slowest-10% (p90) delay over the recent network trend.',
		},
		noData: 'no data',
		units: { pct: '%', min: ' min' },
	},
	fr: {
		kicker: 'RÉSEAU · EN DIRECT',
		heading: 'Santé du réseau',
		lede: 'Ponctualité, achalandage et fraîcheur du flux à l’échelle du réseau — mesurés à partir du contrat /v1. On n’invente jamais de données : un signal absent s’affiche « aucune donnée », jamais un zéro fabriqué.',
		liveSection: 'En direct',
		trendSection: 'Tendance quotidienne',
		statusSection: 'Répartition des statuts',
		occupancySection: 'Achalandage',
		metrics: {
			onTime: 'À l’heure',
			vehicles: 'Véhicules en service',
			coverage: 'Couverture',
			delayP50: 'Retard médian',
			delayP90: '10 % les plus lents',
		},
		statusBarLabel: 'Répartition des statuts du réseau',
		occupancyBarLabel: 'Répartition de l’achalandage du réseau',
		trend: {
			onTimeLabel: 'Ponctualité %',
			retardLabel: '10 % les plus lents (min)',
			summary: 'Ponctualité quotidienne et retard des 10 % les plus lents (p90) sur la tendance récente du réseau.',
		},
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

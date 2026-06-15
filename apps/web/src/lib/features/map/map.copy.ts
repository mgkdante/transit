// Co-located copy for the live map hero (Family A, slice-9.3).
//
// Intrinsic bilingual vocabulary. STATUS_LABELS / OCCUPANCY_LABELS mirror the
// network surface's band labels; kept local to keep the feature self-contained
// (a shared transit-vocab module is a beautification-pass follow-up).

import type { Locale } from '$lib/i18n';
import type { StatusCode, OccupancyCode } from '$lib/v1';

export interface MapCopy {
	/** Mono overline above the heading. */
	readonly kicker: string;
	readonly heading: string;
	/** Accessible name for the map region. */
	readonly mapLabel: string;
	/** Statut|Crowding toggle. */
	readonly modeStatus: string;
	readonly modeOccupancy: string;
	readonly modeAria: string;
	/** "Arrêts près de moi" button. */
	readonly nearMe: string;
	/** No-data occupancy legend row. */
	readonly noData: string;
	/** Entity legend labels (one colour per type). */
	readonly entityBuses: string;
	readonly entityStops: string;
}

export const copy: Record<Locale, MapCopy> = {
	en: {
		kicker: 'NETWORK · LIVE',
		heading: 'Live map',
		mapLabel: 'Live transit map of Montréal — buses coloured by status',
		modeStatus: 'Status',
		modeOccupancy: 'Crowding',
		modeAria: 'Colour buses by',
		nearMe: 'Stops near me',
		noData: 'No data',
		entityBuses: 'Buses',
		entityStops: 'Stops',
	},
	fr: {
		kicker: 'RÉSEAU · EN DIRECT',
		heading: 'Carte en direct',
		mapLabel: 'Carte en direct du réseau de Montréal — bus colorés par statut',
		modeStatus: 'Statut',
		modeOccupancy: 'Achalandage',
		modeAria: 'Colorer les bus par',
		nearMe: 'Arrêts près de moi',
		noData: 'Aucune donnée',
		entityBuses: 'Bus',
		entityStops: 'Arrêts',
	},
};

/** Localized StatusCode labels (status mode legend). */
export const STATUS_LABELS: Record<Locale, Record<StatusCode, string>> = {
	en: { early: 'Early', on_time: 'On-time', late: 'Late', severe: 'Severe', unknown: 'Unknown' },
	fr: { early: 'En avance', on_time: 'À l’heure', late: 'En retard', severe: 'Grave', unknown: 'Inconnu' },
};

/** Localized OccupancyCode labels (crowding mode legend). */
export const OCCUPANCY_LABELS: Record<Locale, Record<OccupancyCode, string>> = {
	en: { empty: 'Empty', many_seats: 'Many seats', few_seats: 'Few seats', standing: 'Standing', full: 'Full' },
	fr: { empty: 'Vide', many_seats: 'Places assises', few_seats: 'Peu de sièges', standing: 'Debout', full: 'Plein' },
};

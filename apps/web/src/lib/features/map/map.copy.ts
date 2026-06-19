// Co-located copy for the live map hero (Family A, slice-9.3).
//
// Intrinsic bilingual vocabulary. STATUS_LABELS / OCCUPANCY_LABELS mirror the
// network surface's band labels; kept local to keep the feature self-contained
// (a shared transit-vocab module is a beautification-pass follow-up).

import type { Locale } from '$lib/i18n';
import type { StatusCode, OccupancyCode } from '$lib/v1';

export interface MapCopy {
	/** Mono overline above the map title. */
	readonly kicker: string;
	readonly heading: string;
	/** Accessible name for the map region. */
	readonly mapLabel: string;
	/** Statut|Crowding toggle. */
	readonly modeStatus: string;
	readonly modeOccupancy: string;
	readonly modeAlerts: string;
	readonly modeRoutes: string;
	readonly modeStops: string;
	readonly modeVehicles: string;
	readonly modeTrips: string;
	readonly modeAria: string;
	/** "Arrêts près de moi" button. */
	readonly nearMe: string;
	readonly nearMeUseLocation: string;
	readonly nearMeSearchPlaceholder: string;
	readonly nearMeSearchSubmit: string;
	readonly nearMeClear: string;
	readonly nearMeLoading: string;
	readonly nearMeNoResults: string;
	readonly nearMeError: string;
	/** Geolocation failure modes — distinct, actionable copy per error code. */
	readonly nearMeGeoDenied: string;
	readonly nearMeGeoTimeout: string;
	readonly nearMeGeoUnavailable: string;
	readonly nearMeGeoInsecure: string;
	/** No-data occupancy legend row. */
	readonly noData: string;
	/** Entity legend labels — the SHAPE key (shape encodes entity + direction). */
	readonly entityBusDirection: string;
	readonly entityBusNoDirection: string;
	readonly entityStop: string;
	/** Label for the marker/entity filter. */
	readonly legendTitle: string;
	readonly entityFilterTitle: string;
	/** Filter panel. */
	readonly filterTitle: string;
	readonly filterClear: string;
	readonly filterClose: string;
	readonly routeRemove: string;
	readonly vehicleLabel: string;
	readonly stopLabel: string;
	readonly tripLabel: string;
	readonly vehicleRemove: string;
	readonly stopRemove: string;
	readonly tripRemove: string;
	readonly alertHas: string;
	readonly alertHasAria: string;
}

export const copy: Record<Locale, MapCopy> = {
	en: {
		kicker: 'NETWORK · LIVE',
		heading: 'Live map',
		mapLabel: 'Live transit map of Montréal — buses coloured by status',
		modeStatus: 'Status',
		modeOccupancy: 'Crowding',
		modeAlerts: 'Alerts',
		modeRoutes: 'Routes',
		modeStops: 'Stops',
		modeVehicles: 'Buses',
		modeTrips: 'Trips',
		modeAria: 'Colour buses by',
		nearMe: 'Stops near me',
		nearMeUseLocation: 'Use my location',
		nearMeSearchPlaceholder: 'Address, postal code, or coordinates',
		nearMeSearchSubmit: 'Find',
		nearMeClear: 'Clear location',
		nearMeLoading: 'Finding stops...',
		nearMeNoResults: 'No nearby stops',
		nearMeError: 'Could not find that place',
		nearMeGeoDenied: 'Location permission denied',
		nearMeGeoTimeout: 'Location timed out — try again',
		nearMeGeoUnavailable: 'Location unavailable',
		nearMeGeoInsecure: 'Location needs a secure (https) connection',
		noData: 'No data',
		entityBusDirection: 'Bus - direction',
		entityBusNoDirection: 'Bus - no direction',
		entityStop: 'Stop',
		legendTitle: 'Markers',
		entityFilterTitle: 'Filter map markers',
		filterTitle: 'Filter',
		filterClear: 'Clear',
		filterClose: 'Close filters',
		routeRemove: 'Remove route',
		vehicleLabel: 'Bus',
		stopLabel: 'Stop',
		tripLabel: 'Trip',
		vehicleRemove: 'Remove bus',
		stopRemove: 'Remove stop',
		tripRemove: 'Remove trip',
		alertHas: 'Has alert',
		alertHasAria: 'Show markers with alerts',
	},
	fr: {
		kicker: 'RÉSEAU · EN DIRECT',
		heading: 'Carte en direct',
		mapLabel: 'Carte en direct du réseau de Montréal — bus colorés par statut',
		modeStatus: 'Statut',
		modeOccupancy: 'Achalandage',
		modeAlerts: 'Alertes',
		modeRoutes: 'Lignes',
		modeStops: 'Arrêts',
		modeVehicles: 'Bus',
		modeTrips: 'Trajets',
		modeAria: 'Colorer les bus par',
		nearMe: 'Arrêts près de moi',
		nearMeUseLocation: 'Utiliser ma position',
		nearMeSearchPlaceholder: 'Adresse, code postal ou coordonnées',
		nearMeSearchSubmit: 'Trouver',
		nearMeClear: 'Effacer le lieu',
		nearMeLoading: 'Recherche des arrêts...',
		nearMeNoResults: 'Aucun arrêt proche',
		nearMeError: 'Lieu introuvable',
		nearMeGeoDenied: 'Autorisation de localisation refusée',
		nearMeGeoTimeout: 'Délai de localisation dépassé — réessayez',
		nearMeGeoUnavailable: 'Localisation indisponible',
		nearMeGeoInsecure: 'La localisation requiert une connexion sécurisée (https)',
		noData: 'Aucune donnée',
		entityBusDirection: 'Bus - direction',
		entityBusNoDirection: 'Bus - sans direction',
		entityStop: 'Arrêt',
		legendTitle: 'Marqueurs',
		entityFilterTitle: 'Filtrer les marqueurs de la carte',
		filterTitle: 'Filtrer',
		filterClear: 'Effacer',
		filterClose: 'Fermer les filtres',
		routeRemove: 'Retirer la ligne',
		vehicleLabel: 'Bus',
		stopLabel: 'Arrêt',
		tripLabel: 'Trajet',
		vehicleRemove: 'Retirer le bus',
		stopRemove: "Retirer l'arrêt",
		tripRemove: 'Retirer le trajet',
		alertHas: 'Avec alerte',
		alertHasAria: 'Afficher les marqueurs avec alertes',
	},
};

/** Localized StatusCode labels (status mode legend). */
export const STATUS_LABELS: Record<Locale, Record<StatusCode, string>> = {
	en: { early: 'Early', on_time: 'On-time', late: 'Late', severe: 'Severe', unknown: 'Unknown' },
	fr: {
		early: 'En avance',
		on_time: 'À l’heure',
		late: 'En retard',
		severe: 'Grave',
		unknown: 'Inconnu',
	},
};

/** Localized OccupancyCode labels (crowding mode legend). */
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
		many_seats: 'Places assises',
		few_seats: 'Peu de sièges',
		standing: 'Debout',
		full: 'Plein',
	},
};

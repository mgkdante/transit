// Co-located copy for the live map hero (Family A, slice-9.3).
//
// Surface-level prose only. The StatusCode / OccupancyCode display labels now live
// beside the enums they render, in the shared $lib/v1/enumLabels vocabulary (S7.5
// P3), so the map legend and the network band never drift again.

import type { Locale } from '$lib/i18n';

export interface MapCopy {
	/** Mono overline above the map title. */
	readonly kicker: string;
	readonly heading: string;
	/** Accessible name for the map region. */
	readonly mapLabel: string;
	/** Accessible name for the floating selection-detail panel (dialog region). */
	readonly detailPanelLabel: string;
	/** Accessible name for the detail panel's drag-to-resize handle (separator). */
	readonly detailResizeLabel: string;
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
	/** Entity legend labels — the SHAPE key (one marker per entity type). */
	readonly entityBus: string;
	readonly entityStop: string;
	/** Label for the marker/entity filter. */
	readonly legendTitle: string;
	readonly entityFilterTitle: string;
	/** Filter panel. */
	readonly filterTitle: string;
	/**
	 * Filter-panel title when the panel doubles as the mobile controls sheet
	 * (motion toggle pinned to the top alongside the filters).
	 */
	readonly controlsTitle: string;
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
	/**
	 * Live-feed edge states. Non-blocking notices that float over the map (the
	 * basemap, stops, and near-me stay usable); they never wrap or blank the
	 * canvas. `liveUnavailable` shows when the live feed cannot be reached at all
	 * (no successful build yet + an error); `liveNoVehicles` shows when the feed
	 * loaded fine but currently reports zero vehicles to plot.
	 */
	readonly liveUnavailable: string;
	readonly liveNoVehicles: string;
	/**
	 * Top-of-map banner shown ONLY when the WHOLE live feed has genuinely stalled
	 * (live.isStale — age past the 3x-ttl budget). The per-vehicle updated_utc is
	 * the uniform snapshot capture time, so this can only express a global feed
	 * stall, never one stuck bus. Calm caution, not alarm: it states a fact and
	 * the rest of the map (basemap, stops, near-me) stays usable. The relative
	 * last-update age slots in per-locale. Em-dash-free (repo doctrine).
	 */
	readonly feedNotResponding: (age: string) => string;
	/**
	 * Motion-mode control — the honest "how do we draw moving buses?" switch bound
	 * to the motionMode store. A real role="switch": OFF = RAW (the default, buses
	 * snap to their last reported position on every ~30s feed, no estimation), ON =
	 * SMOOTH ("almost real-time", buses glide forward along their route at their
	 * last reported speed between feeds — an approximation, not a measurement). The
	 * inline hint names which truth you are looking at; the link deep-dives into the
	 * /metrics explainer.
	 */
	readonly motion: {
		/** Visible control label (mono control voice). */
		readonly label: string;
		/** ON-state name — the smooth/estimated mode. */
		readonly smooth: string;
		/** OFF-state name — the raw/measured mode. */
		readonly raw: string;
		/** aria-label when SMOOTH is active (the action a press performs: go to raw). */
		readonly toRaw: string;
		/** aria-label when RAW is active (the action a press performs: go to smooth). */
		readonly toSmooth: string;
		/** Inline hint shown under the label while SMOOTH is active. */
		readonly hintSmooth: string;
		/** Inline hint shown under the label while RAW is active. */
		readonly hintRaw: string;
		/** "How this works" deep-link text → the /metrics live-positions explainer. */
		readonly explain: string;
	};
}

export const copy: Record<Locale, MapCopy> = {
	en: {
		kicker: 'NETWORK · LIVE',
		heading: 'Live map',
		mapLabel: 'Live transit map of Montréal, buses coloured by status',
		detailPanelLabel: 'Selection details',
		detailResizeLabel: 'Resize details panel',
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
		nearMeGeoTimeout: 'Location timed out. Try again',
		nearMeGeoUnavailable: 'Location unavailable',
		nearMeGeoInsecure: 'Location needs a secure (https) connection',
		noData: 'No data',
		entityBus: 'Bus',
		entityStop: 'Stop',
		legendTitle: 'Markers',
		entityFilterTitle: 'Filter map markers',
		filterTitle: 'Filter',
		controlsTitle: 'Controls',
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
		liveUnavailable: 'Live data unavailable right now. The map and stops still work.',
		liveNoVehicles: 'No vehicles to show right now.',
		feedNotResponding: (age) => `Live feed not responding. Last update ${age}.`,
		motion: {
			label: 'Motion',
			smooth: 'Almost real-time',
			raw: 'Raw',
			toRaw: 'Switch to raw positions (measured only, no estimation)',
			toSmooth: 'Switch to almost real-time (estimated motion between reports)',
			hintSmooth: 'Estimated motion between reports',
			hintRaw: 'Measured positions only',
			explain: 'How this works',
		},
	},
	fr: {
		kicker: 'RÉSEAU · EN DIRECT',
		heading: 'Carte en direct',
		mapLabel: 'Carte en direct du réseau de Montréal, bus colorés par statut',
		detailPanelLabel: 'Détails de la sélection',
		detailResizeLabel: 'Redimensionner le panneau de détails',
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
		nearMeGeoTimeout: 'Délai de localisation dépassé. Réessayez',
		nearMeGeoUnavailable: 'Localisation indisponible',
		nearMeGeoInsecure: 'La localisation requiert une connexion sécurisée (https)',
		noData: 'Aucune donnée',
		entityBus: 'Bus',
		entityStop: 'Arrêt',
		legendTitle: 'Marqueurs',
		entityFilterTitle: 'Filtrer les marqueurs de la carte',
		filterTitle: 'Filtrer',
		controlsTitle: 'Contrôles',
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
		liveUnavailable:
			'Données en direct indisponibles pour l’instant. La carte et les arrêts fonctionnent toujours.',
		liveNoVehicles: 'Aucun véhicule à afficher pour l’instant.',
		feedNotResponding: (age) => `Le flux en direct ne répond pas. Dernière mise à jour ${age}.`,
		motion: {
			label: 'Mouvement',
			smooth: 'Presque en temps réel',
			raw: 'Brut',
			toRaw: 'Passer aux positions brutes (mesurées seulement, sans estimation)',
			toSmooth: 'Passer au presque en temps réel (mouvement estimé entre les relevés)',
			hintSmooth: 'Mouvement estimé entre les relevés',
			hintRaw: 'Positions mesurées seulement',
			explain: 'Comment ça marche',
		},
	},
};

// lines.copy.ts — co-located bilingual copy for the Lines surface (slice-9.3).
//
// The Lines index + the route detail screen own their non-intrinsic, user-facing
// strings here so the .svelte stays markup-only (domain-intrinsic component
// labels — OTP / delay / p90 / severe — already live in the spine's
// ReliabilityPane). FR is the canonical product voice; EN mirrors it.

import type { Locale } from '$lib/i18n';
import type { AffectedAlertsCopy, SurfaceHeadCopy } from '$lib/components/surface';
import type { OccupancyCode } from '$lib/v1/schemas';

export interface LinesIndexCopy extends SurfaceHeadCopy {
	/** Accessible label + placeholder for the filter input. */
	readonly filterLabel: string;
	readonly filterPlaceholder: string;
	/** Mono group overline for the ControlsRail collecting search + sort + status. */
	readonly controlsLabel: string;
	/** Compact action linking one route into the live map. */
	readonly mapAction: string;
	readonly viewRouteOnMap: (route: string) => string;
	/** "+N more" truncation note builder (count interpolated). */
	readonly more: (n: number) => string;
	/** Sort control (alphabetical | worst reliability first). */
	readonly sortLabel: string;
	readonly sortAlpha: string;
	readonly sortWorst: string;
	/** Reliability status filter (show only problem lines). */
	readonly statusFilterLabel: string;
	readonly statusAll: string;
	readonly statusProblem: string;
	/** SR caption when the problem filter is on but no line has loaded its verdict yet. */
	readonly statusPending: string;
}

export interface RouteDetailCopy {
	/** Station-voice overline above the line heading. */
	readonly kicker: string;
	/** Back-link label into the lines index ("← Lines"), keeps nav in-chrome. */
	readonly back: string;
	/** Framing lede under the line id in the detail head (detail-head rhythm). */
	readonly detailLede: string;
	/** Tab labels, keyed by the EntityDetail tab key. */
	readonly tabs: {
		readonly detail: string;
		readonly schedule: string;
		readonly reliability: string;
	};
	/** Live-map drilldown action. */
	readonly viewOnMap: string;
	readonly viewRouteOnMap: (route: string) => string;
	/**
	 * Live service alerts affecting THIS route (alerts whose routes[] lists this
	 * route id). Surfaced in the detail pane; stands down when none are active.
	 */
	readonly alerts: AffectedAlertsCopy;
	/** Section headings inside the panes. */
	readonly directions: string;
	readonly servicePeriods: string;
	readonly headways: string;
	readonly weakStops: string;
	/** Plain-language intro atop the Schedule tab — says what the schedule shows + where to find reliability. */
	readonly scheduleIntro: string;
	/** Direction-row helpers. */
	readonly direction: (dir: number) => string;
	readonly stopsCount: (n: number) => string;
	/** Service-period field captions. */
	readonly window: string;
	readonly headway: string;
	readonly firstDeparture: string;
	readonly lastDeparture: string;
	/** Headway field captions. */
	readonly scheduled: string;
	readonly observed: string;
	readonly excessWait: string;
	/** Tier-2 headway-regularity captions (busiest-direction rows). */
	readonly regularityCov: string;
	readonly bunched: string;
	/** Weak-stop caption (observation-weighted mean delay). */
	readonly avgDelay: string;
	/** Tier-1/2 historic metric sections. */
	readonly cancellations: string;
	readonly cancellationRate: string;
	readonly skippedStops: string;
	readonly skippedStopRate: string;
	readonly crowding: string;
	/** Occupancy band labels (legend + a11y) keyed by OccupancyCode. */
	readonly occupancyBands: Record<OccupancyCode, string>;
	readonly serviceSpan: string;
	readonly spanMinutes: string;
	readonly firstTripDelay: string;
	readonly lastTripDelay: string;
	/** a11y trend summary builder: "… over the last N days". */
	readonly lastNDays: (n: number) => string;
	/**
	 * Current-buses roster (the live vehicles running THIS route right now). Stands
	 * down entirely when no live vehicle is on the route (metro, or a feed gap).
	 */
	readonly roster: {
		/** Section heading. */
		readonly heading: string;
		/** a11y label for the roster list. */
		readonly listLabel: string;
		/** Bus row title builder (vehicle id/label). */
		readonly busLabel: (id: string) => string;
		/** Next-stop subtitle builder; shown only when the vehicle reports one. */
		readonly nextStop: (stop: string) => string;
		/** Accessible label for the per-bus trip link. */
		readonly viewTrip: (id: string) => string;
		/** Accessible label for the per-bus map drilldown. */
		readonly viewBusOnMap: (id: string) => string;
		/** Compact "map" pill text. */
		readonly mapAction: string;
		/** Count caption ("N buses running"). */
		readonly count: (n: number) => string;
		/** Honest unknown when the feed omits a bus's delay (never rendered as 0). */
		readonly noData: string;
	};
	/** Detail-tab live per-stop readout (derived from the live trips on this route). */
	readonly noLiveBus: string;
	/** Shown when a bus is heading to this stop but the feed gave no precise ETA. */
	readonly approaching: string;
	readonly viewStop: (stop: string) => string;
	/** Delay-tone labels reused for the approaching bus's on-time status. */
	readonly early: (minutes: number) => string;
	readonly late: (minutes: number) => string;
	readonly onTime: string;
	readonly noDelay: string;
	/** Short value-level no-data label for an absent metric tile. */
	readonly noData: string;
}

export const indexCopy: Record<Locale, LinesIndexCopy> = {
	fr: {
		kicker: 'LIGNES · RÉSEAU',
		heading: 'Lignes',
		lede: 'Toutes les lignes du réseau, détail du parcours, horaire et fiabilité historique par ligne. Mesuré à partir du contrat /v1.',
		filterLabel: 'Filtrer les lignes',
		filterPlaceholder: 'Numéro ou nom de ligne…',
		controlsLabel: 'Contrôles',
		mapAction: 'Carte',
		viewRouteOnMap: (route) => `Voir la ligne ${route} sur la carte`,
		more: (n) => `+${n} de plus`,
		sortLabel: 'Trier',
		sortAlpha: 'Alphabétique',
		sortWorst: 'Moins fiables',
		statusFilterLabel: 'Fiabilité',
		statusAll: 'Toutes',
		statusProblem: 'En retard',
		statusPending: 'Chargement de la fiabilité des lignes visibles…',
	},
	en: {
		kicker: 'LINES · NETWORK',
		heading: 'Lines',
		lede: 'Every line on the network, per-line route detail, schedule and historic reliability. Measured from the /v1 contract.',
		filterLabel: 'Filter lines',
		filterPlaceholder: 'Line number or name…',
		controlsLabel: 'Controls',
		mapAction: 'Map',
		viewRouteOnMap: (route) => `View route ${route} on map`,
		more: (n) => `+${n} more`,
		sortLabel: 'Sort',
		sortAlpha: 'Alphabetical',
		sortWorst: 'Least reliable',
		statusFilterLabel: 'Reliability',
		statusAll: 'All',
		statusProblem: 'Late',
		statusPending: 'Loading reliability for the visible lines…',
	},
};

export const detailCopy: Record<Locale, RouteDetailCopy> = {
	fr: {
		kicker: 'LIGNE',
		back: 'Lignes',
		detailLede:
			'Parcours en direct, horaire prévu et fiabilité historique de cette ligne. Mesuré à partir du contrat /v1.',
		tabs: { detail: 'Détail', schedule: 'Horaire', reliability: 'Fiabilité' },
		viewOnMap: 'Voir sur la carte',
		viewRouteOnMap: (route) => `Voir la ligne ${route} sur la carte`,
		alerts: {
			heading: 'Avis de service',
			listLabel: 'Avis de service touchant cette ligne',
			cause: 'Cause',
			effect: 'Effet',
			from: 'À partir de',
			until: 'Jusqu’à',
			severity: { critical: 'Critique', high: 'Élevé', watch: 'À surveiller' },
			more: (n) => `+${n} de plus`,
			showLess: 'Réduire',
		},
		directions: 'Directions',
		servicePeriods: 'Périodes de service',
		headways: 'Intervalles',
		scheduleIntro:
			'Les horaires prévus de cette ligne : le premier et le dernier départ, puis l’intervalle prévu entre les bus pour chaque période de la journée. C’est l’offre PLANIFIÉE. Pour la ponctualité réelle, voyez l’onglet « Fiabilité ».',
		weakStops: 'Arrêts les plus faibles',
		direction: (dir) => `Direction ${dir}`,
		stopsCount: (n) => (n === 1 ? '1 arrêt' : `${n} arrêts`),
		window: 'Plage',
		headway: 'Intervalle',
		firstDeparture: 'Premier départ',
		lastDeparture: 'Dernier départ',
		scheduled: 'Prévu',
		observed: 'Observé',
		excessWait: 'Attente excédentaire',
		regularityCov: 'Régularité (CV)',
		bunched: 'Regroupé',
		avgDelay: 'Retard moyen',
		cancellations: 'Annulations',
		cancellationRate: "Taux d'annulation (30 j)",
		skippedStops: 'Arrêts ignorés',
		skippedStopRate: "Taux d'arrêts ignorés (30 j)",
		crowding: 'Encombrement',
		occupancyBands: {
			empty: 'Vide',
			many_seats: 'Plusieurs places',
			few_seats: 'Peu de places',
			standing: 'Debout',
			full: 'Plein',
		},
		serviceSpan: 'Plage de service',
		spanMinutes: 'Durée (min)',
		firstTripDelay: 'Retard 1er trajet',
		lastTripDelay: 'Retard dernier trajet',
		lastNDays: (n) => `sur les ${n} derniers jours`,
		roster: {
			heading: 'Bus en service',
			listLabel: 'Bus en service sur cette ligne',
			busLabel: (id) => `Bus ${id}`,
			nextStop: (stop) => `Prochain arrêt ${stop}`,
			viewTrip: (id) => `Voir le trajet du bus ${id}`,
			viewBusOnMap: (id) => `Voir le bus ${id} sur la carte`,
			mapAction: 'Carte',
			count: (n) => (n === 1 ? '1 bus en service' : `${n} bus en service`),
			noData: 'Aucune donnée',
		},
		noLiveBus: 'Aucun bus en direct',
		approaching: 'À l’approche',
		viewStop: (stop) => `Voir l’arrêt ${stop}`,
		early: (minutes) => `${Math.abs(minutes)} min en avance`,
		late: (minutes) => `${minutes} min en retard`,
		onTime: "À l'heure",
		noDelay: 'Aucun retard',
		noData: 'sans données',
	},
	en: {
		kicker: 'LINE',
		back: 'Lines',
		detailLede:
			'Live route, planned schedule and historic reliability for this line. Measured from the /v1 contract.',
		tabs: { detail: 'Detail', schedule: 'Schedule', reliability: 'Reliability' },
		viewOnMap: 'View on map',
		viewRouteOnMap: (route) => `View route ${route} on map`,
		alerts: {
			heading: 'Service alerts',
			listLabel: 'Service alerts affecting this line',
			cause: 'Cause',
			effect: 'Effect',
			from: 'From',
			until: 'Until',
			severity: { critical: 'Critical', high: 'High', watch: 'Watch' },
			more: (n) => `+${n} more`,
			showLess: 'Show less',
		},
		directions: 'Directions',
		servicePeriods: 'Service periods',
		headways: 'Headways',
		scheduleIntro:
			'This line’s planned schedule: the first and last departure, then the planned time between buses for each period of the day. This is the PLANNED service. For real-world punctuality, see the “Reliability” tab.',
		weakStops: 'Weakest stops',
		direction: (dir) => `Direction ${dir}`,
		stopsCount: (n) => (n === 1 ? '1 stop' : `${n} stops`),
		window: 'Window',
		headway: 'Time between buses',
		firstDeparture: 'First departure',
		lastDeparture: 'Last departure',
		scheduled: 'Scheduled',
		observed: 'Observed',
		excessWait: 'Excess wait',
		regularityCov: 'Regularity (CoV)',
		bunched: 'Bunched',
		avgDelay: 'Avg delay',
		cancellations: 'Cancellations',
		cancellationRate: 'Cancellation rate (30d)',
		skippedStops: 'Skipped stops',
		skippedStopRate: 'Skipped-stop rate (30d)',
		crowding: 'Crowding',
		occupancyBands: {
			empty: 'Empty',
			many_seats: 'Many seats',
			few_seats: 'Few seats',
			standing: 'Standing',
			full: 'Full',
		},
		serviceSpan: 'Service span',
		spanMinutes: 'Span (min)',
		firstTripDelay: 'First-trip delay',
		lastTripDelay: 'Last-trip delay',
		lastNDays: (n) => `over the last ${n} days`,
		roster: {
			heading: 'Buses in service',
			listLabel: 'Buses currently running this line',
			busLabel: (id) => `Bus ${id}`,
			nextStop: (stop) => `Next stop ${stop}`,
			viewTrip: (id) => `View the trip for bus ${id}`,
			viewBusOnMap: (id) => `View bus ${id} on map`,
			mapAction: 'Map',
			count: (n) => (n === 1 ? '1 bus in service' : `${n} buses in service`),
			noData: 'No data',
		},
		noLiveBus: 'No live bus',
		approaching: 'Approaching',
		viewStop: (stop) => `View stop ${stop}`,
		early: (minutes) => `${Math.abs(minutes)} min early`,
		late: (minutes) => `${minutes} min late`,
		onTime: 'On time',
		noDelay: 'No delay',
		noData: 'no data',
	},
};

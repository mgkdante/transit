// lines.copy.ts — co-located bilingual copy for the Lines surface (slice-9.3).
//
// The Lines index + the route detail screen own their non-intrinsic, user-facing
// strings here so the .svelte stays markup-only (domain-intrinsic component
// labels — OTP / delay / p90 / severe — already live in the spine's
// ReliabilityPane). FR is the canonical product voice; EN mirrors it.

import type { Locale } from '$lib/i18n';

export interface LinesIndexCopy {
	/** Station-voice overline above the index heading. */
	readonly kicker: string;
	/** Index display heading. */
	readonly heading: string;
	/** Muted lede paragraph under the heading. */
	readonly lede: string;
	/** Accessible label + placeholder for the filter input. */
	readonly filterLabel: string;
	readonly filterPlaceholder: string;
	/** Compact action linking one route into the live map. */
	readonly mapAction: string;
	readonly viewRouteOnMap: (route: string) => string;
	/** "+N more" truncation note builder (count interpolated). */
	readonly more: (n: number) => string;
}

export interface RouteDetailCopy {
	/** Station-voice overline above the line heading. */
	readonly kicker: string;
	/** Tab labels, keyed by the EntityDetail tab key. */
	readonly tabs: {
		readonly detail: string;
		readonly schedule: string;
		readonly reliability: string;
	};
	/** Live-map drilldown action. */
	readonly viewOnMap: string;
	readonly viewRouteOnMap: (route: string) => string;
	/** Section headings inside the panes. */
	readonly directions: string;
	readonly servicePeriods: string;
	readonly headways: string;
	readonly weakStops: string;
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
	/** Weak-stop caption. */
	readonly medianDelay: string;
}

export const indexCopy: Record<Locale, LinesIndexCopy> = {
	fr: {
		kicker: 'LIGNES · RÉSEAU',
		heading: 'Lignes',
		lede: 'Toutes les lignes du réseau — détail du parcours, horaire et fiabilité historique par ligne. Mesuré à partir du contrat /v1.',
		filterLabel: 'Filtrer les lignes',
		filterPlaceholder: 'Numéro ou nom de ligne…',
		mapAction: 'Carte',
		viewRouteOnMap: (route) => `Voir la ligne ${route} sur la carte`,
		more: (n) => `+${n} de plus`,
	},
	en: {
		kicker: 'LINES · NETWORK',
		heading: 'Lines',
		lede: 'Every line on the network — per-line route detail, schedule and historic reliability. Measured from the /v1 contract.',
		filterLabel: 'Filter lines',
		filterPlaceholder: 'Line number or name…',
		mapAction: 'Map',
		viewRouteOnMap: (route) => `View route ${route} on map`,
		more: (n) => `+${n} more`,
	},
};

export const detailCopy: Record<Locale, RouteDetailCopy> = {
	fr: {
		kicker: 'LIGNE',
		tabs: { detail: 'Détail', schedule: 'Horaire', reliability: 'Fiabilité' },
		viewOnMap: 'Voir sur la carte',
		viewRouteOnMap: (route) => `Voir la ligne ${route} sur la carte`,
		directions: 'Directions',
		servicePeriods: 'Périodes de service',
		headways: 'Intervalles',
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
		medianDelay: 'Retard médian',
	},
	en: {
		kicker: 'LINE',
		tabs: { detail: 'Detail', schedule: 'Schedule', reliability: 'Reliability' },
		viewOnMap: 'View on map',
		viewRouteOnMap: (route) => `View route ${route} on map`,
		directions: 'Directions',
		servicePeriods: 'Service periods',
		headways: 'Headways',
		weakStops: 'Weakest stops',
		direction: (dir) => `Direction ${dir}`,
		stopsCount: (n) => (n === 1 ? '1 stop' : `${n} stops`),
		window: 'Window',
		headway: 'Headway',
		firstDeparture: 'First departure',
		lastDeparture: 'Last departure',
		scheduled: 'Scheduled',
		observed: 'Observed',
		excessWait: 'Excess wait',
		medianDelay: 'Median delay',
	},
};

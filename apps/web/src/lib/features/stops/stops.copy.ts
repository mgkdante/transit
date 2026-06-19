// stops.copy.ts — co-located bilingual copy for the Stops surface (slice-9.3).
//
// All user-facing strings the StopsIndex + StopDetail screens render live here,
// keyed by Locale, so the .svelte files carry zero inline copy. Domain-intrinsic
// labels (OTP / delay / "LIVE" / tab vocabulary inside the spine primitives)
// already live in those primitives and are NOT duplicated here.

import type { Locale } from '$lib/i18n';
import type { SurfaceHeadCopy } from '$lib/components/surface';

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
	};
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
			byRoute: 'Retard médian par ligne',
			noRouteBreakdown: 'Aucun détail par ligne pour cet arrêt.',
		},
	},
	en: {
		kicker: 'STOP',
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
			byRoute: 'Median delay by route',
			noRouteBreakdown: 'No per-route breakdown for this stop.',
		},
	},
};

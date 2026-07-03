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
	/** Mono group overline for the ControlsRail collecting search + line filter + sort. */
	readonly controlsLabel: string;
	/** By-line filter: label / placeholder / clear + empty-listbox copy for the combobox. */
	readonly lineLabel: string;
	readonly linePlaceholder: string;
	readonly lineClear: string;
	readonly lineEmpty: string;
	/** Heading over the stops-on-a-line result list ("Stops on line {short}"). */
	readonly onLineHeading: (short: string) => string;
	/** Honest note when a picked line has no published stop list. */
	readonly noLineStops: string;
	/** Direction group heading inside a line's stop list. */
	readonly direction: (dir: number) => string;
	/** Reliability sort control (published order | worst reliability first). */
	readonly sortLabel: string;
	readonly sortDefault: string;
	readonly sortWorst: string;
}

export interface StopDetailCopy {
	/** Station-voice kicker (EntityDetail). */
	readonly kicker: string;
	/** Back-link label into the stops index ("← Stops"), keeps nav in-chrome. */
	readonly back: string;
	/** Framing lede under the stop name in the detail head (detail-head rhythm). */
	readonly detailLede: string;
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
		/** D3: the TerminalPanel framing the live departures board. */
		readonly terminal: { readonly title: string; readonly tag: string };
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
	// The "Reliability" pane copy now lives in stops-reliability.copy.ts (S8A re-seat):
	// <StopReliabilitySurface> + its section components read that bundle, so StopDetail
	// keeps only the tabs/next/schedule/info/alerts copy here.
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
		controlsLabel: 'Contrôles',
		lineLabel: 'Filtrer par ligne',
		linePlaceholder: 'Numéro ou nom de ligne…',
		lineClear: 'Effacer le filtre de ligne',
		lineEmpty: 'Aucune ligne ne correspond.',
		onLineHeading: (short) => `Arrêts de la ligne ${short}`,
		noLineStops: 'Aucune liste d’arrêts publiée pour cette ligne.',
		direction: (dir) => `Direction ${dir}`,
		sortLabel: 'Trier',
		sortDefault: 'Ordre du parcours',
		sortWorst: 'Moins fiables',
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
		controlsLabel: 'Controls',
		lineLabel: 'Filter by line',
		linePlaceholder: 'Line number or name…',
		lineClear: 'Clear line filter',
		lineEmpty: 'No lines match.',
		onLineHeading: (short) => `Stops on line ${short}`,
		noLineStops: 'No published stop list for this line.',
		direction: (dir) => `Direction ${dir}`,
		sortLabel: 'Sort',
		sortDefault: 'Route order',
		sortWorst: 'Least reliable',
	},
};

export const detailCopy: Record<Locale, StopDetailCopy> = {
	fr: {
		kicker: 'ARRÊT',
		back: 'Arrêts',
		detailLede:
			'Prochains passages en direct, horaire prévu et fiabilité historique de cet arrêt. Mesuré à partir du contrat /v1.',
		viewOnMap: 'Voir sur la carte',
		viewStopOnMap: (stop) => `Voir l’arrêt ${stop} sur la carte`,
		tabs: { next: 'Prochains', schedule: 'Horaire', info: 'Info', reliability: 'Fiabilité' },
		next: {
			terminal: { title: 'passages-en-direct', tag: 'EN DIRECT' },
			heading: 'Prochains passages',
			none: 'Aucun passage à venir pour le moment.',
			late: (min) => `+${min} min de retard`,
			early: (min) => `${Math.abs(min)} min d’avance`,
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
	},
	en: {
		kicker: 'STOP',
		back: 'Stops',
		detailLede:
			'Live next departures, planned schedule and historic reliability for this stop. Measured from the /v1 contract.',
		viewOnMap: 'View on map',
		viewStopOnMap: (stop) => `View stop ${stop} on map`,
		tabs: { next: 'Next', schedule: 'Schedule', info: 'Info', reliability: 'Reliability' },
		next: {
			terminal: { title: 'live-departures', tag: 'LIVE' },
			heading: 'Next departures',
			none: 'No upcoming departures right now.',
			late: (min) => `+${min} min late`,
			early: (min) => `${Math.abs(min)} min early`,
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
	},
};

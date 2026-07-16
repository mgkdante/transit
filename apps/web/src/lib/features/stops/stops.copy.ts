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
	readonly direction: (dir: number, headsign?: string | null) => string;
	/** Reliability sort control (published order | worst reliability first). */
	readonly sortLabel: string;
	readonly sortDefault: string;
	readonly sortWorst: string;
	/** Polite status while every eligible stop is measured before ranking once. */
	readonly rankingPending: string;
	readonly inventory: {
		readonly label: string;
		readonly stops: string;
		readonly bus: string;
		readonly metro: string;
		readonly lines: string;
		readonly unavailable: string;
	};
	readonly browse: {
		readonly heading: string;
		readonly lede: string;
		readonly chooseLine: (short: string, long?: string | null) => string;
		readonly showMoreLines: (n: number) => string;
		readonly progressLabel: string;
		readonly progress: (shown: number, total: number) => string;
		readonly loadMore: (n: number) => string;
	};
}

export interface StopDetailCopy {
	/** Station-voice kicker (EntityDetail). */
	readonly kicker: string;
	/** Back-link label into the stops index, keeps nav in-chrome. */
	readonly back: string;
	/** Article-cover labels. Every value rendered beside them comes from /v1. */
	readonly article: {
		readonly watermark: string;
		readonly tagsAria: string;
		readonly stopId: string;
		readonly provider: string;
		readonly updated: string;
	};
	/** Live-map drilldown action. */
	readonly viewOnMap: string;
	readonly viewStopOnMap: (stop: string) => string;
	/** Tab labels, keyed by tab key. */
	readonly tabs: {
		readonly detail: string;
		readonly schedule: string;
		readonly reliability: string;
	};
	/** The one collapsible, nonessential card inside Detail. */
	readonly detailCard: {
		readonly title: string;
		readonly summary: string;
	};
	/** "Next departures" pane. */
	readonly next: {
		/** Legacy terminal labels retained for saved copy compatibility. */
		readonly terminal: { readonly title: string; readonly tag: string };
		/** Section label over the departures list. */
		readonly heading: string;
		/** Shown when the live board has no upcoming departures for this stop. */
		readonly none: string;
		/** Delay caption, including an explicit unknown state when realtime is absent. */
		readonly late: (min: number) => string;
		readonly early: (min: number) => string;
		readonly onTime: string;
		readonly noDelay: string;
		/** Fallback label when a departure has no route code. */
		readonly route: string;
		readonly table: {
			readonly caption: string;
			readonly route: string;
			readonly departure: string;
			readonly status: string;
		};
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
	 * stop, or whose routes[] serve it). Surfaced in the Detail card; stands down
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
		readonly table: {
			readonly caption: string;
			readonly route: string;
			readonly destination: string;
			readonly departures: string;
		};
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
		noMatches: 'Aucun arrêt ne correspond à cette recherche.',
		more: (n) => `+${n} autres arrêts, affinez la recherche`,
		mapAction: 'Carte',
		viewStopOnMap: (stop) => `Voir l’arrêt ${stop} sur la carte`,
		controlsLabel: 'Filtres',
		lineLabel: 'Filtrer par ligne',
		linePlaceholder: 'Numéro ou nom de ligne…',
		lineClear: 'Effacer le filtre de ligne',
		lineEmpty: 'Aucune ligne ne correspond.',
		onLineHeading: (short) => `Arrêts de la ligne ${short}`,
		noLineStops: 'Aucune liste d’arrêts publiée pour cette ligne.',
		direction: (dir, headsign) =>
			headsign ? `Direction ${dir} · ${headsign}` : `Direction ${dir}`,
		sortLabel: 'Trier',
		sortDefault: 'Ordre du parcours',
		sortWorst: 'Moins fiables',
		rankingPending: 'Calcul du classement de fiabilité des arrêts filtrés…',
		inventory: {
			label: 'Inventaire du réseau',
			stops: 'Arrêts',
			bus: 'Bus',
			metro: 'Métro',
			lines: 'Lignes',
			unavailable: 'Indisponible',
		},
		browse: {
			heading: 'Parcourir les arrêts par ligne',
			lede: 'Choisissez une ligne pour voir tous ses arrêts publiés, regroupés par direction.',
			chooseLine: (short, long) => `Voir les arrêts de la ligne ${short}${long ? ` ${long}` : ''}`,
			showMoreLines: (n) => `Afficher ${n} autres lignes`,
			progressLabel: 'Progression du catalogue des arrêts',
			progress: (shown, total) => `${shown} arrêts sur ${total} affichés`,
			loadMore: (n) => `Afficher ${n} autres arrêts`,
		},
	},
	en: {
		kicker: 'STOPS · CATALOGUE',
		heading: 'Stops',
		subheading: '// SEARCH',
		lede: 'Search a stop by name or code to see its next departures and reliability. We never invent data.',
		searchPlaceholder: 'Stop name or code…',
		searchLabel: 'Search stops',
		noMatches: 'No stops match this search.',
		more: (n) => `+${n} more stops, refine the search`,
		mapAction: 'Map',
		viewStopOnMap: (stop) => `View stop ${stop} on map`,
		controlsLabel: 'Filters',
		lineLabel: 'Filter by line',
		linePlaceholder: 'Line number or name…',
		lineClear: 'Clear line filter',
		lineEmpty: 'No lines match.',
		onLineHeading: (short) => `Stops on line ${short}`,
		noLineStops: 'No published stop list for this line.',
		direction: (dir, headsign) =>
			headsign ? `Direction ${dir} · ${headsign}` : `Direction ${dir}`,
		sortLabel: 'Sort',
		sortDefault: 'Route order',
		sortWorst: 'Least reliable',
		rankingPending: 'Calculating reliability ranking for the filtered stops…',
		inventory: {
			label: 'Network inventory',
			stops: 'Stops',
			bus: 'Bus',
			metro: 'Metro',
			lines: 'Lines',
			unavailable: 'Not available',
		},
		browse: {
			heading: 'Browse stops by line',
			lede: 'Choose a line to see every published stop, grouped by direction.',
			chooseLine: (short, long) => `Browse stops on line ${short}${long ? ` ${long}` : ''}`,
			showMoreLines: (n) => `Show ${n} more lines`,
			progressLabel: 'Stop catalogue progress',
			progress: (shown, total) => `Showing ${shown} of ${total} stops`,
			loadMore: (n) => `Load ${n} more stops`,
		},
	},
};

export const detailCopy: Record<Locale, StopDetailCopy> = {
	fr: {
		kicker: 'ARRÊT',
		back: '← Retour aux arrêts',
		article: {
			watermark: 'Arrêt',
			tagsAria: 'Données d’identité de l’arrêt',
			stopId: 'ID arrêt',
			provider: 'Fournisseur',
			updated: 'Mis à jour',
		},
		viewOnMap: 'Voir sur la carte',
		viewStopOnMap: (stop) => `Voir l’arrêt ${stop} sur la carte`,
		tabs: { detail: 'Détail', schedule: 'Horaire', reliability: 'Fiabilité' },
		detailCard: {
			title: 'Informations sur l’arrêt',
			summary: 'Position, accessibilité, lignes desservies et avis de service actifs.',
		},
		next: {
			terminal: { title: 'passages-en-direct', tag: 'EN DIRECT' },
			heading: 'Prochains passages',
			none: 'Aucun passage à venir pour le moment.',
			late: (min) => `+${min} min de retard`,
			early: (min) => `${Math.abs(min)} min d’avance`,
			onTime: 'à l’heure',
			noDelay: 'Temps réel indisponible',
			route: 'Ligne',
			table: {
				caption: 'Prochains passages en direct',
				route: 'Ligne',
				departure: 'Passage',
				status: 'État',
			},
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
			table: {
				caption: 'Horaire prévu par ligne',
				route: 'Ligne',
				destination: 'Destination',
				departures: 'Passages',
			},
			moreTimes: (n) => `+${n} autres passages`,
		},
	},
	en: {
		kicker: 'STOP',
		back: '← Back to stops',
		article: {
			watermark: 'Stop',
			tagsAria: 'Stop identity data',
			stopId: 'Stop ID',
			provider: 'Provider',
			updated: 'Updated',
		},
		viewOnMap: 'View on map',
		viewStopOnMap: (stop) => `View stop ${stop} on map`,
		tabs: { detail: 'Detail', schedule: 'Schedule', reliability: 'Reliability' },
		detailCard: {
			title: 'Stop information',
			summary: 'Position, accessibility, routes served and active service alerts.',
		},
		next: {
			terminal: { title: 'live-departures', tag: 'LIVE' },
			heading: 'Next departures',
			none: 'No upcoming departures right now.',
			late: (min) => `+${min} min late`,
			early: (min) => `${Math.abs(min)} min early`,
			onTime: 'on time',
			noDelay: 'Realtime unavailable',
			route: 'Line',
			table: {
				caption: 'Live next departures',
				route: 'Line',
				departure: 'Departure',
				status: 'Status',
			},
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
			table: {
				caption: 'Scheduled service by line',
				route: 'Line',
				destination: 'Destination',
				departures: 'Departures',
			},
			moreTimes: (n) => `+${n} more times`,
		},
	},
};

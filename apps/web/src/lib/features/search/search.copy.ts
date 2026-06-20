// search.copy.ts — co-located bilingual copy for the Search surface (slice-9.3 ·
// data-depth batch 4).
//
// EVERY user-facing string for SearchSurface lives here, keyed by Locale. The
// domain-intrinsic component labels (edge-state titles/bodies, the "+N more"
// truncation note formatting, the StatusBadge/occupancy glyphs) live in the spine
// + dataviz kit; this object owns the surface-specific voice: the head, the input
// affordance, the section labels, the scope + mode filter controls, the vehicle
// result row phrasing, and the instructional empty state. FR is the canonical
// product voice; EN is the parallel translation. No strings inline in the .svelte.
//
// Provider-agnostic: no 'STM' / 'Montréal' — transit-mode proper nouns (Métro /
// Tram / Bus …) read the same in both languages.

import type { Locale } from '$lib/i18n';
import type { SurfaceHeadCopy } from '$lib/components/surface';

/** The per-vehicle-row intrinsic phrasing (reuses the map's live vocabulary). */
export interface VehicleResultCopy {
	/** Accessible row name, e.g. "Live bus 40061". */
	readonly busAria: (id: string) => string;
	/** "Route N" inline tag. */
	readonly routeTag: (route: string) => string;
	/** "Next: <stop>" subtitle. */
	readonly next: (stop: string) => string;
	readonly noNextStop: string;
	/** Heading-arrow a11y label. */
	readonly heading: string;
	/** No-telemetry crowding label. */
	readonly noCrowding: string;
	/** Signed-delay readings (shared shape with the map). */
	readonly early: (minutes: number) => string;
	readonly late: (minutes: number) => string;
	readonly onTime: string;
	readonly noDelay: string;
}

export interface SearchCopy extends SurfaceHeadCopy {
	/** Accessible label + placeholder for the search input. */
	readonly inputLabel: string;
	readonly inputPlaceholder: string;
	/** Group section headings. */
	readonly linesLabel: string;
	readonly stopsLabel: string;
	readonly vehiclesLabel: string;
	/** Entity-type SCOPE segmented filter (All / Lines / Stops / Vehicles). */
	readonly scopeLabel: string;
	readonly scopeAll: string;
	/** Transit-MODE chip filter group label. */
	readonly modeLabel: string;
	/** Localized mode chip labels (proper nouns; same EN/FR but kept here for a11y). */
	readonly modes: {
		readonly metro: string;
		readonly tram: string;
		readonly bus: string;
		readonly rail: string;
		readonly ferry: string;
	};
	/** Per-scope count caption inside the scope control, e.g. "Lines (12)". */
	readonly scopeCount: (label: string, n: number) => string;
	/** Instructional empty state shown before the rider types anything. */
	readonly idleTitle: string;
	readonly idleBody: string;
	/** "+N more" truncation note (caller owns the localized string). */
	readonly more: (n: number) => string;
	/** Per-group result-count caption (sr + visible). */
	readonly resultCount: (n: number) => string;
	/** The vehicle result row phrasing. */
	readonly vehicle: VehicleResultCopy;
}

export const copy: Record<Locale, SearchCopy> = {
	en: {
		kicker: 'SEARCH',
		heading: 'Find a line, stop or bus',
		lede: 'Search the network by line number, line name, stop name, stop code or live bus id. Results link straight to live detail.',
		inputLabel: 'Search lines, stops and buses',
		inputPlaceholder: 'Search a line, stop or vehicle',
		linesLabel: 'Lines',
		stopsLabel: 'Stops',
		vehiclesLabel: 'Live buses',
		scopeLabel: 'Show',
		scopeAll: 'All',
		modeLabel: 'Mode',
		modes: { metro: 'Métro', tram: 'Tram', bus: 'Bus', rail: 'Train', ferry: 'Ferry' },
		scopeCount: (label, n) => `${label} (${n})`,
		idleTitle: 'Search a line, stop or bus',
		idleBody: 'Type a line number, a line or stop name, a stop code, or a live bus id to find it.',
		more: (n) => `+${n} more`,
		resultCount: (n) => (n === 1 ? '1 result' : `${n} results`),
		vehicle: {
			busAria: (id) => `Live bus ${id}`,
			routeTag: (route) => `Route ${route}`,
			next: (stop) => `Next: ${stop}`,
			noNextStop: 'No next stop',
			heading: 'Heading',
			noCrowding: 'No crowding data',
			early: (minutes) => `${Math.abs(minutes)} min early`,
			late: (minutes) => `+${minutes} min`,
			onTime: 'On time',
			noDelay: 'No delay',
		},
	},
	fr: {
		kicker: 'RECHERCHE',
		heading: 'Trouver une ligne, un arrêt ou un bus',
		lede: 'Cherchez le réseau par numéro de ligne, nom de ligne, nom d’arrêt, code d’arrêt ou identifiant de bus en direct. Les résultats mènent directement au détail en direct.',
		inputLabel: 'Rechercher lignes, arrêts et bus',
		inputPlaceholder: 'Rechercher une ligne, un arrêt ou un véhicule',
		linesLabel: 'Lignes',
		stopsLabel: 'Arrêts',
		vehiclesLabel: 'Bus en direct',
		scopeLabel: 'Afficher',
		scopeAll: 'Tout',
		modeLabel: 'Mode',
		modes: { metro: 'Métro', tram: 'Tram', bus: 'Bus', rail: 'Train', ferry: 'Ferry' },
		scopeCount: (label, n) => `${label} (${n})`,
		idleTitle: 'Rechercher une ligne, un arrêt ou un bus',
		idleBody:
			'Saisissez un numéro de ligne, un nom de ligne ou d’arrêt, un code d’arrêt, ou un identifiant de bus en direct pour le trouver.',
		more: (n) => `+${n} de plus`,
		resultCount: (n) => (n === 1 ? '1 résultat' : `${n} résultats`),
		vehicle: {
			busAria: (id) => `Bus en direct ${id}`,
			routeTag: (route) => `Ligne ${route}`,
			next: (stop) => `Prochain : ${stop}`,
			noNextStop: 'Aucun prochain arrêt',
			heading: 'Direction',
			noCrowding: 'Aucune donnée d’achalandage',
			early: (minutes) => `${Math.abs(minutes)} min en avance`,
			late: (minutes) => `+${minutes} min`,
			onTime: 'À l’heure',
			noDelay: 'Aucun retard',
		},
	},
};

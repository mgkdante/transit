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

import { defineCopy, type Locale } from '$lib/i18n/copy';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export const copy = defineCopy({
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
		census: {
			label: 'The network right now',
			lines: (n) => `${n} lines`,
			stops: (n) => `${n} stops`,
			examplesLabel: 'Try',
			examples: ['747', 'Berri-UQAM', 'Métro'],
		},
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
		scopeCount: (label: string, n: number) => `${label} (${n})`,
		idleTitle: 'Rechercher une ligne, un arrêt ou un bus',
		idleBody:
			'Saisissez un numéro de ligne, un nom de ligne ou d’arrêt, un code d’arrêt, ou un identifiant de bus en direct pour le trouver.',
		census: {
			label: 'Le réseau en ce moment',
			lines: (n: string) => `${n} lignes`,
			stops: (n: string) => `${n} arrêts`,
			examplesLabel: 'Essayez',
			examples: ['747', 'Berri-UQAM', 'Métro'],
		},
		more: (n: number) => `+${n} de plus`,
		resultCount: (n: number) => (n === 1 ? '1 résultat' : `${n} résultats`),
		vehicle: {
			busAria: (id: string) => `Bus en direct ${id}`,
			routeTag: (route: string) => `Ligne ${route}`,
			next: (stop: string) => `Prochain : ${stop}`,
			noNextStop: 'Aucun prochain arrêt',
			heading: 'Direction',
			noCrowding: 'Aucune donnée d’achalandage',
			early: (minutes: number) => `${Math.abs(minutes)} min en avance`,
			late: (minutes: number) => `+${minutes} min`,
			onTime: 'À l’heure',
			noDelay: 'Aucun retard',
		},
	},
}) satisfies Readonly<Record<Locale, SurfaceHeadCopy>>;

export type SearchCopy = (typeof copy)[Locale];
export type VehicleResultCopy = SearchCopy['vehicle'];

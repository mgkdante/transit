// search.copy.ts — co-located bilingual copy for the Search surface (slice-9.3).
//
// EVERY user-facing string for SearchSurface lives here, keyed by Locale. The
// domain-intrinsic component labels (edge-state titles/bodies, the "+N more"
// truncation note formatting) live in the spine; this object owns only the
// surface-specific voice: the head, the input affordance, the section labels,
// and the instructional empty state. FR is the canonical product voice; EN is
// the parallel translation. No strings inline in the .svelte.

import type { Locale } from '$lib/i18n';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export interface SearchCopy extends SurfaceHeadCopy {
	/** Accessible label + placeholder for the search input. */
	readonly inputLabel: string;
	readonly inputPlaceholder: string;
	/** Group section headings. */
	readonly linesLabel: string;
	readonly stopsLabel: string;
	/** Instructional empty state shown before the rider types anything. */
	readonly idleTitle: string;
	readonly idleBody: string;
	/** "+N more" truncation note (caller owns the localized string). */
	readonly more: (n: number) => string;
	/** Per-group result-count caption (sr + visible). */
	readonly resultCount: (n: number) => string;
}

export const copy: Record<Locale, SearchCopy> = {
	en: {
		kicker: 'SEARCH',
		heading: 'Find a line or stop',
		lede: 'Search the network by line number, line name, stop name or stop code. Results link straight to live detail.',
		inputLabel: 'Search lines and stops',
		inputPlaceholder: 'Search a line, stop or vehicle',
		linesLabel: 'Lines',
		stopsLabel: 'Stops',
		idleTitle: 'Search a line, stop or vehicle',
		idleBody: 'Type a line number, a line or stop name, or a stop code to find it.',
		more: (n) => `+${n} more`,
		resultCount: (n) => (n === 1 ? '1 result' : `${n} results`),
	},
	fr: {
		kicker: 'RECHERCHE',
		heading: 'Trouver une ligne ou un arrêt',
		lede: 'Cherchez le réseau par numéro de ligne, nom de ligne, nom d’arrêt ou code d’arrêt. Les résultats mènent directement au détail en direct.',
		inputLabel: 'Rechercher lignes et arrêts',
		inputPlaceholder: 'Rechercher une ligne, un arrêt ou un véhicule',
		linesLabel: 'Lignes',
		stopsLabel: 'Arrêts',
		idleTitle: 'Rechercher une ligne, un arrêt ou un véhicule',
		idleBody:
			'Saisissez un numéro de ligne, un nom de ligne ou d’arrêt, ou un code d’arrêt pour le trouver.',
		more: (n) => `+${n} de plus`,
		resultCount: (n) => (n === 1 ? '1 résultat' : `${n} résultats`),
	},
};

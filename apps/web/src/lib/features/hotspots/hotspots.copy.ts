// hotspots.copy.ts: co-located bilingual copy for the Hotspots surface
// (slice-9.6, Family D · accountability).
//
// All user-facing strings the Hotspots screen renders live here, keyed by
// Locale, so the .svelte file carries zero inline copy. Provider-agnostic: no
// carrier name, no city. Domain-intrinsic labels already owned by the spine
// primitives (the SeverityBar's own a11y text inside RankedRow) are NOT
// duplicated here.

import type { Locale } from '$lib/i18n';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export interface HotspotsCopy extends SurfaceHeadCopy {
	/** Accessible label over the ranked list. */
	readonly listLabel: string;
	/** Plain caption naming what the magnitude bar encodes. */
	readonly rowCaption: string;
	/** Honest empty state: the roll-up published no hotspots. */
	readonly empty: string;
	/** Per-row delta: on-time points lost vs the network baseline. A null delta
	 * OMITS the display value entirely (no "no data" string), so the all-null
	 * column disappears rather than reading a permanent placeholder. */
	readonly deltaLost: (pts: string) => string;
	/** Mode tag chips by hotspot type (route / stop), shown beside the title. */
	readonly type: {
		readonly route: string;
		readonly stop: string;
	};
	/** Fallback row title when the roll-up published no name (just the id). */
	readonly unnamed: (id: string) => string;
	/** Accessible label for a row that links into its detail page. */
	readonly viewDetail: (title: string) => string;
	/** Honest caveat: a trailing-window ranking, not a certified league table. */
	readonly caveat: string;
	/** Units. */
	readonly units: {
		readonly pts: string;
	};
}

export const copy: Record<Locale, HotspotsCopy> = {
	fr: {
		kicker: 'RESPONSABILITÉ · POINTS CHAUDS',
		heading: 'Points chauds',
		subheading: '// PIRES EN PREMIER',
		lede: 'Les arrêts et les lignes qui tirent le réseau vers le bas, classés du pire au moins pire. On n’invente jamais de données.',
		listLabel: 'Points chauds classés du pire au moins pire',
		rowCaption: 'La barre indique l’ampleur du problème par rapport au pire cas.',
		empty: 'Aucun point chaud publié pour le moment.',
		deltaLost: (pts) => `${pts} pts de ponctualité perdus`,
		type: {
			route: 'Ligne',
			stop: 'Arrêt',
		},
		unnamed: (id) => `Élément ${id}`,
		viewDetail: (title) => `Voir le détail de ${title}`,
		caveat:
			'Classement sur fenêtre glissante, pondéré par les observations, pas un palmarès certifié; les petits échantillons varient.',
		units: { pts: 'pts' },
	},
	en: {
		kicker: 'ACCOUNTABILITY · HOTSPOTS',
		heading: 'Hotspots',
		subheading: '// WORST FIRST',
		lede: 'The stops and lines dragging the network down, ranked worst first. We never invent data.',
		listLabel: 'Hotspots ranked worst first',
		rowCaption: 'The bar shows the problem size relative to the worst case.',
		empty: 'No hotspots published right now.',
		deltaLost: (pts) => `${pts} on-time points lost`,
		type: {
			route: 'Line',
			stop: 'Stop',
		},
		unnamed: (id) => `Item ${id}`,
		viewDetail: (title) => `View detail for ${title}`,
		caveat:
			'Trailing-window, observation-weighted ranking, not a certified league table; small samples vary.',
		units: { pts: 'pts' },
	},
};

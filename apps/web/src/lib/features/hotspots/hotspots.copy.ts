// hotspots.copy.ts: co-located bilingual copy for the Hotspots surface (S12 re-seat).
//
// All user-facing strings the Hotspots screen renders live here, keyed by Locale, so
// the .svelte files carry zero inline copy. Provider-agnostic: no carrier name, no
// city hardcoded — a city/provider name comes from the SERVED label (or the provider
// id) at the call site, never fabricated here. Domain-intrinsic labels already owned
// by the spine primitives (the Chart's own a11y text, GrainPicker roles) are NOT
// duplicated here.

import type { Locale } from '$lib/i18n';
import type { SurfaceHeadCopy } from '$lib/components/surface';

export interface HotspotsCopy extends SurfaceHeadCopy {
	/** Rail overline (e.g. "View" / "Vue") + the grain radiogroup label. */
	readonly viewControlsLabel: string;
	readonly grain: {
		readonly label: string;
		readonly day: string;
		readonly week: string;
		readonly month: string;
		/** The PEAK-ONLY cut (DECISIONS DB1/WEB4) — a 4th rail segment: the am+pm rush of
		 * the trailing week, not a per-row sub-breakdown. */
		readonly shift: string;
	};
	/** The trailing-window caption per grain (what aggregate the ranking reads). */
	readonly window: {
		readonly day: string;
		readonly week: string;
		readonly month: string;
		/** The shift cut is PEAK-ONLY — the am+pm peak (rush-hour) periods of the trailing week. */
		readonly shift: string;
	};
	/** The worst-N ladder control. */
	readonly worstN: {
		/** Radiogroup label (e.g. "Show" / "Afficher"). */
		readonly label: string;
		/** The uncapped rung label (e.g. "All" / "Tout"). */
		readonly all: string;
	};
	/** Ladder section heading (the worst spots) + its value-axis label. */
	readonly ladder: {
		readonly heading: string;
		/** Value-axis title — the severe-delay rate the bar encodes. */
		readonly severeRateLabel: string;
		/** Wilson-interval label surfaced in the tooltip + sr-only table. */
		readonly ci: string;
	};
	/** The un-ranked tray (sub-MIN_N cells) heading + reason. */
	readonly tray: {
		/** Section heading (e.g. "Below the reliable-reading floor"). */
		readonly heading: string;
		/** Why these cells are not ranked (the MIN_N floor). */
		readonly reason: string;
		/** Accessible label over the tray list. */
		readonly listLabel: string;
		/** One tray row's subtitle (kind · id). */
		readonly rowSubtitle: (kind: string, id: string) => string;
	};
	/** Per-row evidence note fragments (severe% · avg min · n). */
	readonly note: {
		readonly severe: string;
		readonly avg: string;
		readonly samples: string;
	};
	/** OTP-points delta display (points of on-time lost vs baseline) — evidence field. */
	readonly deltaLost: (pts: string) => string;
	/**
	 * §C5.10 verdict callout above the ladder: the #1 hotspot named + its on-time loss,
	 * so the already-computed otp_delta_pts is finally SHOWN as the headline reading.
	 */
	readonly verdict: {
		/** Accessible label for the callout region. */
		readonly label: string;
		/** The #1-hotspot sentence (name + delta) when a delta is present. */
		readonly topWithDelta: (name: string, deltaPts: string) => string;
		/** The #1-hotspot sentence when no delta is served (name only — honest absence). */
		readonly topNoDelta: (name: string) => string;
		/** Stand-down line when no hotspot ranks (published-empty). */
		readonly none: string;
	};
	/** Mode tag chips by hotspot type (route / stop). */
	readonly type: {
		readonly route: string;
		readonly stop: string;
	};
	/** Fallback row title when the roll-up published no name (just the id). */
	readonly unnamed: (id: string) => string;
	/** Accessible label for a row that links into its detail page. */
	readonly viewDetail: (title: string) => string;
	/** Honest shown/total heading suffix builder ("· 10/42"). */
	readonly shownOfTotal: (shown: number, total: number) => string;
	/** Honest caveat: a trailing-window ranking, not a certified league table. */
	readonly caveat: string;
	/** Units. */
	readonly units: {
		readonly pts: string;
		readonly pct: string;
		readonly min: string;
	};
}

export const copy: Record<Locale, HotspotsCopy> = {
	fr: {
		kicker: 'RESPONSABILITÉ · POINTS CHAUDS',
		heading: 'Points chauds',
		subheading: '// PIRES EN PREMIER',
		lede: 'Les arrêts et les lignes qui tirent le réseau vers le bas, classés du pire au moins pire par le taux de retards graves. On n’invente jamais de données.',
		viewControlsLabel: 'Vue',
		grain: {
			label: 'Granularité',
			day: 'Jour',
			week: 'Semaine',
			month: 'Mois',
			shift: 'Heures de pointe',
		},
		window: {
			day: 'Classement sur la dernière journée de service.',
			week: 'Classement sur la dernière semaine glissante.',
			month: 'Classement sur le dernier mois glissant.',
			shift:
				'Classement sur les heures de pointe (matin et soir) de la dernière semaine glissante.',
		},
		worstN: {
			label: 'Afficher',
			all: 'Tout',
		},
		ladder: {
			heading: 'Pires points',
			severeRateLabel: 'Taux de retards graves',
			ci: 'IC à 95 %',
		},
		tray: {
			heading: 'Sous le seuil de lecture fiable',
			reason: 'Trop peu d’observations pour un classement (moins de 30 relevés) · non classés.',
			listLabel: 'Points non classés, sous le seuil d’observations',
			rowSubtitle: (kind, id) => `${kind} · ${id}`,
		},
		note: {
			severe: 'graves',
			avg: 'moy',
			samples: 'n',
		},
		deltaLost: (pts) => `${pts} pts de ponctualité perdus`,
		verdict: {
			label: 'Point chaud n°1',
			topWithDelta: (name, deltaPts) =>
				`Pire point chaud : ${name}, ${deltaPts} pts de ponctualité perdus.`,
			topNoDelta: (name) => `Pire point chaud : ${name}.`,
			none: 'Aucun point chaud pour l’instant.',
		},
		type: {
			route: 'Ligne',
			stop: 'Arrêt',
		},
		unnamed: (id) => `Élément ${id}`,
		viewDetail: (title) => `Voir le détail de ${title}`,
		shownOfTotal: (shown, total) => `· ${shown}/${total}`,
		caveat:
			'Classement sur fenêtre glissante, pondéré par les observations, pas un palmarès certifié; les petits échantillons varient.',
		units: { pts: 'pts', pct: '%', min: ' min' },
	},
	en: {
		kicker: 'ACCOUNTABILITY · HOTSPOTS',
		heading: 'Hotspots',
		subheading: '// WORST FIRST',
		lede: 'The stops and lines dragging the network down, ranked worst first by their severe-delay rate. We never invent data.',
		viewControlsLabel: 'View',
		grain: {
			label: 'Granularity',
			day: 'Day',
			week: 'Week',
			month: 'Month',
			shift: 'Peak hours',
		},
		window: {
			day: 'Ranked over the latest service day.',
			week: 'Ranked over the latest trailing week.',
			month: 'Ranked over the latest trailing month.',
			shift: 'Ranked over the peak (rush-hour) periods of the trailing week.',
		},
		worstN: {
			label: 'Show',
			all: 'All',
		},
		ladder: {
			heading: 'Worst spots',
			severeRateLabel: 'Severe-delay rate',
			ci: '95% CI',
		},
		tray: {
			heading: 'Below the reliable-reading floor',
			reason: 'Too few observations to rank (fewer than 30 readings) · not ranked.',
			listLabel: 'Un-ranked spots, below the observations floor',
			rowSubtitle: (kind, id) => `${kind} · ${id}`,
		},
		note: {
			severe: 'severe',
			avg: 'avg',
			samples: 'n',
		},
		deltaLost: (pts) => `${pts} on-time points lost`,
		verdict: {
			label: '#1 hotspot',
			topWithDelta: (name, deltaPts) => `Worst hotspot: ${name}, ${deltaPts} on-time points lost.`,
			topNoDelta: (name) => `Worst hotspot: ${name}.`,
			none: 'Nothing is a hotspot right now.',
		},
		type: {
			route: 'Line',
			stop: 'Stop',
		},
		unnamed: (id) => `Item ${id}`,
		viewDetail: (title) => `View detail for ${title}`,
		shownOfTotal: (shown, total) => `· ${shown}/${total}`,
		caveat:
			'Trailing-window, observation-weighted ranking, not a certified league table; small samples vary.',
		units: { pts: 'pts', pct: '%', min: ' min' },
	},
};

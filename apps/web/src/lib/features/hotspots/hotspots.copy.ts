// hotspots.copy.ts: co-located bilingual copy for the Hotspots surface (S12 re-seat).
//
// All user-facing strings the Hotspots screen renders live here, keyed by Locale, so
// the .svelte files carry zero inline copy. Provider-agnostic: no carrier name, no
// city hardcoded — a city/provider name comes from the SERVED label (or the provider
// id) at the call site, never fabricated here. Domain-intrinsic labels already owned
// by the spine primitives (the Chart's own a11y text, GrainPicker roles) are NOT
// duplicated here.

import type { Locale } from '$lib/i18n';
import type { HistoryNavigatorLabels, SurfaceHeadCopy } from '$lib/components/surface';
import type { HistoryCorrection } from '$lib/v1';

export interface HotspotsCopy extends SurfaceHeadCopy {
	readonly article: {
		readonly watermark: string;
		readonly back: string;
		readonly tagsAria: string;
		readonly tags: readonly string[];
		readonly sections: (count: number) => string;
	};
	readonly asOf: string;
	readonly history: {
		readonly navigator: HistoryNavigatorLabels;
		readonly coverage: (first: string, last: string) => string;
		readonly selection: (date: string) => string;
		readonly correction: Record<HistoryCorrection['reason'], string>;
		readonly retainedWindow: (date: string) => string;
	};
	readonly rail: {
		readonly label: string;
		readonly open: string;
		readonly close: string;
		readonly controls: string;
		readonly toc: string;
		readonly counterPrefix: string;
	};
	readonly cards: {
		readonly top: { readonly title: string; readonly subtitle: string };
		readonly lines: { readonly title: string; readonly subtitle: string };
		readonly stops: { readonly title: string; readonly subtitle: string };
	};
	readonly caveatLabel: string;
	readonly grain: {
		readonly label: string;
		readonly day: string;
		readonly week: string;
		readonly month: string;
		/** The PEAK-ONLY cut (DECISIONS DB1/WEB4) — a 4th rail segment: the am+pm rush of
		 * the trailing week, not a per-row sub-breakdown. */
		readonly shift: string;
		readonly shiftCompact: string;
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
	readonly chart: {
		readonly scroll: (sectionTitle: string) => string;
		readonly popover: {
			readonly averageDelay: string;
			readonly readings: string;
			readonly viewLine: string;
			readonly viewStop: string;
		};
	};
	/** The un-ranked tray (sub-MIN_N cells) heading + reason. */
	readonly tray: {
		/** Section heading (e.g. "Below the reliable-reading floor"). */
		readonly heading: string;
		/** Why these cells are not ranked (the MIN_N floor). */
		readonly reason: string;
		/** Accessible label over the tray table. */
		readonly listLabel: string;
		readonly columns: {
			readonly item: string;
			readonly typeId: string;
			readonly readings: string;
		};
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
		article: {
			watermark: 'Points chauds',
			back: '← Retour au tableau de bord',
			tagsAria: 'Mots-clés de la page',
			tags: ['chauds', 'lignes', 'arrêts', 'retards graves'],
			sections: (count) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		},
		asOf: 'À JOUR AU',
		history: {
			navigator: {
				group: 'Parcourir l’historique conservé des points chauds',
				picker: {
					group: 'Historique des points chauds',
					start: 'Du',
					end: 'Au',
					clear: 'Données actuelles',
					anyStart: 'Première date',
					anyEnd: 'Dernière date',
					single: 'Date historique',
				},
				previous: 'Date précédente',
				next: 'Date suivante',
			},
			coverage: (first, last) => `Historique disponible : du ${first} au ${last}.`,
			selection: (date) => `Date affichée : ${date}.`,
			correction: {
				malformed: 'Cette date n’était pas valide. Affichage des points chauds les plus récents.',
				'outside-coverage':
					'Cette date est hors de l’historique conservé. Affichage des points chauds les plus récents.',
				gap: 'Cette date tombe dans une lacune de publication. Affichage des points chauds les plus récents.',
				unpublished:
					'Cette journée n’a pas été publiée. Affichage des points chauds les plus récents.',
			},
			retainedWindow: (date) => `Observations conservées disponibles se terminant le ${date}.`,
		},
		rail: {
			label: 'Vue et sommaire',
			open: 'Ouvrir les commandes et le sommaire',
			close: 'Fermer les commandes et le sommaire',
			controls: 'Commandes de vue',
			toc: 'Sur cette page',
			counterPrefix: 'SEC',
		},
		cards: {
			top: {
				title: 'Point chaud principal',
				subtitle: 'Le pire point chaud actuel et les preuves qui l’expliquent',
			},
			lines: {
				title: 'Lignes',
				subtitle:
					'Lignes classées selon le taux de retards graves, y compris les petits échantillons',
			},
			stops: {
				title: 'Arrêts',
				subtitle:
					'Arrêts classés selon le taux de retards graves, y compris les petits échantillons',
			},
		},
		caveatLabel: 'Mise en garde',
		grain: {
			label: 'Granularité',
			day: 'Jour',
			week: 'Semaine',
			month: 'Mois',
			shift: 'Heures de pointe',
			shiftCompact: 'Pointe',
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
		chart: {
			scroll: (sectionTitle) => `Faire défiler horizontalement le graphique ${sectionTitle}`,
			popover: {
				averageDelay: 'Retard moyen',
				readings: 'Relevés',
				viewLine: 'Voir la ligne',
				viewStop: 'Voir l’arrêt',
			},
		},
		tray: {
			heading: 'Sous le seuil de lecture fiable',
			reason: 'Trop peu d’observations pour un classement (moins de 30 relevés) · non classés.',
			listLabel: 'Points non classés, sous le seuil d’observations',
			columns: {
				item: 'Élément',
				typeId: 'Type / ID',
				readings: 'Relevés',
			},
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
		article: {
			watermark: 'Hotspots',
			back: '← Back to the dashboard',
			tagsAria: 'Page keywords',
			tags: ['hotspots', 'lines', 'stops', 'severe delay'],
			sections: (count) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		},
		asOf: 'AS OF',
		history: {
			navigator: {
				group: 'Browse retained hotspots history',
				picker: {
					group: 'Hotspots history',
					start: 'From',
					end: 'To',
					clear: 'Current data',
					anyStart: 'Earliest date',
					anyEnd: 'Latest date',
					single: 'History date',
				},
				previous: 'Previous date',
				next: 'Next date',
			},
			coverage: (first, last) => `History available: ${first} to ${last}.`,
			selection: (date) => `Showing date: ${date}.`,
			correction: {
				malformed: 'That date was not valid. Showing the latest hotspots.',
				'outside-coverage': 'That date is outside retained history. Showing the latest hotspots.',
				gap: 'That date falls in a publication gap. Showing the latest hotspots.',
				unpublished: 'That day was not published. Showing the latest hotspots.',
			},
			retainedWindow: (date) => `Available retained observations ending ${date}.`,
		},
		rail: {
			label: 'View & contents',
			open: 'Open view controls and contents',
			close: 'Close view controls and contents',
			controls: 'View controls',
			toc: 'On this page',
			counterPrefix: 'SEC',
		},
		cards: {
			top: {
				title: 'Top hotspot',
				subtitle: 'The worst current hotspot and the evidence behind it',
			},
			lines: {
				title: 'Lines',
				subtitle: 'Lines ranked by severe-delay rate, including low-sample cases',
			},
			stops: {
				title: 'Stops',
				subtitle: 'Stops ranked by severe-delay rate, including low-sample cases',
			},
		},
		caveatLabel: 'Caveat',
		grain: {
			label: 'Granularity',
			day: 'Day',
			week: 'Week',
			month: 'Month',
			shift: 'Peak hours',
			shiftCompact: 'Peak hours',
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
		chart: {
			scroll: (sectionTitle) => `Scroll the ${sectionTitle} chart horizontally`,
			popover: {
				averageDelay: 'Average delay',
				readings: 'Readings',
				viewLine: 'View line',
				viewStop: 'View stop',
			},
		},
		tray: {
			heading: 'Below the reliable-reading floor',
			reason: 'Too few observations to rank (fewer than 30 readings) · not ranked.',
			listLabel: 'Un-ranked spots, below the observations floor',
			columns: {
				item: 'Item',
				typeId: 'Type / ID',
				readings: 'Readings',
			},
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

// repeatOffenders.copy.ts: co-located bilingual copy for the Repeat-offenders
// ("récidivistes") accountability surface (S14 re-seat).
//
// All user-facing strings the screen renders live here, keyed by Locale, so the
// .svelte files carry zero inline copy. The FR voice is the canonical product voice
// (mirrors the raw-FR /v1 headers); EN is the parallel translation. Provider-agnostic:
// no operator/city names. Honest-not-alarmist tone — the copy EXPLAINS why an entity
// is flagged (natural-frequency recurrence), never dramatizes it. Absence strings
// carry NO em-dash.
//
// S14 grows the primary by_grain path (combined rail, stacked trip/vehicle cards,
// worst-N ladders, natural-frequency evidence, and trays) while KEEPING the legacy
// ledger fields (the fallback path reads the same recurrence / type / caveat copy).

import type { Locale } from '$lib/i18n';
import type { HistoryNavigatorLabels, SurfaceHeadCopy } from '$lib/components/surface';
import type { HistoryCorrection } from '$lib/v1';

export interface RepeatOffendersCopy extends SurfaceHeadCopy {
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
		readonly retainedWorstSubtitle: string;
		readonly retainedHeroNone: string;
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
		readonly worst: { readonly title: string; readonly subtitle: string };
		readonly trips: { readonly title: string; readonly subtitle: string };
		readonly vehicles: { readonly title: string; readonly subtitle: string };
	};
	readonly caveatLabel: string;
	/** Rail overline (e.g. "View" / "Vue") + the grain radiogroup label. */
	readonly viewControlsLabel: string;
	readonly grain: {
		readonly label: string;
		readonly week: string;
		readonly month: string;
	};
	/** The trailing-window caption per grain (what window the recurrence reads). */
	readonly window: {
		readonly week: string;
		readonly month: string;
	};
	/** The worst-N ladder control. */
	readonly worstN: {
		/** Radiogroup label (e.g. "Show" / "Afficher"). */
		readonly label: string;
		/** The uncapped rung label (e.g. "All" / "Tout"). */
		readonly all: string;
	};
	/** The headline metric tile (ExplainedMetricCard). */
	readonly headline: {
		/** Metric label on the tile (the severe-delay rate the ladder ranks). */
		readonly label: string;
		/** The always-visible plain-language explanation of what the ladder shows. */
		readonly explanation: string;
	};
	/**
	 * §C5.12 #1-offender hero: the actual worst entity is the hero now (name + streak +
	 * Wilson-bounded rate), and the old value=null definition card demotes to a lede + (i).
	 */
	readonly hero: {
		/** Accessible label for the hero region. */
		readonly label: string;
		/** Overline over the #1 entity name. */
		readonly overline: string;
		/** The streak line (recurrence natural frequency); reuses `recurrence.naturalFrequency`. */
		readonly streakLabel: string;
		/** The severe-rate reading with its Wilson interval (rate% + 95% CI bounds). */
		readonly rateWithCi: (ratePct: string, lo: string, hi: string) => string;
		/** The severe-rate reading when no Wilson bounds are served (rate only). */
		readonly rateNoCi: (ratePct: string) => string;
		/** Stand-down when no offender ranks (published-empty). */
		readonly none: string;
	};
	/** The ladder section heading + its value-axis label. */
	readonly ladder: {
		readonly heading: string;
		/** Value-axis title — the severe-delay rate the bar encodes. */
		readonly severeRateLabel: string;
		/** Wilson-interval label surfaced in the tooltip + sr-only table. */
		readonly ci: string;
	};
	readonly chart: {
		readonly popover: {
			readonly recurrence: string;
			readonly averageDelay: string;
			readonly readings: string;
			readonly viewLine: string;
		};
	};
	readonly evidenceTable: {
		readonly caption: string;
		readonly columns: {
			readonly item: string;
			readonly typeId: string;
			readonly severeRate: string;
			readonly recurrence: string;
			readonly averageDelay: string;
			readonly readings: string;
		};
	};
	/** The natural-frequency recurrence line per row ("late-prone on N of M observed days"). */
	readonly recurrence: {
		/** N of M observed days (the natural-frequency template). */
		readonly naturalFrequency: (lateDays: number, observedDays: number) => string;
		/** Fallback when the recurrence counts are not recorded. */
		readonly unknown: string;
	};
	/** Per-row evidence note fragments (severe% · recurrence · n). */
	readonly note: {
		readonly severe: string;
		readonly samples: string;
	};
	/** The un-ranked tray (sub-MIN_N entities) heading + reason. */
	readonly tray: {
		readonly heading: string;
		readonly reason: string;
		readonly listLabel: string;
		readonly rowSubtitle: (kind: string, id: string) => string;
	};
	/** Mono mode-tag labels for the entity-type discriminator. */
	readonly type: {
		readonly trip: string;
		readonly vehicle: string;
		/** Legacy scalar-ledger discriminators. */
		readonly route: string;
		readonly stop: string;
		/** Any other / unknown discriminator value. */
		readonly other: string;
	};
	/** Fallback entity title when the roll-up published no name (just the id). */
	readonly unnamed: (id: string) => string;
	/** Accessible label for a row that links into its detail page. */
	readonly viewDetail: (title: string) => string;
	/** Honest shown/total heading suffix builder ("· 10/42"). */
	readonly shownOfTotal: (shown: number, total: number) => string;
	/** Honest caveat under the ladder (observed-days denominator + trailing-window proxy). */
	readonly caveat: string;
	/** Units appended to formatted values. */
	readonly units: {
		readonly min: string;
		readonly pct: string;
	};

	/* ── Legacy ledger (fallback path — by_grain absent) ─────────────────────────── */
	/** Section caption above the legacy ranked list. */
	readonly listSection: string;
	/** Accessible summary of the legacy ranked list (role="list"). */
	readonly listSummary: string;
	/** Per-list caption: what the headline value + magnitude bar encode. */
	readonly rowCaption: string;
	/** Legacy subtitle prefix for a present recurrence string. */
	readonly recurrenceLabel: string;
	/** Legacy subtitle fallback when a row carries no recurrence string. */
	readonly recurrenceUnknown: string;
}

export const copy: Record<Locale, RepeatOffendersCopy> = {
	en: {
		kicker: 'ACCOUNTABILITY · REPEAT OFFENDERS',
		heading: 'Repeat offenders',
		subheading: '// RÉCIDIVISTES',
		lede: 'The trips and vehicles that run severely late on day after day, ranked worst first by how reliably they slip. We never invent data: an absent reading shows as “no data”, never a fabricated zero.',
		article: {
			watermark: 'Repeat',
			back: '← Back to the dashboard',
			tagsAria: 'Page keywords',
			tags: ['offenders', 'trips', 'vehicles', 'recurrence'],
			sections: (count) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		},
		asOf: 'AS OF',
		history: {
			navigator: {
				group: 'Browse retained repeat-offender history',
				picker: {
					group: 'Repeat-offender history',
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
				malformed: 'That date was not valid. Showing the latest repeat offenders.',
				'outside-coverage':
					'That date is outside retained history. Showing the latest repeat offenders.',
				gap: 'That date falls in a publication gap. Showing the latest repeat offenders.',
				unpublished: 'That day was not published. Showing the latest repeat offenders.',
			},
			retainedWindow: (date) => `Available retained observations ending ${date}.`,
			retainedWorstSubtitle:
				'The worst repeat offender in the selected retained observations, its severe rate, and its streak',
			retainedHeroNone: 'No repeat offender ranks in the selected retained observations.',
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
			worst: {
				title: 'Worst repeat offender',
				subtitle: 'The current worst repeat offender, its severe rate, and its streak',
			},
			trips: {
				title: 'Trips',
				subtitle: 'Trips ranked by repeated severe lateness across observed days',
			},
			vehicles: {
				title: 'Vehicles',
				subtitle: 'Vehicles ranked by repeated severe lateness across observed days',
			},
		},
		caveatLabel: 'Caveat',
		viewControlsLabel: 'View',
		grain: {
			label: 'Window',
			week: 'Week',
			month: 'Month',
		},
		window: {
			week: 'Recurrence read over the latest trailing week of service.',
			month: 'Recurrence read over the latest trailing month of service.',
		},
		worstN: {
			label: 'Show',
			all: 'All',
		},
		headline: {
			label: 'Severe-delay rate',
			explanation:
				'Each row is a single trip or vehicle that keeps running severely late. The bar is its severe-delay rate, the share of its readings more than five minutes behind schedule, ranked worst first by the cautious (Wilson) lower bound, so a chronic offender with plenty of readings outranks a noisy one with few. The line beneath each bar says how many of its observed service days were late-prone, so you can see the recurrence, not just the average.',
		},
		hero: {
			label: 'Worst repeat offender',
			overline: '#1 offender',
			streakLabel: 'Streak',
			rateWithCi: (ratePct, lo, hi) =>
				`${ratePct} of readings severely late (95% sure between ${lo} and ${hi}%).`,
			rateNoCi: (ratePct) => `${ratePct} of readings severely late.`,
			none: 'No repeat offender ranks right now.',
		},
		ladder: {
			heading: 'Worst offenders',
			severeRateLabel: 'Severe-delay rate',
			ci: '95% CI',
		},
		chart: {
			popover: {
				recurrence: 'Recurrence',
				averageDelay: 'Average delay',
				readings: 'Readings',
				viewLine: 'View line',
			},
		},
		evidenceTable: {
			caption: 'Evidence for ranked repeat offenders',
			columns: {
				item: 'Item',
				typeId: 'Type / ID',
				severeRate: 'Severe-delay rate',
				recurrence: 'Recurrence',
				averageDelay: 'Average delay',
				readings: 'Readings',
			},
		},
		recurrence: {
			naturalFrequency: (lateDays, observedDays) =>
				`Late-prone on ${lateDays} of ${observedDays} observed days`,
			unknown: 'recurrence not recorded',
		},
		note: {
			severe: 'severe',
			samples: 'n',
		},
		tray: {
			heading: 'Below the reliable-reading floor',
			reason: 'Too few observations to rank (fewer than 30 readings) · not ranked.',
			listLabel: 'Un-ranked offenders, below the observations floor',
			rowSubtitle: (kind, id) => `${kind} · ${id}`,
		},
		type: {
			trip: 'Trip',
			vehicle: 'Vehicle',
			route: 'Line',
			stop: 'Stop',
			other: 'Entity',
		},
		unnamed: (id) => `Item ${id}`,
		viewDetail: (title) => `View detail for ${title}`,
		shownOfTotal: (shown, total) => `· ${shown}/${total}`,
		caveat:
			'A trailing-window recurrence proxy, not a certified scorecard. “Observed days” counts only the service days we actually recorded this entity, so the denominator reflects our coverage, not the full timetable, and small samples vary. Open a row to see the offending line in full.',
		units: { min: ' min', pct: '%' },

		listSection: 'Worst first',
		listSummary: 'Repeat-offender lines and stops, ranked by average delay, worst first.',
		rowCaption: 'Average delay, with how often the lateness recurs',
		recurrenceLabel: 'recurs',
		recurrenceUnknown: 'recurrence not recorded',
	},
	fr: {
		kicker: 'REDDITION DE COMPTES · RÉCIDIVISTES',
		heading: 'Récidivistes',
		subheading: '// REPEAT OFFENDERS',
		lede: 'Les voyages et les véhicules qui accumulent les retards graves jour après jour, classés du pire au moins pire selon la régularité de leurs ratés. On n’invente jamais de données : une lecture absente s’affiche « aucune donnée », jamais un zéro fabriqué.',
		article: {
			watermark: 'Récidive',
			back: '← Retour au tableau de bord',
			tagsAria: 'Mots-clés de la page',
			tags: ['récidivistes', 'voyages', 'véhicules', 'récurrence'],
			sections: (count) => `${count} ${count === 1 ? 'section' : 'sections'}`,
		},
		asOf: 'À JOUR AU',
		history: {
			navigator: {
				group: 'Parcourir l’historique conservé des récidivistes',
				picker: {
					group: 'Historique des récidivistes',
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
				malformed: 'Cette date n’était pas valide. Affichage des récidivistes les plus récents.',
				'outside-coverage':
					'Cette date est hors de l’historique conservé. Affichage des récidivistes les plus récents.',
				gap: 'Cette date tombe dans une lacune de publication. Affichage des récidivistes les plus récents.',
				unpublished:
					'Cette journée n’a pas été publiée. Affichage des récidivistes les plus récents.',
			},
			retainedWindow: (date) => `Observations conservées disponibles se terminant le ${date}.`,
			retainedWorstSubtitle:
				'Le pire récidiviste des observations conservées sélectionnées, son taux de retards graves et sa série',
			retainedHeroNone: 'Aucun récidiviste classé dans les observations conservées sélectionnées.',
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
			worst: {
				title: 'Pire récidiviste',
				subtitle: 'Le pire récidiviste actuel, son taux de retards graves et sa série',
			},
			trips: {
				title: 'Voyages',
				subtitle: 'Voyages classés selon la répétition des retards graves sur les jours observés',
			},
			vehicles: {
				title: 'Véhicules',
				subtitle: 'Véhicules classés selon la répétition des retards graves sur les jours observés',
			},
		},
		caveatLabel: 'Mise en garde',
		viewControlsLabel: 'Vue',
		grain: {
			label: 'Fenêtre',
			week: 'Semaine',
			month: 'Mois',
		},
		window: {
			week: 'Récurrence calculée sur la dernière semaine glissante de service.',
			month: 'Récurrence calculée sur le dernier mois glissant de service.',
		},
		worstN: {
			label: 'Afficher',
			all: 'Tout',
		},
		headline: {
			label: 'Taux de retards graves',
			explanation:
				'Chaque rangée est un seul voyage ou véhicule qui accumule les retards graves. La barre indique son taux de retards graves, soit la part de ses relevés à plus de cinq minutes de retard, classé du pire au moins pire selon la borne inférieure prudente (Wilson), afin qu’un récidiviste chronique avec beaucoup de relevés devance un cas bruyant avec peu de relevés. La ligne sous chaque barre indique combien de ses jours de service observés étaient sujets aux retards, pour voir la récurrence et pas seulement la moyenne.',
		},
		hero: {
			label: 'Pire récidiviste',
			overline: 'Récidiviste n°1',
			streakLabel: 'Série',
			rateWithCi: (ratePct, lo, hi) =>
				`${ratePct} des relevés en retard grave (sûr à 95 % entre ${lo} et ${hi} %).`,
			rateNoCi: (ratePct) => `${ratePct} des relevés en retard grave.`,
			none: 'Aucun récidiviste classé pour l’instant.',
		},
		ladder: {
			heading: 'Pires récidivistes',
			severeRateLabel: 'Taux de retards graves',
			ci: 'IC à 95 %',
		},
		chart: {
			popover: {
				recurrence: 'Récurrence',
				averageDelay: 'Retard moyen',
				readings: 'Relevés',
				viewLine: 'Voir la ligne',
			},
		},
		evidenceTable: {
			caption: 'Données probantes des récidivistes classés',
			columns: {
				item: 'Élément',
				typeId: 'Type / ID',
				severeRate: 'Taux de retards graves',
				recurrence: 'Récurrence',
				averageDelay: 'Retard moyen',
				readings: 'Relevés',
			},
		},
		recurrence: {
			naturalFrequency: (lateDays, observedDays) =>
				`Sujet aux retards ${lateDays} ${lateDays === 1 ? 'jour' : 'jours'} sur ${observedDays} ${observedDays === 1 ? 'observé' : 'observés'}`,
			unknown: 'récurrence non consignée',
		},
		note: {
			severe: 'graves',
			samples: 'n',
		},
		tray: {
			heading: 'Sous le seuil de lecture fiable',
			reason: 'Trop peu d’observations pour un classement (moins de 30 relevés) · non classés.',
			listLabel: 'Récidivistes non classés, sous le seuil d’observations',
			rowSubtitle: (kind, id) => `${kind} · ${id}`,
		},
		type: {
			trip: 'Voyage',
			vehicle: 'Véhicule',
			route: 'Ligne',
			stop: 'Arrêt',
			other: 'Entité',
		},
		unnamed: (id) => `Élément ${id}`,
		viewDetail: (title) => `Voir le détail de ${title}`,
		shownOfTotal: (shown, total) => `· ${shown}/${total}`,
		caveat:
			'Une estimation de récurrence sur fenêtre glissante, pas un bulletin certifié. Les « jours observés » ne comptent que les jours de service réellement relevés pour cette entité, donc le dénominateur reflète notre couverture, pas l’horaire complet, et les petits échantillons varient. Ouvrez une rangée pour voir la ligne fautive au complet.',
		units: { min: ' min', pct: '%' },

		listSection: 'Les pires d’abord',
		listSummary: 'Lignes et arrêts récidivistes, classés par retard moyen, les pires d’abord.',
		rowCaption: 'Retard moyen, avec la fréquence de récurrence du retard',
		recurrenceLabel: 'récurrence',
		recurrenceUnknown: 'récurrence non consignée',
	},
};

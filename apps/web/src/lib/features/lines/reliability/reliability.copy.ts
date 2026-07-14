// reliability.copy.ts — co-located bilingual copy for the slice-9.6 historic
// Reliability surface (the clustered approach-B surface). FR is the canonical
// product voice; EN mirrors it. Bands and the control spine read from here so
// their markup stays string-free.
//
// Scope:
//   - clusters[]   — the five numbered cluster overlines ('01 Punctuality' …).
//   - strip{}      — the snapshot-strip metric labels + the two honest-state
//                    notes (ramp-in / no-data) shared by every band.
//   - windows{}    — per-band "when?" captions (the active window each band
//                    covers), rendered under each band's primary label.
//   - peak{}       — the peak/off-peak (by time of day) block labels.
//   - regularity{} — plain-language microcopy for the wait-regularity terms.
//   - controls{}   — the grain control-spine labels + the active-window caption.

import type { Locale } from '$lib/i18n';
// The verdict copy shape is now the shared $lib/v1 kernel (hoisted so every OTP-headline
// surface reuses the ONE verdict engine); re-export VerdictSentenceArgs for the callers
// that still reference it from here.
import type { VerdictCopy, VerdictSentenceArgs } from '$lib/v1/verdict';
export type { VerdictSentenceArgs };

/** The five cluster keys, in surface order. */
export type ReliabilityClusterKey =
	| 'punctuality'
	| 'waitRegularity'
	| 'serviceDelivered'
	| 'crowding'
	| 'habits';

export interface ReliabilityCopy {
	/** Numbered cluster overlines ('01 Punctuality' / '01 Ponctualité' …). */
	readonly clusters: Record<ReliabilityClusterKey, string>;
	/** Snapshot-strip metric labels + the shared honest-state notes. */
	readonly strip: {
		/** Accessible name for the snapshot section landmark (band 00). */
		readonly snapshotLabel: string;
		readonly otpPct: string;
		/** Tooltip label for a chart's target/goal tick (e.g. the 80% on-time target). */
		readonly target: string;
		readonly avgDelayMin: string;
		/** Typical (median / p50) delay label — plain, not jargon. */
		readonly p50Min: string;
		/** Worst-case (p90) delay label — plain, not jargon. */
		readonly p90Min: string;
		readonly headwayRegularityCov: string;
		readonly cancellationRatePct: string;
		readonly skippedStopRatePct: string;
		readonly serviceCompletenessPct: string;
		/** Honest completeness fraction: "{canceled} of {total} trip-days canceled". */
		readonly cancellationFraction: (canceled: string, total: string) => string;
		/** Honest completeness fraction: "{skipped} of {total} stop updates skipped". */
		readonly skippedFraction: (skipped: string, total: string) => string;
		readonly serviceCompletenessFraction: (
			delivered: string,
			scheduled: string,
			silent: string | null,
		) => string;
		/** Plain caption under the typical-delay (p50) tile. */
		readonly p50Caption: string;
		/** Plain caption under the worst-case (p90) tile. */
		readonly p90Caption: string;
		/** Heading for the typical→worst-case (p50→p90) delay distribution mark. */
		readonly delayDistHeading: string;
		/** Accessible / axis label for the delay distribution mark. */
		readonly delayDistLabel: string;
		/** Plain caption under the distribution (what the median line + tail mean). */
		readonly delayDistCaption: string;
		/** Nudge when the day grain has no percentile distribution (only week/month do). */
		readonly percentileNudge: string;
		/** Dedicated severe-delay-share label (NOT p90 — its own metric). */
		readonly severePct: string;
		/** Caption for the severe-share block (what the share counts). */
		readonly severeCaption: string;
		/** Heading for the weakest-stops accountability list. */
		readonly weakStopsHeading: string;
		/** a11y label for the worst-N (how-many-stops) selector. */
		readonly worstNLabel: string;
		/** §4 windowed value-axis title: the severe-delay rate the bar encodes (a share, [0,100]). */
		readonly severeRateLabel: string;
		/** Worst-N selector "All" segment (all served, <= the stored cap of 15). */
		readonly worstNAll: string;
		/** Per-row tooltip-note label words for the windowed §4 evidence (severe rate / avg / n). */
		readonly weakStopNote: {
			readonly severe: string;
			readonly avg: string;
			readonly samples: string;
		};
		/** Label for the per-stop Wilson 95% interval surfaced in the §4 tooltip + sr-only table. */
		readonly weakStopCi: string;
		/** Caption under the excess-wait magnitude (what 0 means). */
		readonly excessWaitCaption: string;
		/** Plain caption under the skipped-stop tile (what it counts). */
		readonly skippedStopCaption: string;
		/** Hint shown in the fixed chart readout before anything is hovered/focused. */
		readonly trendReadoutHint: string;
		/** Plain-language legend for the OTP Wilson confidence band + the 80% target rule. */
		readonly wilsonBandCaption: string;
		/** Ramp-in caveat shown on no-backfill metrics/sections. */
		readonly rampInNote: string;
		/** Explicit empty-state note for a metric/band with no data yet. */
		readonly noDataNote: string;
		/** Short value-level no-data label for a single absent metric tile. */
		readonly noData: string;
		/** Plain-language reading of the headway CoV (a regular/irregular caption, not a raw number dump). */
		readonly regularity: {
			readonly regular: string;
			readonly irregular: string;
		};
	};
	/** Per-band "when?" window captions — rendered under each band's primary label. */
	readonly windows: {
		/** Punctuality trend window. */
		readonly trend: string;
		/** Trend caption when the x-axis is the daily series (week / month / range grain). */
		readonly trendByDay: string;
		/** Trend caption when the x-axis is the 5 time-of-day shifts (day grain). */
		readonly trendByTimeOfDay: string;
		/** Crowding (occupancy mix) window. */
		readonly crowding: string;
		/** Weak-stops aggregate window. */
		readonly weakStops: string;
		/** Habits heatmap + day-of-week accumulation window. */
		readonly habits: string;
		/**
		 * Service-span window — a single latest closed day, dated. `date` is the
		 * row's ISO date; an absent date falls back to the un-dated phrase.
		 */
		readonly serviceSpan: (date: string | null) => string;
	};
	/** Peak vs off-peak ("by time of day") block labels. */
	readonly peak: {
		/** Block heading. */
		readonly heading: string;
		/** Day-type sub-heading (weekday vs weekend). */
		readonly dayType: string;
		/** Day-of-week severe-share label (the DoW block's second value). */
		readonly dayOfWeekSevere: string;
		/** Honest caveat for the trailing-window observation-weighted proxy. */
		readonly caveat: string;
		/** Day-type raw-grain → readable label. */
		readonly weekday: string;
		readonly weekend: string;
		/** Cleveland strip-plot labels for the per-shift severe-share dot plot. */
		readonly strip: {
			/** Whole-strip accessible summary (figure aria-label). */
			readonly ariaLabel: string;
			/** All-day mean reference rule label, interpolated with the formatted mean. */
			readonly mean: (value: string) => string;
		};
	};
	/** Per-ISO-weekday occupancy small-multiple (P11) — in the 04 Crowding band. */
	readonly byDow: {
		/** Sub-block overline. */
		readonly heading: string;
		/** Plain caption under the Mon→Sun strips (what each strip reads). */
		readonly caption: string;
	};
	/** Delay-by-crowding sub-block (in the 04 Crowding band) labels. */
	readonly delayByCrowding: {
		/** Sub-block overline. */
		readonly heading: string;
		/** Secondary typical-delay caption appended to a band's avg delay (obs-weighted mean of daily band medians, not a pooled percentile; e.g. "typical 0.4 min"). */
		readonly typical: (p50: string) => string;
		/** Honest empty note when no per-band delay data exists at all. */
		readonly empty: string;
	};
	/** By-shift-and-day-type OTP crosstab — now a stepped heatmap (01 Punctuality). */
	readonly crosstab: {
		/** Section overline. */
		readonly heading: string;
		/** Accessible header for the (visually-blank) shift corner cell. */
		readonly shiftHeader: string;
		/** Accessible header for the day-type column axis. */
		readonly dayTypeHeader: string;
		/** Honest caption under the grid (what the cells read + the no-data convention). */
		readonly caption: string;
		/** Whole-grid accessible summary (role=img label). */
		readonly heatmapLabel: string;
		/** The colour-scale legend buckets (sequential low→high OTP) + the no-data swatch. */
		readonly legend: {
			readonly low: string;
			readonly mid: string;
			readonly high: string;
			readonly noData: string;
		};
		/** Annotation for the strongest (highest-OTP) trusted cell. */
		readonly hottest: string;
		/** Tooltip observation-count prefix, e.g. "n=420". */
		readonly obs: (n: number) => string;
		/** Honest reason a cell is greyed: too few observations to trust (n<30). */
		readonly lowSample: string;
	};
	/** Plain-language microcopy for the wait-regularity terms. */
	readonly regularityTerms: {
		readonly scheduledGap: string;
		readonly observedGap: string;
		readonly excessWait: string;
		readonly spread: string;
		readonly clumped: string;
		/** Plain-language "what is bunching + how to read this" explainer for §2. */
		readonly bunchingHelp: string;
	};
	/** Service-span first→last timeline (in the 02 Wait & regularity band). */
	readonly serviceSpanTimeline: {
		/** Sub-block / chart heading. */
		readonly heading: string;
		/** Accessible summary for the whole timeline figure. */
		readonly ariaLabel: (first: string, last: string) => string;
		/** Label for the first-departure endpoint. */
		readonly firstTrip: string;
		/** Label for the last-departure endpoint. */
		readonly lastTrip: string;
		/** Span-length annotation (e.g. "Span 18h 30m"); `len` is the formatted duration. */
		readonly span: (len: string) => string;
		/** Trip-count annotation (e.g. "142 trips"); `n` is the formatted count. */
		readonly trips: (n: string) => string;
		/** a11y prefix for the first-trip punctuality marker. */
		readonly firstDelay: string;
		/** a11y prefix for the last-trip punctuality marker. */
		readonly lastDelay: string;
		/** Plain caption under the timeline (what early/late at each end means). */
		readonly caption: string;
	};
	/** Unit suffixes appended to chart tick + tooltip values (axis metadata). */
	readonly units: {
		readonly pct: string;
		readonly min: string;
	};
	/** Comparison-vs-prior (PR-WEB-3): the period-over-period Δ badges + their headings. */
	readonly priorDelta: {
		/** Heading for the on-time-by-time-of-day comparison (§1). */
		readonly onTimeHeading: string;
		/** Heading for the wait-by-shift comparison (§2). */
		readonly waitHeading: string;
		/** Trailing context for a SIGNIFICANT change, by resolved window grain. */
		readonly vsPrior: { readonly day: string; readonly week: string; readonly month: string };
		/** Neutral marker when a change exists but doesn't clear the 95% test. */
		readonly withinNoise: string;
		/** Honest-absence marker when there is no prior window to compare, by grain. */
		readonly noPrior: { readonly day: string; readonly week: string; readonly month: string };
		/** a11y nouns woven into the change label so it reads in full. */
		readonly onTimeNoun: string;
		readonly waitNoun: string;
		/** Unit suffix for the on-time points delta (plural) + the ±1 singular form. */
		readonly pts: string;
		readonly ptOne: string;
		/** One-line caption: what the comparison is + the significance gate. */
		readonly caption: string;
	};
	/** Grain control-spine labels + the active-window caption. */
	readonly controls: {
		/** ControlsRail group overline ("View" / "Vue") — same voice as /stop + /network. */
		readonly viewLabel: string;
		/** Accessible label for the grain radiogroup itself. */
		readonly grainLabel: string;
		readonly today: string;
		readonly thisWeek: string;
		readonly thisMonth: string;
		/** Segment label that opens the start+end date-range affordance. */
		readonly dateRange: string;
		readonly clearDates: string;
		/** Field label for the range START date input. */
		readonly rangeStart: string;
		/** Field label for the range END date input. */
		readonly rangeEnd: string;
		/** Active-window caption rendered under the control spine. */
		readonly activeWindow: {
			readonly day: string;
			readonly week: string;
			readonly month: string;
			/** Single-day range window — `date` is the one picked ISO date. */
			readonly singleDay: (date: string) => string;
			/**
			 * Multi-day range window — `n` in-range days from `start` to `end`. Names
			 * the aggregate explicitly so the averaged headline is never mistaken for a
			 * single exact reading. No em dash; "to" joins the bounds.
			 */
			readonly range: (n: number, start: string, end: string) => string;
			/** Multi-day selected window before a contributing-day count is available. */
			readonly rangeSelection: (start: string, end: string) => string;
			/** Prompt before a complete range is picked. */
			readonly rangePrompt: string;
		};
		/** Section-TOC heading (wayfinding) in the sticky rail + the mobile TOC pill. */
		readonly toc: string;
		/** a11y: open/close the mobile grain filter pill drawer. */
		readonly filterPillOpen: string;
		readonly filterPillClose: string;
		/** a11y: close the mobile section-jump (TOC) pill drawer. */
		readonly tocPillClose: string;
	};
	readonly history: {
		readonly navigator: import('$lib/components/surface/HistoryNavigator.svelte').HistoryNavigatorLabels;
		readonly coverage: (from: string, to: string) => string;
		readonly selection: (from: string, to: string) => string;
		readonly correction: Record<import('$lib/v1').HistoryCorrection['reason'], string>;
		readonly partial: string;
		readonly noData: string;
		readonly currentOnly: string;
		readonly headerCurrentOnly: string;
		readonly loading: string;
		readonly ready: string;
		readonly error: string;
		readonly retry: string;
	};
	/**
	 * Rider-question section framing (the 5-section rider-first IA): each section's
	 * short overline `label` + the plain-language `question` it answers, plus the
	 * progressive-disclosure expander labels.
	 */
	readonly sections: {
		readonly verdict: {
			readonly label: string;
			readonly question: string;
			/** D3: the TerminalPanel framing the §0 verdict block. */
			readonly terminal: { readonly title: string; readonly tag: string };
		};
		readonly whenToRide: { readonly label: string; readonly question: string };
		readonly theWait: { readonly label: string; readonly question: string };
		readonly runAndFit: { readonly label: string; readonly question: string };
		readonly worstStops: { readonly label: string; readonly question: string };
		/** Progressive-disclosure expander labels (the analyst "Show the detail" layer). */
		readonly detailShow: string;
		readonly detailHide: string;
	};
	/** §0 plain-language reliability verdict (text-led, two-sided, numerically hedged). */
	readonly verdict: VerdictCopy;
}

export const reliabilityCopy: Record<Locale, ReliabilityCopy> = {
	fr: {
		clusters: {
			punctuality: 'Ponctualité',
			serviceDelivered: 'Service assuré',
			crowding: 'Encombrement',
			waitRegularity: 'Régularité des attentes',
			habits: 'Habitudes horaires',
		},
		strip: {
			snapshotLabel: 'Aperçu de la fiabilité',
			otpPct: 'Ponctualité',
			target: 'Cible',
			avgDelayMin: 'Retard moyen',
			p50Min: 'Retard médian',
			p90Min: 'Pire des cas',
			headwayRegularityCov: 'Régularité (CV)',
			cancellationRatePct: "Taux d'annulation",
			skippedStopRatePct: "Taux d'arrêts ignorés",
			serviceCompletenessPct: 'Service prévu assuré',
			cancellationFraction: (c, total) => `${c} annulés sur ${total} jours-trajets`,
			skippedFraction: (s, total) => `${s} ignorés sur ${total} mises à jour d'arrêt`,
			serviceCompletenessFraction: (delivered, scheduled, silent) =>
				`${delivered} sur ${scheduled} jours-trajets prévus assurés${
					silent == null ? '' : ` · ${silent} silencieux`
				}`,
			p50Caption: 'La moitié des trajets font mieux, la moitié font pire',
			p90Caption: '9 trajets sur 10 sont plus rapides que ça',
			delayDistHeading: 'Du retard médian au pire des cas',
			delayDistLabel: 'Retard, de tôt à tard (min)',
			delayDistCaption:
				'Chaque barre est la part des trajets à ce retard (en avance à gauche de 0, à l’heure à 0, en retard à droite); plus c’est haut, plus il y a de trajets. Les lignes marquent le médian et le pire des cas (9 trajets sur 10 font mieux). Échelle fixe de -5 à +30 min.',
			percentileNudge:
				'Pas assez de trajets aujourd’hui pour l’écart typique → pire cas. Choisissez « Cette semaine » ou « Ce mois-ci » ci-dessus pour le voir.',
			severePct: 'Part des retards graves',
			severeCaption: 'Proportion de passages en retard grave',
			weakStopsHeading: 'Les arrêts les plus en retard',
			worstNLabel: 'Arrêts affichés',
			severeRateLabel: 'Taux de retard grave',
			worstNAll: 'Tous',
			weakStopNote: { severe: 'grave', avg: 'moy.', samples: 'n' },
			weakStopCi: 'IC 95 %',
			excessWaitCaption: '0 = le service respecte (ou dépasse) sa fréquence prévue',
			skippedStopCaption: 'Arrêts non desservis',
			trendReadoutHint: 'Survolez ou tabulez le graphique pour lire chaque jour',
			wilsonBandCaption:
				'La bande ombrée : on est sûr à 95 % que le vrai taux de ponctualité s’y trouve (plus la bande est large, moins l’échantillon est grand). Ligne pointillée : cible de 80 %.',
			rampInNote: 'Nouveau, on compte depuis peu, donc le chiffre se précise avec le temps',
			noDataNote: 'Aucune donnée',
			noData: 'sans données',
			regularity: {
				regular: 'Passages réguliers',
				irregular: 'Passages irréguliers',
			},
		},
		windows: {
			trend: '30 derniers jours',
			trendByDay: 'Par jour',
			trendByTimeOfDay: 'Par moment de la journée',
			crowding: '30 derniers jours',
			weakStops: 'Cumul hebdomadaire',
			habits: 'Toutes les données accumulées',
			serviceSpan: (date) =>
				date ? `Dernière journée de service · ${date}` : 'Dernière journée de service',
		},
		peak: {
			heading: 'Par période de la journée',
			dayType: 'Semaine vs fin de semaine',
			dayOfWeekSevere: 'Part des retards graves',
			caveat:
				'Estimation sur fenêtre glissante, pondérée par les observations, pas une ponctualité certifiée; les petits échantillons varient.',
			weekday: 'Semaine',
			weekend: 'Fin de semaine',
			strip: {
				ariaLabel: 'Retards graves par période',
				mean: (value) => `Moyenne journée : ${value}`,
			},
		},
		byDow: {
			heading: 'Encombrement par jour de la semaine',
			caption:
				"Répartition de l'occupation pour chaque jour, du lundi au dimanche. Un jour sans télémétrie le dit clairement plutôt que d'inventer une barre.",
		},
		delayByCrowding: {
			heading: "Retard selon l'occupation",
			typical: (p50) => `typique ${p50}`,
			empty: 'Aucune donnée de retard par occupation',
		},
		crosstab: {
			heading: 'Par période et type de jour',
			shiftHeader: 'Période',
			dayTypeHeader: 'Type de jour',
			caption:
				'Ponctualité (% à l’heure) par période de la journée et type de jour, sur une échelle fixe de 0 à 100 %. Une cellule avec moins de 30 observations est grisée; jamais un zéro inventé.',
			heatmapLabel: 'Ponctualité par période et type de jour',
			legend: {
				low: 'Faible (0–40 %)',
				mid: 'Moyenne (40–80 %)',
				high: 'Élevée (80–100 %)',
				noData: 'Sans données',
			},
			hottest: 'Meilleure ponctualité',
			obs: (n) => `n=${n}`,
			lowSample: 'moins de 30 observations',
		},
		regularityTerms: {
			scheduledGap: 'Intervalle prévu',
			observedGap: 'Intervalle observé',
			excessWait: 'Attente excédentaire',
			spread: 'Régularité (CV)',
			clumped: 'Bus collés',
			bunchingHelp:
				'Les bus devraient être espacés régulièrement. « Bus collés » = deux arrivent presque ensemble, puis un long trou : votre attente réelle dépasse alors l’horaire. Chaque ligne va de l’intervalle prévu (●) à l’intervalle observé (●) ; plus l’écart est grand, plus l’attente est longue.',
		},
		serviceSpanTimeline: {
			heading: 'Plage de service',
			ariaLabel: (first, last) =>
				`Plage de service, du premier départ à ${first} au dernier à ${last}`,
			firstTrip: 'Premier départ',
			lastTrip: 'Dernier départ',
			span: (len) => `Durée ${len}`,
			trips: (n) => `${n} voyages`,
			firstDelay: 'Retard du premier départ',
			lastDelay: 'Retard du dernier départ',
			caption:
				"De l'heure du premier départ à celle du dernier sur une journée de 24 h. Le repère à chaque extrémité indique l'avance (▼) ou le retard (▲) du départ; ▲ signale un retard, jamais une absence de donnée.",
		},
		units: { pct: '%', min: ' min' },
		priorDelta: {
			onTimeHeading: 'Ponctualité par période',
			waitHeading: 'Attente par période',
			vsPrior: {
				day: 'p/r à la veille',
				week: 'p/r à la sem. préc.',
				month: 'p/r au mois préc.',
			},
			withinNoise: 'écart non significatif',
			noPrior: {
				day: 'pas de veille',
				week: 'pas de semaine précédente',
				month: 'pas de mois précédent',
			},
			onTimeNoun: 'ponctualité',
			waitNoun: 'attente',
			pts: 'pts',
			ptOne: 'pt',
			caption:
				'Écart par rapport à la fenêtre précédente, affiché seulement s’il passe un test de signification à 95 %; une variation dans le bruit reste neutre.',
		},
		controls: {
			viewLabel: 'Vue',
			grainLabel: 'Granularité',
			today: "Aujourd'hui",
			thisWeek: 'Cette semaine',
			thisMonth: 'Ce mois-ci',
			dateRange: 'Plage de dates',
			clearDates: 'Effacer les dates',
			rangeStart: 'Du',
			rangeEnd: 'Au',
			activeWindow: {
				day: "Fenêtre : aujourd'hui (dernière journée close)",
				week: 'Fenêtre : cette semaine (semaine la plus récente)',
				month: 'Fenêtre : ce mois-ci (mois le plus récent)',
				singleDay: (date) => `Fenêtre : ${date}`,
				range: (n, start, end) =>
					`Moyenne sur ${n} ${n === 1 ? 'jour' : 'jours'}, du ${start} au ${end}`,
				rangeSelection: (start, end) => `Fenêtre : du ${start} au ${end}`,
				rangePrompt: 'Fenêtre : choisissez une date de début et de fin',
			},
			toc: 'Aller à une section',
			filterPillOpen: 'Ouvrir les commandes de vue',
			filterPillClose: 'Fermer les commandes de vue',
			tocPillClose: 'Fermer la liste des sections',
		},
		history: {
			navigator: {
				group: 'Historique de fiabilité de la ligne',
				picker: {
					group: 'Plage de dates',
					start: 'Du',
					end: 'Au',
					clear: 'Revenir au portrait actuel',
					anyStart: 'Première date',
					anyEnd: 'Dernière date',
				},
				previous: 'Plage précédente',
				next: 'Plage suivante',
			},
			coverage: (from, to) => `Historique disponible du ${from} au ${to}.`,
			selection: (from, to) => `Plage choisie : du ${from} au ${to}.`,
			correction: {
				malformed: 'La plage invalide a été remplacée par le portrait actuel.',
				'outside-coverage': 'La plage non disponible a été remplacée par le portrait actuel.',
				gap: 'La plage traverse une lacune dans les données conservées.',
				unpublished: 'La plage non publiée a été remplacée par le portrait actuel.',
			},
			partial: 'Cette plage ne couvre qu’une partie des mesures conservées.',
			noData: 'Aucune donnée conservée pour cette plage.',
			currentOnly:
				'Les habitudes, les attentes, les pires arrêts et les associations restent basés sur le portrait actuel.',
			headerCurrentOnly: 'Verdict d’en-tête : portrait actuel',
			loading: 'Chargement de la plage conservée…',
			ready: 'Plage conservée chargée.',
			error: 'Impossible de charger cette plage conservée.',
			retry: 'Réessayer',
		},
		sections: {
			verdict: {
				label: 'Fiabilité',
				question: 'Peut-on compter sur cette ligne ?',
				terminal: { title: 'verdict', tag: 'FIABILITÉ' },
			},
			whenToRide: {
				label: 'Quand voyager',
				question: 'Quand est-ce fiable, et quand ça se gâte ?',
			},
			theWait: {
				label: "L'attente",
				question: 'Combien de temps faut-il attendre, et les bus sont-ils collés ?',
			},
			runAndFit: {
				label: 'Service et place',
				question: 'Le bus passe-t-il, et y aura-t-il de la place ?',
			},
			worstStops: { label: 'Les pires arrêts', question: 'Où le retard s’accumule-t-il ?' },
			detailShow: 'Voir le détail',
			detailHide: 'Masquer le détail',
		},
		verdict: {
			windowPhrase: {
				day: "aujourd'hui",
				week: 'cette semaine',
				month: 'ce mois-ci',
				range: 'sur les jours choisis',
			},
			reliable: ({ window, onTen, lateTen, hedge }) =>
				`Service fiable ${window}, environ ${onTen} trajets sur 10 à l'heure${hedge}; ${lateTen} sur 10 en retard.`,
			patchy: ({ window, onTen, lateTen, hedge }) =>
				`Service inégal ${window}, environ ${onTen} trajets sur 10 à l'heure${hedge}; ${lateTen} sur 10 en retard.`,
			unreliable: ({ window, onTen, lateTen, hedge }) =>
				`Service peu fiable ${window}, seulement ${onTen} trajets sur 10 à l'heure${hedge}; ${lateTen} sur 10 en retard.`,
			tentative: ({ window, otp, n, lo, hi }) =>
				`Trop peu de trajets ${window} pour être certain, ${otp} % de ${n} trajets suivis à l'heure (probablement ${lo}–${hi} %).`,
			tooFew: (window, n) =>
				`Mesure en cours ${window}, seulement ${n} trajets suivis jusqu'ici, pas assez pour juger la fiabilité.`,
			absent:
				"Mesure en cours, aucun trajet suivi pour l'instant, impossible de juger la fiabilité.",
			hedgeSimple: (otp) => ` (${otp} %)`,
			hedgeCI: (otp, lo, hi) => ` (${otp} %, sûr à 95 % entre ${lo} et ${hi} %)`,
		},
	},
	en: {
		clusters: {
			punctuality: 'Punctuality',
			serviceDelivered: 'Service delivered',
			crowding: 'Crowding',
			waitRegularity: 'Wait regularity',
			habits: 'Time-of-day habits',
		},
		strip: {
			snapshotLabel: 'Reliability snapshot',
			otpPct: 'On-time',
			target: 'Target',
			avgDelayMin: 'Avg delay',
			p50Min: 'Typical delay',
			p90Min: 'Worst-case delay',
			headwayRegularityCov: 'Regularity (CoV)',
			cancellationRatePct: 'Cancellation rate',
			skippedStopRatePct: 'Skipped-stop rate',
			serviceCompletenessPct: 'Scheduled service delivered',
			cancellationFraction: (c, total) => `${c} of ${total} trip-days canceled`,
			skippedFraction: (s, total) => `${s} of ${total} stop updates skipped`,
			serviceCompletenessFraction: (delivered, scheduled, silent) =>
				`${delivered} of ${scheduled} scheduled trip-days delivered${
					silent == null ? '' : ` · ${silent} silent`
				}`,
			p50Caption: 'Half of trips do better, half do worse',
			p90Caption: '9 in 10 trips are better than this',
			delayDistHeading: 'From typical to worst-case delay',
			delayDistLabel: 'Delay, early to late (min)',
			delayDistCaption:
				'Each bar is the share of trips at that delay (early left of 0, on time at 0, late right); taller means more trips there. The reference lines mark the typical (median) and the worst case (9 in 10 trips do better). Fixed -5 to +30 min scale.',
			percentileNudge:
				'Not enough trips today for the typical→worst-case spread. Pick “This week” or “This month” above to see it.',
			severePct: 'Severe-delay share',
			severeCaption: 'Share of arrivals that ran severely late',
			weakStopsHeading: 'The stops with the most delay',
			worstNLabel: 'Stops shown',
			severeRateLabel: 'Severe-delay rate',
			worstNAll: 'All',
			weakStopNote: { severe: 'severe', avg: 'avg', samples: 'n' },
			weakStopCi: '95% CI',
			excessWaitCaption: '0 = runs on schedule (met or beat its planned frequency)',
			skippedStopCaption: "Stops the bus didn't serve",
			trendReadoutHint: 'Hover or tab the chart to read each day',
			wilsonBandCaption:
				'Shaded band: we’re 95% sure the true on-time rate sits inside it (a wider band = a smaller sample). Dashed line: the 80% target.',
			rampInNote: 'New metric, we just started counting, so this number sharpens over time',
			noDataNote: 'No data yet',
			noData: 'no data',
			regularity: {
				regular: 'Regular arrivals',
				irregular: 'Irregular arrivals',
			},
		},
		windows: {
			trend: 'Last 30 days',
			trendByDay: 'By day',
			trendByTimeOfDay: 'By time of day',
			crowding: 'Last 30 days',
			weakStops: 'Weekly aggregate',
			habits: 'All accrued data',
			serviceSpan: (date) => (date ? `Latest service day · ${date}` : 'Latest service day'),
		},
		peak: {
			heading: 'By time of day',
			dayType: 'Weekday vs weekend',
			dayOfWeekSevere: 'Severe-delay share',
			caveat:
				'Trailing-window, observation-weighted estimate, not certified on-time; small samples vary.',
			weekday: 'Weekday',
			weekend: 'Weekend',
			strip: {
				ariaLabel: 'Severe delay by time of day',
				mean: (value) => `All-day mean: ${value}`,
			},
		},
		byDow: {
			heading: 'Crowding by day of week',
			caption:
				'How occupancy splits on each day, Monday through Sunday. A day with no telemetry says so plainly instead of fabricating a bar.',
		},
		delayByCrowding: {
			heading: 'Delay by crowding',
			typical: (p50) => `typical ${p50}`,
			empty: 'No delay-by-crowding data yet',
		},
		crosstab: {
			heading: 'By shift and day type',
			shiftHeader: 'Shift',
			dayTypeHeader: 'Day type',
			caption:
				'On-time rate (%) by time of day and day type, on a fixed 0–100% scale. A cell with fewer than 30 observations is greyed out, never a fabricated zero.',
			heatmapLabel: 'On-time rate by shift and day type',
			legend: {
				low: 'Low (0–40%)',
				mid: 'Medium (40–80%)',
				high: 'High (80–100%)',
				noData: 'No data',
			},
			hottest: 'Best on-time rate',
			obs: (n) => `n=${n}`,
			lowSample: 'fewer than 30 observations',
		},
		regularityTerms: {
			scheduledGap: 'Scheduled gap',
			observedGap: 'Observed gap',
			excessWait: 'Excess wait',
			spread: 'Spread (CoV)',
			clumped: 'Clumped (bunched)',
			bunchingHelp:
				'Buses should be evenly spaced. “Bunching” = two arrive nose-to-tail, then a long gap, so your real wait runs longer than the schedule implies. Each row runs from the scheduled gap (●) to the observed gap (●); the wider that span, the longer the wait.',
		},
		serviceSpanTimeline: {
			heading: 'Service span',
			ariaLabel: (first, last) =>
				`Service span, from the first trip at ${first} to the last at ${last}`,
			firstTrip: 'First trip',
			lastTrip: 'Last trip',
			span: (len) => `Span ${len}`,
			trips: (n) => `${n} trips`,
			firstDelay: 'First-trip delay',
			lastDelay: 'Last-trip delay',
			caption:
				'From the first departure clock time to the last across a 24-hour day. The marker at each end shows that departure running early (▼) or late (▲); ▲ is a real delay, never missing data.',
		},
		units: { pct: '%', min: ' min' },
		priorDelta: {
			onTimeHeading: 'On-time by time of day',
			waitHeading: 'Wait by shift',
			vsPrior: {
				day: 'vs prior day',
				week: 'vs prior week',
				month: 'vs prior month',
			},
			withinNoise: 'within noise',
			noPrior: {
				day: 'no prior day',
				week: 'no prior week',
				month: 'no prior month',
			},
			onTimeNoun: 'on-time',
			waitNoun: 'wait',
			pts: 'pts',
			ptOne: 'pt',
			caption:
				'Change vs the immediately prior window, shown only when it clears a 95% significance test, so a swing within noise never shouts.',
		},
		controls: {
			viewLabel: 'View',
			grainLabel: 'Granularity',
			today: 'Today',
			thisWeek: 'This week',
			thisMonth: 'This month',
			dateRange: 'Date range',
			clearDates: 'Clear dates',
			rangeStart: 'From',
			rangeEnd: 'To',
			activeWindow: {
				day: 'Window: today (latest closed day)',
				week: 'Window: this week (most recent week)',
				month: 'Window: this month (most recent month)',
				singleDay: (date) => `Window: ${date}`,
				range: (n, start, end) =>
					`Average across ${n} ${n === 1 ? 'day' : 'days'}, ${start} to ${end}`,
				rangeSelection: (start, end) => `Window: ${start} to ${end}`,
				rangePrompt: 'Window: pick a start and end date',
			},
			toc: 'Jump to a section',
			filterPillOpen: 'Open view controls',
			filterPillClose: 'Close view controls',
			tocPillClose: 'Close section list',
		},
		history: {
			navigator: {
				group: 'Line reliability history',
				picker: {
					group: 'Date range',
					start: 'From',
					end: 'To',
					clear: 'Return to current snapshot',
					anyStart: 'First date',
					anyEnd: 'Last date',
				},
				previous: 'Previous range',
				next: 'Next range',
			},
			coverage: (from, to) => `History available from ${from} to ${to}.`,
			selection: (from, to) => `Selected range: ${from} to ${to}.`,
			correction: {
				malformed: 'The invalid date range was replaced with the current snapshot.',
				'outside-coverage': 'The unavailable date range was replaced with the current snapshot.',
				gap: 'The selected range crosses a gap in retained data.',
				unpublished: 'The unpublished date range was replaced with the current snapshot.',
			},
			partial: 'This range has only partial retained metric coverage.',
			noData: 'No data is retained for this range.',
			currentOnly:
				'Habits, wait regularity, worst stops, and associations still use the current snapshot.',
			headerCurrentOnly: 'Header verdict: current snapshot',
			loading: 'Loading retained range…',
			ready: 'Retained range loaded.',
			error: 'This retained range could not be loaded.',
			retry: 'Retry',
		},
		sections: {
			verdict: {
				label: 'Reliability',
				question: 'Can you count on this line?',
				terminal: { title: 'verdict', tag: 'RELIABILITY' },
			},
			whenToRide: {
				label: 'When to ride',
				question: 'When is it good, and when does it fall apart?',
			},
			theWait: { label: 'The wait', question: 'How long will you wait, and do buses bunch?' },
			runAndFit: { label: 'Service & space', question: 'Will the bus run, and will you fit?' },
			worstStops: { label: "Where it's worst", question: 'Where does the delay pile up?' },
			detailShow: 'Show the detail',
			detailHide: 'Hide the detail',
		},
		verdict: {
			windowPhrase: {
				day: 'today',
				week: 'this week',
				month: 'this month',
				range: 'over the selected days',
			},
			reliable: ({ window, onTen, lateTen, hedge }) =>
				`Ran reliably ${window}, about ${onTen} in 10 trips on time${hedge}; ${lateTen} in 10 ran late.`,
			patchy: ({ window, onTen, lateTen, hedge }) =>
				`Ran unevenly ${window}, about ${onTen} in 10 trips on time${hedge}; ${lateTen} in 10 ran late.`,
			unreliable: ({ window, onTen, lateTen, hedge }) =>
				`Ran unreliably ${window}, only about ${onTen} in 10 trips on time${hedge}; ${lateTen} in 10 ran late.`,
			tentative: ({ window, otp, n, lo, hi }) =>
				`Too few trips ${window} to call it with confidence, ${otp}% of ${n} tracked trips on time (likely ${lo}–${hi}%).`,
			tooFew: (window, n) =>
				`Still measuring ${window}, only ${n} tracked trips so far, not enough to say how reliable this line is.`,
			absent: 'Still measuring, no tracked trips yet to say how reliable this line is.',
			hedgeSimple: (otp) => ` (${otp}%)`,
			hedgeCI: (otp, lo, hi) => ` (${otp}%, 95% sure between ${lo} and ${hi}%)`,
		},
	},
};

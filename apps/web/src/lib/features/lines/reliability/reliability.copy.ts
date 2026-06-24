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
		readonly avgDelayMin: string;
		/** Typical (median / p50) delay label — plain, not jargon. */
		readonly p50Min: string;
		/** Worst-case (p90) delay label — plain, not jargon. */
		readonly p90Min: string;
		readonly headwayRegularityCov: string;
		readonly cancellationRatePct: string;
		readonly skippedStopRatePct: string;
		/** Honest completeness fraction: "{canceled} of {total} trip-days canceled". */
		readonly cancellationFraction: (canceled: string, total: string) => string;
		/** Honest completeness fraction: "{skipped} of {total} stop updates skipped". */
		readonly skippedFraction: (skipped: string, total: string) => string;
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
		/** Dedicated severe-delay-share label (NOT p90 — its own metric). */
		readonly severePct: string;
		/** Caption for the severe-share block (what the share counts). */
		readonly severeCaption: string;
		/** Heading for the weakest-stops accountability list. */
		readonly weakStopsHeading: string;
		/** a11y label for the worst-N (how-many-stops) selector. */
		readonly worstNLabel: string;
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
	};
	/** Delay-by-crowding sub-block (in the 04 Crowding band) labels. */
	readonly delayByCrowding: {
		/** Sub-block overline. */
		readonly heading: string;
		/** Secondary p50 caption appended to a band's avg delay (e.g. "median 0.4 min"). */
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
	};
	/** Unit suffixes appended to chart tick + tooltip values (axis metadata). */
	readonly units: {
		readonly pct: string;
		readonly min: string;
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
			/** Prompt before a complete range is picked. */
			readonly rangePrompt: string;
		};
	};
}

export const reliabilityCopy: Record<Locale, ReliabilityCopy> = {
	fr: {
		clusters: {
			punctuality: '01 Ponctualité',
			waitRegularity: '02 Régularité des attentes',
			serviceDelivered: '03 Service assuré',
			crowding: '04 Encombrement',
			habits: '05 Habitudes horaires',
		},
		strip: {
			snapshotLabel: 'Aperçu de la fiabilité',
			otpPct: 'Ponctualité',
			avgDelayMin: 'Retard moyen',
			p50Min: 'Retard médian',
			p90Min: 'Pire des cas',
			headwayRegularityCov: 'Régularité (CV)',
			cancellationRatePct: "Taux d'annulation",
			skippedStopRatePct: "Taux d'arrêts ignorés",
			cancellationFraction: (c, total) => `${c} annulés sur ${total} jours-trajets`,
			skippedFraction: (s, total) => `${s} ignorés sur ${total} mises à jour d'arrêt`,
			p50Caption: 'La moitié des trajets font mieux, la moitié font pire',
			p90Caption: '9 trajets sur 10 sont plus rapides que ça',
			delayDistHeading: 'Du retard médian au pire des cas',
			delayDistLabel: 'Retard, du médian (p50) au pire des cas (p90)',
			delayDistCaption:
				'Le repère marque le retard médian; la barre s’étire jusqu’au pire des cas (9 trajets sur 10 font mieux). Échelle fixe de 0 à 15 min.',
			severePct: 'Part des retards graves',
			severeCaption: 'Proportion de passages en retard grave',
			weakStopsHeading: 'Les arrêts les plus en retard',
			worstNLabel: 'Arrêts affichés',
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
		},
		delayByCrowding: {
			heading: "Retard selon l'occupation",
			typical: (p50) => `médian ${p50}`,
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
		},
		units: { pct: '%', min: ' min' },
		controls: {
			viewLabel: 'Vue',
			grainLabel: 'Granularité',
			today: "Aujourd'hui",
			thisWeek: 'Cette semaine',
			thisMonth: 'Ce mois-ci',
			dateRange: 'Plage de dates',
			rangeStart: 'Du',
			rangeEnd: 'Au',
			activeWindow: {
				day: "Fenêtre : aujourd'hui (dernière journée close)",
				week: 'Fenêtre : cette semaine (semaine la plus récente)',
				month: 'Fenêtre : ce mois-ci (mois le plus récent)',
				singleDay: (date) => `Fenêtre : ${date}`,
				range: (n, start, end) => `Moyenne sur ${n} jours, du ${start} au ${end}`,
				rangePrompt: 'Fenêtre : choisissez une date de début et de fin',
			},
		},
	},
	en: {
		clusters: {
			punctuality: '01 Punctuality',
			waitRegularity: '02 Wait regularity',
			serviceDelivered: '03 Service delivered',
			crowding: '04 Crowding',
			habits: '05 Time-of-day habits',
		},
		strip: {
			snapshotLabel: 'Reliability snapshot',
			otpPct: 'On-time',
			avgDelayMin: 'Avg delay',
			p50Min: 'Typical delay',
			p90Min: 'Worst-case delay',
			headwayRegularityCov: 'Regularity (CoV)',
			cancellationRatePct: 'Cancellation rate',
			skippedStopRatePct: 'Skipped-stop rate',
			cancellationFraction: (c, total) => `${c} of ${total} trip-days canceled`,
			skippedFraction: (s, total) => `${s} of ${total} stop updates skipped`,
			p50Caption: 'Half of trips do better, half do worse',
			p90Caption: '9 in 10 trips are better than this',
			delayDistHeading: 'From typical to worst-case delay',
			delayDistLabel: 'Delay, from typical (p50) to worst-case (p90)',
			delayDistCaption:
				'The marker is the typical (median) delay; the bar stretches to the worst case (9 in 10 trips do better). Fixed 0–15 min scale.',
			severePct: 'Severe-delay share',
			severeCaption: 'Share of arrivals that ran severely late',
			weakStopsHeading: 'The stops with the most delay',
			worstNLabel: 'Stops shown',
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
		},
		delayByCrowding: {
			heading: 'Delay by crowding',
			typical: (p50) => `median ${p50}`,
			empty: 'No delay-by-crowding data yet',
		},
		crosstab: {
			heading: 'By shift and day type',
			shiftHeader: 'Shift',
			dayTypeHeader: 'Day type',
			caption:
				'On-time rate (%) by time of day and day type, on a fixed 0–100% scale. A cell with fewer than 30 observations is greyed out — never a fabricated zero.',
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
		},
		units: { pct: '%', min: ' min' },
		controls: {
			viewLabel: 'View',
			grainLabel: 'Granularity',
			today: 'Today',
			thisWeek: 'This week',
			thisMonth: 'This month',
			dateRange: 'Date range',
			rangeStart: 'From',
			rangeEnd: 'To',
			activeWindow: {
				day: 'Window: today (latest closed day)',
				week: 'Window: this week (most recent week)',
				month: 'Window: this month (most recent month)',
				singleDay: (date) => `Window: ${date}`,
				range: (n, start, end) => `Average across ${n} days, ${start} to ${end}`,
				rangePrompt: 'Window: pick a start and end date',
			},
		},
	},
};

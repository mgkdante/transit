// Cluster05Habits.copy.ts — band-intrinsic bilingual copy for the 05 Time-of-day
// habits band. The shared cluster overline + honest-state notes live in
// `reliability.copy.ts` (passed in as the ReliabilityCopy prop); the strings
// here are the ones only this band needs: weekday names, the heatmap a11y
// summary, the scale legend (low/high/no-data), and the two sub-section
// headings. FR is the canonical product voice; EN mirrors it.

import type { Locale } from '$lib/i18n';

export interface HabitsBandCopy {
	/** Heading above the time-of-day heatmap. */
	readonly heatmapHeading: string;
	/** Accessible summary for the heatmap (day × hour). */
	readonly heatmapLabel: string;
	/** Heading above the weekday-seasonality ranked list. */
	readonly weekdayHeading: string;
	/** Caption for a weekday row's mean-delay value. */
	readonly avgDelay: string;
	/** The weekday cycle plot — seven Mon→Sun panels of mean delay across weeks. */
	readonly cycle: {
		/** Whole-figure accessible summary (role=img label). */
		readonly ariaLabel: string;
		/** Per-panel mean-delay label, interpolated with the formatted mean. */
		readonly mean: (value: string) => string;
		/** Severe-delay-share label, interpolated with the formatted share. */
		readonly severe: (value: string) => string;
		/** Observation-count prefix, e.g. "n=420". */
		readonly obs: (n: number) => string;
		/** Steepest-trend annotation, given the weekday name + the signed delta. */
		readonly steepest: (day: string, delta: string) => string;
		/**
		 * Plain caption beneath the cycle plot. `series` reads when the contract carries
		 * an across-weeks series per weekday (true cycle plot); `single` reads when it
		 * carries one value per weekday (the honest fixed-axis bar degrade).
		 */
		readonly captionSeries: string;
		readonly captionSingle: string;
	};
	/** X-axis caption (hours run left→right). */
	readonly hourAxisLabel: string;
	/** Y-axis caption (days run top→bottom). */
	readonly dayAxisLabel: string;
	/** Tooltip/SR row label — what a single cell encodes. */
	readonly cellValueLabel: string;
	/**
	 * Plain-language caption beneath the heatmap explaining the scale + how to read the
	 * colour. Pairs with the resolved `scaleLegend` phrase.
	 */
	readonly scaleCaption: string;
	/**
	 * RAW scale string (RouteHabits.scale) → a plain-language phrase for the
	 * caption. The snake_case scale value is NEVER shown to a layperson; an
	 * unmapped/null scale falls back to `heatmapHeading`.
	 */
	readonly scaleLegend: Readonly<Record<string, string>>;
	/**
	 * The CLASSED tiers (S7 P4): four plain-language labels calmest→worst, the no-data
	 * label, and the glyph stamped on the worst tier (colour is never the sole channel).
	 */
	readonly tiers: {
		readonly labels: readonly [string, string, string, string];
		readonly noData: string;
		readonly worstGlyph: string;
	};
	/** Full weekday names, ISO-indexed (index 0 unused; 1=Mon..7=Sun). */
	readonly weekdays: readonly [string, string, string, string, string, string, string, string];
	/** Heatmap row labels, Mon..Sun (length 7, in row order). */
	readonly weekdaysShort: readonly [string, string, string, string, string, string, string];
}

export const habitsBandCopy: Record<Locale, HabitsBandCopy> = {
	fr: {
		heatmapHeading: 'Problèmes récurrents par heure',
		heatmapLabel: 'Carte thermique des problèmes par jour et par heure',
		weekdayHeading: 'Par jour de la semaine',
		avgDelay: 'Retard moyen',
		cycle: {
			ariaLabel: 'Graphique cyclique du retard moyen par jour de la semaine, du lundi au dimanche',
			mean: (value) => `Moyenne ${value}`,
			severe: (value) => `Graves ${value}`,
			obs: (n) => `n=${n}`,
			steepest: (day, delta) => `Plus forte variation : ${day} (${delta})`,
			captionSeries:
				'Un panneau par jour, du lundi au dimanche, sur une échelle de retard fixe et partagée. La ligne pointillée marque la moyenne du jour; le losange indique la part des retards graves (n ≥ 5).',
			captionSingle:
				'Retard moyen par jour, du lundi au dimanche, sur une échelle de retard fixe et partagée. Un jour sans donnée est une rupture dans la ligne, jamais un zéro inventé.',
		},
		hourAxisLabel: 'Heure de la journée',
		dayAxisLabel: 'Jour de la semaine',
		cellValueLabel: 'Problèmes récurrents',
		scaleCaption:
			'Chaque case indique à quelle fréquence les retards graves reviennent à cette heure-là, sur toute la semaine et sur une seule échelle. Les cases encadrées et marquées d’un ◆ sont les pires heures de cette ligne; les cases pâles voient rarement un retard grave. Les fins de semaine plus calmes paraissent donc plus pâles, ce qui est honnête.',
		scaleLegend: {
			repeat_problem_relative: 'Problèmes récurrents (par rapport à la pire heure de la ligne)',
			severe_relative: 'Retards graves (par rapport à la pire heure de la ligne)',
		},
		// Plain-language reliability tiers, calmest → worst — they say what the colour MEANS
		// to a rider (how unreliable that hour is) and double as the cell + tooltip readout.
		tiers: {
			labels: ['Rarement en retard', 'Parfois en retard', 'Souvent en retard', 'Très peu fiable'],
			noData: 'Aucune donnée',
			worstGlyph: '◆',
		},
		weekdays: ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
		weekdaysShort: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
	},
	en: {
		heatmapHeading: 'Repeat problems by hour',
		heatmapLabel: 'Repeat-problem heatmap by day and hour',
		weekdayHeading: 'By day of week',
		avgDelay: 'Avg delay',
		cycle: {
			ariaLabel: 'Cycle plot of mean delay by day of week, Monday through Sunday',
			mean: (value) => `Mean ${value}`,
			severe: (value) => `Severe ${value}`,
			obs: (n) => `n=${n}`,
			steepest: (day, delta) => `Steepest swing: ${day} (${delta})`,
			captionSeries:
				'One panel per weekday, Monday→Sunday, on a shared fixed delay scale. The dashed line marks the day’s mean; the diamond shows the severe-delay share (n ≥ 5).',
			captionSingle:
				'Mean delay by weekday, Monday→Sunday, on a fixed shared delay scale. A day with no data is a gap in the line, never a fabricated zero.',
		},
		hourAxisLabel: 'Hour of day',
		dayAxisLabel: 'Day of week',
		cellValueLabel: 'Repeat problems',
		scaleCaption:
			'Each cell shows how often severe delays come back at that hour, across the whole week on one fixed scale. The outlined cells marked ◆ are this line’s worst hours; pale cells rarely see a severe delay. Calmer weekends therefore read paler, which is honest.',
		scaleLegend: {
			repeat_problem_relative: 'Repeat problems (vs this line’s worst hour)',
			severe_relative: 'Severe delays (vs this line’s worst hour)',
		},
		// Plain-language reliability tiers, calmest → worst — they say what the colour MEANS
		// to a rider (how unreliable that hour is) and double as the cell + tooltip readout.
		tiers: {
			labels: ['Rarely late', 'Sometimes late', 'Often late', 'Very unreliable'],
			noData: 'No data',
			worstGlyph: '◆',
		},
		weekdays: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
		weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
	},
};

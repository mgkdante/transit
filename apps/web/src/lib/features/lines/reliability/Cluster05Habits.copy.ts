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
	 * Plain-language caption beneath the heatmap explaining the relative scale +
	 * how to read the colour. Pairs with the resolved `scaleLegend` phrase.
	 */
	readonly scaleCaption: string;
	/**
	 * RAW scale string (RouteHabits.scale) → a plain-language phrase for the
	 * caption. The snake_case scale value is NEVER shown to a layperson; an
	 * unmapped/null scale falls back to `heatmapHeading`.
	 */
	readonly scaleLegend: Readonly<Record<string, string>>;
	/** Legend ramp buckets (low→high) + the dedicated no-data swatch. */
	readonly legend: {
		readonly low: string;
		readonly medium: string;
		readonly high: string;
		readonly noData: string;
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
			'La couleur indique à quelle fréquence les problèmes reviennent, comparée heure par heure au sein de chaque journée. Bleu = rarement un problème à cette heure-là; rouge = souvent. La comparaison se fait au sein de chaque jour, pas entre les jours.',
		scaleLegend: {
			repeat_problem_relative: 'Problèmes récurrents (relatif par jour)',
			severe_relative: 'Retards graves (relatif par jour)',
		},
		// Frequency words, not abstract "low/high" — they say what the colour MEANS to a
		// rider (how often a problem comes back at that hour) and double as the cell readout.
		legend: { low: 'Rarement', medium: 'Parfois', high: 'Souvent', noData: 'Aucune donnée' },
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
			'Colour shows how often problems come back, compared hour-by-hour within each day. Blue = rarely a problem at that hour; red = often. The comparison is within each day, not between days.',
		scaleLegend: {
			repeat_problem_relative: 'Repeat problems (relative per day)',
			severe_relative: 'Severe delays (relative per day)',
		},
		// Frequency words, not abstract "low/high" — they say what the colour MEANS to a
		// rider (how often a problem comes back at that hour) and double as the cell readout.
		legend: { low: 'Rarely', medium: 'Sometimes', high: 'Often', noData: 'No data' },
		weekdays: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
		weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
	},
};

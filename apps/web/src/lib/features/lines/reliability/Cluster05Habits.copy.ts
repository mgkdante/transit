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
		hourAxisLabel: 'Heure de la journée',
		dayAxisLabel: 'Jour de la semaine',
		cellValueLabel: 'Intensité',
		scaleCaption:
			'La couleur indique la fréquence des problèmes, comparée heure par heure au sein de chaque journée. Plus c’est chaud, plus le problème revient souvent.',
		scaleLegend: {
			repeat_problem_relative: 'Problèmes récurrents (relatif par jour)',
			severe_relative: 'Retards graves (relatif par jour)',
		},
		legend: { low: 'Faible', medium: 'Moyen', high: 'Élevé', noData: 'Aucune donnée' },
		weekdays: ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
		weekdaysShort: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
	},
	en: {
		heatmapHeading: 'Repeat problems by hour',
		heatmapLabel: 'Repeat-problem heatmap by day and hour',
		weekdayHeading: 'By day of week',
		avgDelay: 'Avg delay',
		hourAxisLabel: 'Hour of day',
		dayAxisLabel: 'Day of week',
		cellValueLabel: 'Intensity',
		scaleCaption:
			'Colour shows how often problems repeat, compared hour-by-hour within each day. Hotter = the problem comes back more often.',
		scaleLegend: {
			repeat_problem_relative: 'Repeat problems (relative per day)',
			severe_relative: 'Severe delays (relative per day)',
		},
		legend: { low: 'Low', medium: 'Medium', high: 'High', noData: 'No data' },
		weekdays: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
		weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
	},
};

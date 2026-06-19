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
	/** Legend ramp endpoints + the dedicated no-data swatch. */
	readonly legend: {
		readonly low: string;
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
		weekdayHeading: 'Saisonnalité hebdomadaire',
		avgDelay: 'Retard moyen',
		legend: { low: 'Faible', high: 'Élevé', noData: 'Aucune donnée' },
		weekdays: ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
		weekdaysShort: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
	},
	en: {
		heatmapHeading: 'Repeat problems by hour',
		heatmapLabel: 'Repeat-problem heatmap by day and hour',
		weekdayHeading: 'Weekday seasonality',
		avgDelay: 'Avg delay',
		legend: { low: 'Low', high: 'High', noData: 'No data' },
		weekdays: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
		weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
	},
};

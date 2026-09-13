// Cluster05Habits.copy.ts — band-intrinsic bilingual copy for the 05 Time-of-day
// habits band. The shared cluster overline + honest-state notes live in
// `reliability.copy.ts` (passed in as the ReliabilityCopy prop); the strings
// here are the ones only this band needs: weekday names, the heatmap a11y
// summary, the scale legend (low/high/no-data), and the two sub-section
// headings. FR is the canonical product voice; EN mirrors it.

import { defineCopy, type Locale } from '$lib/i18n/copy';

export const habitsBandCopy = defineCopy({
	fr: {
		heatmapHeading: 'Score relatif des problèmes par heure',
		heatmapLabel: 'Score relatif au sein de cette ligne, par jour et par heure',
		weekdayHeading: 'Par jour de la semaine',
		avgDelay: 'Retard moyen',
		cycle: {
			ariaLabel: 'Graphique cyclique du retard moyen par jour de la semaine, du lundi au dimanche',
			mean: (value: string) => `Moyenne ${value}`,
			severe: (value: string) => `Graves ${value}`,
			obs: (n: number) => `n=${n}`,
			steepest: (day: string, delta: string) => `Plus forte variation : ${day} (${delta})`,
			captionSeries:
				'Un panneau par jour, du lundi au dimanche, sur une échelle de retard fixe et partagée. La ligne pointillée marque la moyenne du jour; le losange indique la part des retards graves (n ≥ 5).',
			captionSingle:
				'Retard moyen par jour, du lundi au dimanche, sur une échelle de retard fixe et partagée. Un jour sans donnée est une rupture dans la ligne, jamais un zéro inventé.',
		},
		hourAxisLabel: 'Heure de la journée',
		dayAxisLabel: 'Jour de la semaine',
		cellValueLabel: 'Score relatif',
		scaleCaption:
			'Un même maximum normalise toutes les heures et journées de cette ligne. Une case pâle indique un score relatif plus faible. ◆ encadre les scores de 0,75 à 1 de ce maximum. Zéro signifie qu’un score nul est fourni; une case vide est indisponible. Ce score n’est ni une fréquence de retard ni un classement entre lignes.',
		heatmapWindowNote:
			'Cette grille utilise tout l’historique conservé disponible dans le portrait actuel de la ligne. Les choix de jour, semaine, mois ou plage de dates modifient d’autres graphiques; cette grille conserve le même historique.',
		relativePeak: (day: string, hour: string) =>
			`Un pic observé du score relatif de cette ligne : ${day}, ${hour}.`,
		scaleLegend: {
			repeat_problem_relative: 'Score composite normalisé au sein de cette ligne',
			severe_relative: 'Score de retards graves normalisé au sein de cette ligne',
		} as Readonly<Record<string, string>>,
		tiers: {
			labels: [
				'Score relatif faible',
				'Score relatif modéré',
				'Score relatif élevé',
				'Score relatif très élevé',
			] as const,
			worstGlyph: '◆',
		},
		weekdays: [
			'',
			'Lundi',
			'Mardi',
			'Mercredi',
			'Jeudi',
			'Vendredi',
			'Samedi',
			'Dimanche',
		] as const,
		weekdaysShort: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const,
	},
	en: {
		heatmapHeading: 'Relative problem score by hour',
		heatmapLabel: 'Relative score within this line, by day and hour',
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
		cellValueLabel: 'Relative score',
		scaleCaption:
			'One maximum normalizes every day and hour on this line. A pale cell has a lower relative score. ◆ outlines scores from 0.75 to 1 of that maximum. Zero means a supplied zero score; blank cells are unavailable. This score is neither a delay frequency nor a ranking across lines.',
		heatmapWindowNote:
			'This grid uses all retained history available in the current snapshot for this line. Day, week, month and date-range controls change other charts; this grid keeps the same history.',
		relativePeak: (day, hour) => `An observed peak in this line’s relative score: ${day}, ${hour}.`,
		scaleLegend: {
			repeat_problem_relative: 'Composite score normalized within this line',
			severe_relative: 'Severe-delay score normalized within this line',
		},
		tiers: {
			labels: [
				'Low relative score',
				'Moderate relative score',
				'High relative score',
				'Very high relative score',
			],
			worstGlyph: '◆',
		},
		weekdays: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
		weekdaysShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
	},
});

export type HabitsBandCopy = (typeof habitsBandCopy)[Locale];

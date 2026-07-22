// Cluster05Habits.copy.ts — band-intrinsic bilingual copy for the 05 Time-of-day
// habits band. The shared cluster overline + honest-state notes live in
// `reliability.copy.ts` (passed in as the ReliabilityCopy prop); the strings
// here are the ones only this band needs: weekday names, the heatmap a11y
// summary, the scale legend (low/high/no-data), and the two sub-section
// headings. FR is the canonical product voice; EN mirrors it.

import { defineCopy, type Locale } from '$lib/i18n/copy';

export const habitsBandCopy = defineCopy({
	fr: {
		heatmapHeading: 'Problèmes récurrents par heure',
		heatmapLabel: 'Carte thermique des problèmes par jour et par heure',
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
		cellValueLabel: 'Problèmes récurrents',
		scaleCaption:
			'Chaque case indique à quelle fréquence les retards graves reviennent à cette heure-là, sur toute la semaine et sur une seule échelle. Les cases encadrées et marquées d’un ◆ sont les pires heures de cette ligne; les cases pâles voient rarement un retard grave. Les fins de semaine plus calmes paraissent donc plus pâles, ce qui est honnête.',
		heatmapWindowNote:
			'Ce portrait utilise tout l’historique de la ligne : il ne change pas selon la fenêtre choisie en haut. « Aujourd’hui », « Cette semaine » et « Ce mois-ci » affichent la même carte. (La fenêtre change plutôt la tendance, les taux et les comparaisons.)',
		bestTime: {
			lead: (d: string, h: string) =>
				`Sur cette ligne, les retards récurrents culminent le ${d} vers ${h}.`,
			calm: (d: string) => ` Le ${d} est habituellement sa journée la plus calme.`,
		},
		scaleLegend: {
			repeat_problem_relative: 'Problèmes récurrents (par rapport à la pire heure de la ligne)',
			severe_relative: 'Retards graves (par rapport à la pire heure de la ligne)',
		} as Readonly<Record<string, string>>,
		// Plain-language reliability tiers, calmest → worst — they say what the colour MEANS
		// to a rider (how unreliable that hour is) and double as the cell + tooltip readout.
		tiers: {
			labels: [
				'Rarement en retard',
				'Parfois en retard',
				'Souvent en retard',
				'Très peu fiable',
			] as const,
			noData: 'Aucune donnée',
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
		heatmapWindowNote:
			'This pattern uses the line’s full history, so it does not change with the time window above. Today, This week and This month all show the same heatmap. (The window changes the trend, the rates and the comparisons instead.)',
		bestTime: {
			lead: (d, h) => `On this line, repeat delays peak on ${d} around ${h}.`,
			calm: (d) => ` ${d} is usually its calmest day.`,
		},
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
});

export type HabitsBandCopy = (typeof habitsBandCopy)[Locale];

import { defineCopy, type Locale } from '$lib/i18n/copy';
import type { VerdictCopy, VerdictSentenceArgs } from './verdict';
export const verdictCopy = defineCopy({
	fr: {
		windowPhrase: {
			day: 'selon le dernier bilan',
			week: 'cette semaine',
			month: 'ce mois-ci',
			range: 'sur les jours choisis',
		},
		reliable: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
			`Service fiable ${window}, environ ${onTen} relevés de retard sur 10 dans la plage de ponctualité${hedge}; ${lateTen} sur 10 hors de cette plage.`,
		patchy: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
			`Service inégal ${window}, environ ${onTen} relevés de retard sur 10 dans la plage de ponctualité${hedge}; ${lateTen} sur 10 hors de cette plage.`,
		unreliable: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
			`Service peu fiable ${window}, seulement ${onTen} relevés de retard sur 10 dans la plage de ponctualité${hedge}; ${lateTen} sur 10 hors de cette plage.`,
		tentative: ({ window, otp, n, lo, hi }) =>
			`Données limitées ${window} : ${otp} % de ${n} relevés de retard dans la plage de ponctualité (IC 95 % : ${lo}–${hi} %).`,
		unknownCount: () =>
			'Relevés insuffisants pour juger la fiabilité : nombre d’observations inconnu.',
		tooFew: (window: string, n: number) =>
			`Relevés insuffisants ${window} (${n}) pour juger la fiabilité.`,
		absent: 'Aucun relevé de retard disponible pour juger la fiabilité.',
		hedgeCI: (otp: number, lo: number, hi: number) => ` (${otp} %, IC 95 % : ${lo}–${hi} %)`,
	},
	en: {
		windowPhrase: {
			day: 'in the latest summary',
			week: 'this week',
			month: 'this month',
			range: 'over the selected days',
		},
		reliable: ({ window, onTen, lateTen, hedge }) =>
			`Ran reliably ${window}, about ${onTen} in 10 delay observations in the on-time band${hedge}; ${lateTen} in 10 outside that band.`,
		patchy: ({ window, onTen, lateTen, hedge }) =>
			`Ran unevenly ${window}, about ${onTen} in 10 delay observations in the on-time band${hedge}; ${lateTen} in 10 outside that band.`,
		unreliable: ({ window, onTen, lateTen, hedge }) =>
			`Ran unreliably ${window}, only about ${onTen} in 10 delay observations in the on-time band${hedge}; ${lateTen} in 10 outside that band.`,
		tentative: ({ window, otp, n, lo, hi }) =>
			`Limited data ${window}: ${otp}% of ${n} delay observations in the on-time band (95% CI: ${lo}–${hi}%).`,
		unknownCount: () =>
			'Not enough delay observations to judge reliability: observation count unknown.',
		tooFew: (window, n) => `Not enough delay observations ${window} (${n}) to judge reliability.`,
		absent: 'No delay observations available to judge reliability.',
		hedgeCI: (otp, lo, hi) => ` (${otp}%, 95% CI: ${lo}–${hi}%)`,
	},
}) satisfies Readonly<Record<Locale, VerdictCopy>>;

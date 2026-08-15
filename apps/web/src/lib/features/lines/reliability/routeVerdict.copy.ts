import { defineCopy, type Locale } from '$lib/i18n/copy';
import type { VerdictCopy, VerdictSentenceArgs } from '$lib/v1/verdict';

export const routeVerdictCopy = defineCopy({
	fr: {
		history: {
			headerCurrentOnly: 'Verdict d’en-tête : portrait actuel',
		},
		verdict: {
			windowPhrase: {
				day: "aujourd'hui",
				week: 'cette semaine',
				month: 'ce mois-ci',
				range: 'sur les jours choisis',
			},
			reliable: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
				`Service fiable ${window}, environ ${onTen} trajets sur 10 à l'heure${hedge}; ${lateTen} sur 10 en retard.`,
			patchy: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
				`Service inégal ${window}, environ ${onTen} trajets sur 10 à l'heure${hedge}; ${lateTen} sur 10 en retard.`,
			unreliable: ({ window, onTen, lateTen, hedge }: VerdictSentenceArgs) =>
				`Service peu fiable ${window}, seulement ${onTen} trajets sur 10 à l'heure${hedge}; ${lateTen} sur 10 en retard.`,
			tentative: ({ window, otp, n, lo, hi }) =>
				`Trop peu de trajets ${window} pour être certain, ${otp} % de ${n} trajets suivis à l'heure (probablement ${lo}–${hi} %).`,
			tooFew: (window: string, n: number) =>
				`Mesure en cours ${window}, seulement ${n} trajets suivis jusqu'ici, pas assez pour juger la fiabilité.`,
			absent:
				"Mesure en cours, aucun trajet suivi pour l'instant, impossible de juger la fiabilité.",
			hedgeSimple: (otp: number) => ` (${otp} %)`,
			hedgeCI: (otp: number, lo: number, hi: number) =>
				` (${otp} %, sûr à 95 % entre ${lo} et ${hi} %)`,
		} satisfies VerdictCopy,
	},
	en: {
		history: {
			headerCurrentOnly: 'Header verdict: current snapshot',
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
		} satisfies VerdictCopy,
	},
}) satisfies Readonly<
	Record<
		Locale,
		{ readonly history: { readonly headerCurrentOnly: string }; readonly verdict: VerdictCopy }
	>
>;

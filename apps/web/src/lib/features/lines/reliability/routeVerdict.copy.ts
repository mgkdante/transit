import { defineCopy } from '$lib/i18n/copy';
import { verdictCopy } from '$lib/v1/verdict.copy';
export const routeVerdictCopy = defineCopy({
	fr: {
		history: { headerCurrentOnly: 'Verdict d’en-tête : portrait actuel' },
		verdict: verdictCopy.fr,
	},
	en: {
		history: { headerCurrentOnly: 'Header verdict: current snapshot' },
		verdict: verdictCopy.en,
	},
});

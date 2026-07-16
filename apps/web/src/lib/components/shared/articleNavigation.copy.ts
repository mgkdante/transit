import type { Locale } from '$lib/i18n';

export interface ArticleNavigationCopy {
	heading: string;
	openAria: string;
	closeAria: string;
}

/** Shared article-navigation chrome for every detail surface. */
export const articleNavigationCopy: Record<Locale, ArticleNavigationCopy> = {
	fr: {
		heading: 'Sur cette page',
		openAria: 'Ouvrir le sommaire',
		closeAria: 'Fermer le sommaire',
	},
	en: {
		heading: 'On this page',
		openAria: 'Open contents',
		closeAria: 'Close contents',
	},
};

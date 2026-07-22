import { defineCopy, type Locale } from '$lib/i18n/copy';

/** Shared article-navigation chrome for every detail surface. */
export const articleNavigationCopy = defineCopy({
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
});

export type ArticleNavigationCopy = (typeof articleNavigationCopy)[Locale];

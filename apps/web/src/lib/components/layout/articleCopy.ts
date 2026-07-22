import { defineCopy, type Locale } from '$lib/i18n/copy';

const chrome = defineCopy({
	fr: {
		back: '← Retour au tableau de bord',
		tagsAria: 'Mots-clés de la page',
	},
	en: {
		back: '← Back to the dashboard',
		tagsAria: 'Page keywords',
	},
});

interface Input {
	readonly watermark: string;
	readonly tags?: readonly string[];
	readonly back?: never;
	readonly tagsAria?: never;
}

export type ArticleCopyOptions = Readonly<{ back?: string | false; tagsAria?: string }>;

type Back<O extends ArticleCopyOptions> = O extends { readonly back: false }
	? object
	: { readonly back: string };

type Tags<F extends Input> = F['tags'] extends infer T extends readonly string[]
	? { readonly tags: T }
	: object;

export type ArticleCopy<F extends Input, O extends ArticleCopyOptions = object> = Readonly<
	Pick<F, 'watermark'> &
		Back<O> & { readonly tagsAria: string } & Tags<F> &
		Omit<F, 'watermark' | 'tags'>
>;

/** Adds the shared ArticleHeader chrome without changing caller field order. */
export function articleCopy<const F extends Input, const O extends ArticleCopyOptions = object>(
	locale: Locale,
	fragment: F,
	options?: O,
): ArticleCopy<F, O> {
	const { watermark, tags, ...rest } = fragment;
	const shared = chrome[locale];
	const back = options?.back === false ? undefined : (options?.back ?? shared.back);
	return {
		watermark,
		...(back === undefined ? {} : { back }),
		tagsAria: options?.tagsAria ?? shared.tagsAria,
		...(tags === undefined ? {} : { tags }),
		...rest,
	} as ArticleCopy<F, O>;
}

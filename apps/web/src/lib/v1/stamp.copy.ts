import { defineCopy } from '#lib/i18n/copy.ts';

export const stampCopy = defineCopy({
	en: {
		record: (date: string | null, published: string | null, scope: 'window' | 'day') =>
			[
				'Record',
				date ? `${scope === 'day' ? 'day of' : 'data through'} ${date}` : null,
				published ? `published ${published}` : null,
			]
				.filter(Boolean)
				.join(' · '),
	},
	fr: {
		record: (date: string | null, published: string | null, scope: 'window' | 'day') =>
			[
				'Bilan',
				date ? `${scope === 'day' ? 'journée du' : 'données jusqu’au'} ${date}` : null,
				published ? `publié le ${published}` : null,
			]
				.filter(Boolean)
				.join(' · '),
	},
});

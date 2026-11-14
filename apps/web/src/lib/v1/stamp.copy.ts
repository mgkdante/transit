import { defineCopy } from '#lib/i18n/copy.ts';

export type LiveState = 'current' | 'behind' | 'not-responding' | 'unknown';

export const stampCopy = defineCopy({
	en: {
		live: (subject: 'data' | 'alerts', state: LiveState, age: string | null) =>
			(subject === 'alerts' ? 'Live alerts' : 'Live') +
			' · ' +
			(state === 'not-responding'
				? 'not responding'
				: state === 'unknown'
					? 'update time unknown'
					: 'updated ' + age + (state === 'behind' ? ' · not current' : '')),
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
		live: (subject: 'data' | 'alerts', state: LiveState, age: string | null) =>
			(subject === 'alerts' ? 'Avis en direct' : 'En direct') +
			' · ' +
			(state === 'not-responding'
				? 'ne répond pas'
				: state === 'unknown'
					? 'heure de mise à jour inconnue'
					: 'mis à jour ' + age + (state === 'behind' ? ' · pas à jour' : '')),
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

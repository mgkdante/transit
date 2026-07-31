import { defineCopy } from '$lib/i18n/copy';

export const legalCopy = defineCopy({
	fr: {
		kicker: 'JURIDIQUE',
		privacyTitle: 'Confidentialité',
		termsTitle: 'Conditions d’utilisation',
		reviewNotice: 'Cette page est en cours de révision juridique.',
		reviewDetail:
			'Le contenu juridique complet sera publié après sa révision. Cette page ne présente aucune conclusion de conformité.',
		footerAttribution: 'Mentions de licence et d’attribution en cours de révision juridique.',
	},
	en: {
		kicker: 'LEGAL',
		privacyTitle: 'Privacy',
		termsTitle: 'Terms',
		reviewNotice: 'This page is under legal review.',
		reviewDetail:
			'Complete legal content will be published after review. This page makes no compliance claim.',
		footerAttribution: 'Licensing and attribution notices are under legal review.',
	},
});

export type LegalPageKind = 'privacy' | 'terms';

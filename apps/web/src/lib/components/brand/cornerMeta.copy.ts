import { defineCopy, type Locale } from '$lib/i18n/copy';

export const cornerMetaLabels = defineCopy({
	fr: {
		provider: 'FOURNISSEUR',
		generated: 'GÉNÉRÉ',
		dataset: 'JEU DE DONNÉES',
		line: 'LIGNE',
		stop: 'ARRÊT',
		trip: 'VOYAGE',
		vehicles: 'VÉHICULES',
		sources: 'SOURCES',
	},
	en: {
		provider: 'PROVIDER',
		generated: 'GENERATED',
		dataset: 'DATASET',
		line: 'LINE',
		stop: 'STOP',
		trip: 'TRIP',
		vehicles: 'VEHICLES',
		sources: 'SOURCES',
	},
});

export type CornerMetaLabels = (typeof cornerMetaLabels)[Locale];

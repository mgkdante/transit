// cornerMeta.copy.ts — the shared mono labels for the CornerMeta blueprint-margin
// readouts (A4). Small station-voice tokens (PROVIDER / GENERATED / DATASET /
// LINE / STOP / TRIP …) reused across every hero zone that wires CornerMeta, so
// the en+fr wording stays consistent and DRY (no per-surface duplication).
//
// These are decorative annotations (CornerMeta is aria-hidden), but they still
// localize — en+fr for all copy is a hard law.

import { defineCopy, type Locale } from '$lib/i18n/copy';

export const cornerMetaLabels = defineCopy({
	fr: {
		/** Data provider (STM / OC Transpo …). */
		provider: 'FOURNISSEUR',
		/** DATA time of the payload feeding the head. */
		generated: 'GÉNÉRÉ',
		/** Dataset version stamp. */
		dataset: 'JEU DE DONNÉES',
		/** Entity kind labels. */
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

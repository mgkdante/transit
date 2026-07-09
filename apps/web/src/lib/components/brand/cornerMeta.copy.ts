// cornerMeta.copy.ts — the shared mono labels for the CornerMeta blueprint-margin
// readouts (A4). Small station-voice tokens (PROVIDER / GENERATED / DATASET /
// LINE / STOP / TRIP …) reused across every hero zone that wires CornerMeta, so
// the en+fr wording stays consistent and DRY (no per-surface duplication).
//
// These are decorative annotations (CornerMeta is aria-hidden), but they still
// localize — en+fr for all copy is a hard law.

import type { Locale } from '$lib/i18n';

export interface CornerMetaLabels {
	/** Data provider (STM / OC Transpo …). */
	readonly provider: string;
	/** DATA time of the payload feeding the head. */
	readonly generated: string;
	/** Dataset version stamp. */
	readonly dataset: string;
	/** Entity kind labels. */
	readonly line: string;
	readonly stop: string;
	readonly trip: string;
	/** Live vehicle count. */
	readonly vehicles: string;
	/** Source-feed count. */
	readonly sources: string;
}

export const cornerMetaLabels: Record<Locale, CornerMetaLabels> = {
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
};

// reliability.copy.ts — co-located bilingual copy for the slice-9.6 historic
// Reliability surface (the clustered approach-B surface). FR is the canonical
// product voice; EN mirrors it. Bands and the control spine read from here so
// their markup stays string-free.
//
// Scope:
//   - clusters[]   — the five numbered cluster overlines ('01 Punctuality' …).
//   - strip{}      — the snapshot-strip metric labels + the two honest-state
//                    notes (ramp-in / no-data) shared by every band.
//   - controls{}   — the grain control-spine labels (Today/This week/This
//                    month + the "Specific date" picker affordance).

import type { Locale } from '$lib/i18n';

/** The five cluster keys, in surface order. */
export type ReliabilityClusterKey =
	| 'punctuality'
	| 'waitRegularity'
	| 'serviceDelivered'
	| 'crowding'
	| 'habits';

export interface ReliabilityCopy {
	/** Numbered cluster overlines ('01 Punctuality' / '01 Ponctualité' …). */
	readonly clusters: Record<ReliabilityClusterKey, string>;
	/** Snapshot-strip metric labels + the shared honest-state notes. */
	readonly strip: {
		readonly otpPct: string;
		readonly avgDelayMin: string;
		readonly p90Min: string;
		readonly headwayRegularityCov: string;
		readonly cancellationRatePct: string;
		readonly skippedStopRatePct: string;
		/** Ramp-in caveat shown on no-backfill metrics/sections. */
		readonly rampInNote: string;
		/** Explicit empty-state note for a metric/band with no data yet. */
		readonly noDataNote: string;
		/** Plain-language reading of the headway CoV (a regular/irregular caption, not a raw number dump). */
		readonly regularity: {
			readonly regular: string;
			readonly irregular: string;
		};
	};
	/** Grain control-spine labels. */
	readonly controls: {
		readonly today: string;
		readonly thisWeek: string;
		readonly thisMonth: string;
		readonly specificDate: string;
	};
}

export const reliabilityCopy: Record<Locale, ReliabilityCopy> = {
	fr: {
		clusters: {
			punctuality: '01 Ponctualité',
			waitRegularity: '02 Régularité des attentes',
			serviceDelivered: '03 Service assuré',
			crowding: '04 Encombrement',
			habits: '05 Habitudes horaires',
		},
		strip: {
			otpPct: 'Ponctualité',
			avgDelayMin: 'Retard moyen',
			p90Min: 'Retard p90',
			headwayRegularityCov: 'Régularité (CV)',
			cancellationRatePct: "Taux d'annulation",
			skippedStopRatePct: "Taux d'arrêts ignorés",
			rampInNote: "Mise en route — l'historique s'accumule vers l'avant, sans rétro-remplissage",
			noDataNote: 'Aucune donnée',
			regularity: {
				regular: 'Passages réguliers',
				irregular: 'Passages irréguliers',
			},
		},
		controls: {
			today: "Aujourd'hui",
			thisWeek: 'Cette semaine',
			thisMonth: 'Ce mois-ci',
			specificDate: 'Date précise',
		},
	},
	en: {
		clusters: {
			punctuality: '01 Punctuality',
			waitRegularity: '02 Wait regularity',
			serviceDelivered: '03 Service delivered',
			crowding: '04 Crowding',
			habits: '05 Time-of-day habits',
		},
		strip: {
			otpPct: 'On-time',
			avgDelayMin: 'Avg delay',
			p90Min: 'p90 delay',
			headwayRegularityCov: 'Regularity (CoV)',
			cancellationRatePct: 'Cancellation rate',
			skippedStopRatePct: 'Skipped-stop rate',
			rampInNote: 'Ramp-in — history accrues forward, no backfill',
			noDataNote: 'No data yet',
			regularity: {
				regular: 'Regular arrivals',
				irregular: 'Irregular arrivals',
			},
		},
		controls: {
			today: 'Today',
			thisWeek: 'This week',
			thisMonth: 'This month',
			specificDate: 'Specific date',
		},
	},
};

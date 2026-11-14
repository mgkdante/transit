import { severeShareToSeverity } from '#lib/features/reliability/shiftGrains.ts';
import type { NetworkShiftView as NetworkShift } from '#lib/v1/reliabilityView.ts';
import type { SeverityCode } from '#lib/v1/schemas/index.ts';

export interface ShiftRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly severity: SeverityCode;
	readonly value: number | null;
	readonly display: string | null;
	readonly subtitle: string;
}

export interface ShiftRankLabels {
	grainLabel: (grain: string) => string;
	pctOrNull: (v: number | null) => string | null;
	subtitle: (avg: number | null, severe: number | null) => string;
}

export function selectShiftRank(
	rows: readonly NetworkShift[] | null | undefined,
	labels: ShiftRankLabels,
): ShiftRow[] {
	const real = (rows ?? []).filter((r) => r.onTimePct != null || r.severePct != null);
	return real
		.slice()
		.sort((a, b) => {
			const aHas = a.onTimePct != null;
			const bHas = b.onTimePct != null;
			if (aHas !== bHas) return aHas ? -1 : 1;
			if (aHas && bHas) return (a.onTimePct ?? 0) - (b.onTimePct ?? 0);
			return (b.severePct ?? 0) - (a.severePct ?? 0);
		})
		.map((r, i) => {
			const sev = r.severePct ?? null;
			return {
				key: r.grain,
				rank: i + 1,
				title: labels.grainLabel(r.grain),
				severity: severeShareToSeverity(sev),
				value: sev,
				display: labels.pctOrNull(r.onTimePct ?? null),
				subtitle: labels.subtitle(r.meanDelayMin ?? null, sev),
			};
		});
}

import { severeShareToSeverity } from '$lib/features/reliability/shiftGrains';
import type { NetworkShift } from '$lib/v1';
import type { SeverityCode } from '$lib/v1/schemas';

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
	const real = (rows ?? []).filter((r) => r.otp_pct != null || r.severe_pct != null);
	return real
		.slice()
		.sort((a, b) => {
			const aHas = a.otp_pct != null;
			const bHas = b.otp_pct != null;
			if (aHas !== bHas) return aHas ? -1 : 1;
			if (aHas && bHas) return (a.otp_pct ?? 0) - (b.otp_pct ?? 0);
			return (b.severe_pct ?? 0) - (a.severe_pct ?? 0);
		})
		.map((r, i) => {
			const sev = r.severe_pct ?? null;
			return {
				key: r.grain,
				rank: i + 1,
				title: labels.grainLabel(r.grain),
				severity: severeShareToSeverity(sev),
				value: sev,
				display: labels.pctOrNull(r.otp_pct ?? null),
				subtitle: labels.subtitle(r.avg_delay_min ?? null, sev),
			};
		});
}

import {
	SHIFT_GRAIN_ORDER,
	severeShareToSeverity,
	SEVERE_DOMAIN,
} from '$lib/features/reliability/shiftGrains';
import type { SeverityCode, ReceiptShiftCut } from '$lib/v1/schemas';

export interface ReceiptShiftRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly severity: SeverityCode;
	readonly value: number;
	readonly domain: readonly [number, number];
	readonly unit: string;
	readonly display: string;
}

export interface ReceiptTimeOfDayVM {
	readonly rows: ReceiptShiftRow[];
	readonly hasTimeOfDay: boolean;
}

export interface ReceiptTimeOfDayLabels {
	readonly shiftLabel: (shift: string) => string;
}

function shiftRank(shift: string): number {
	const i = SHIFT_GRAIN_ORDER.indexOf(shift as (typeof SHIFT_GRAIN_ORDER)[number]);
	return i === -1 ? SHIFT_GRAIN_ORDER.length : i;
}

export function selectReceiptTimeOfDay(
	byShift: readonly ReceiptShiftCut[] | null | undefined,
	labels: ReceiptTimeOfDayLabels,
): ReceiptTimeOfDayVM {
	const real = (byShift ?? []).filter((c) => c.severe_pct != null);
	const rows: ReceiptShiftRow[] = real
		.slice()
		.sort(
			(a, b) =>
				(b.severe_pct ?? 0) - (a.severe_pct ?? 0) || shiftRank(a.shift) - shiftRank(b.shift),
		)
		.map((c, i) => {
			const sev = c.severe_pct ?? 0;
			return {
				key: c.shift,
				rank: i + 1,
				title: labels.shiftLabel(c.shift),
				severity: severeShareToSeverity(c.severe_pct ?? null),
				value: sev,
				domain: SEVERE_DOMAIN,
				unit: '%',
				display: `${sev.toFixed(1)}%`,
			};
		});
	return { rows, hasTimeOfDay: rows.length > 0 };
}

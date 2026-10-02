import {
	SHIFT_GRAIN_ORDER,
	DAY_TYPE_GRAIN_ORDER,
	isShiftGrain,
	isDayTypeGrain,
	severeShareToSeverity,
	SEVERE_DOMAIN,
} from '$lib/features/reliability/shiftGrains';
import type { SeverityCode, StopReliabilityPeriod } from '$lib/v1/schemas';

export interface TimeOfDayRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly severity: SeverityCode;
	readonly value: number;
	readonly domain: readonly [number, number];
	readonly unit: string;
	readonly display: string;
}

type ShiftRow = { grain: string; severePct: number | null; avgDelayMin: number | null };

function partition(periods: readonly StopReliabilityPeriod[]): {
	byShift: ShiftRow[];
	byDayType: ShiftRow[];
} {
	const byShift: ShiftRow[] = [];
	const byDayType: ShiftRow[] = [];
	for (const p of periods) {
		if (p.severe_pct == null) continue;
		const row: ShiftRow = {
			grain: p.grain,
			severePct: p.severe_pct ?? null,
			avgDelayMin: p.avg_delay_min ?? null,
		};
		if (isShiftGrain(p.grain)) byShift.push(row);
		else if (isDayTypeGrain(p.grain)) byDayType.push(row);
	}
	return { byShift, byDayType };
}

function rankBySevere(
	rows: readonly ShiftRow[],
	order: readonly string[],
	label: (g: string) => string,
): TimeOfDayRow[] {
	const real = rows.filter((r) => r.severePct != null);
	const rank = (g: string) => {
		const i = order.indexOf(g);
		return i === -1 ? order.length : i;
	};
	return real
		.slice()
		.sort((a, b) => (b.severePct ?? 0) - (a.severePct ?? 0) || rank(a.grain) - rank(b.grain))
		.map((r, i) => {
			const sev = r.severePct ?? 0;
			return {
				key: r.grain,
				rank: i + 1,
				title: label(r.grain),
				severity: severeShareToSeverity(r.severePct),
				value: sev,
				domain: SEVERE_DOMAIN,
				unit: '%',
				display: `${sev.toFixed(1)}%`,
			};
		});
}

export interface TimeOfDayLabels {
	shiftLabel: (grain: string) => string;
	dayTypeLabel: (grain: string) => string;
}

export interface TimeOfDayVM {
	readonly shiftRows: TimeOfDayRow[];
	readonly dayTypeRows: TimeOfDayRow[];
	readonly hasTimeOfDay: boolean;
}

export function selectTimeOfDay(
	periods: readonly StopReliabilityPeriod[] | null | undefined,
	labels: TimeOfDayLabels,
): TimeOfDayVM {
	const { byShift, byDayType } = partition(periods ?? []);
	const shiftRows = rankBySevere(byShift, SHIFT_GRAIN_ORDER, labels.shiftLabel);
	const dayTypeRows = rankBySevere(byDayType, DAY_TYPE_GRAIN_ORDER, labels.dayTypeLabel);
	return { shiftRows, dayTypeRows, hasTimeOfDay: shiftRows.length > 0 || dayTypeRows.length > 0 };
}

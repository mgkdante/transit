import type { HabitsVM } from '../clusters';

export interface RelativeScorePeakOpts {
	/** Full weekday names in matrix row order (Mon..Sun). */
	readonly fullRowLabels: readonly string[];
	readonly hourLabel: (hour: number) => string;
}

export interface RelativeScorePeak {
	readonly dayLabel: string;
	readonly hourLabel: string;
}

/** One observed peak, only when valid cells vary. Tied peaks use matrix order. */
export function selectRelativeScorePeak(
	habits: HabitsVM,
	opts: RelativeScorePeakOpts,
): RelativeScorePeak | null {
	let minimum = Number.POSITIVE_INFINITY;
	let peak = { day: -1, hour: -1, value: Number.NEGATIVE_INFINITY };
	for (let day = 0; day < habits.matrix.length; day++) {
		const row = habits.matrix[day] ?? [];
		for (let hour = 0; hour < row.length; hour++) {
			const value = row[hour];
			if (value == null || !Number.isFinite(value) || value < 0 || value > 1) continue;
			minimum = Math.min(minimum, value);
			if (value > peak.value) peak = { day, hour, value };
		}
	}
	if (peak.value <= minimum) return null;
	return {
		dayLabel: opts.fullRowLabels[peak.day] ?? '',
		hourLabel: opts.hourLabel(peak.hour),
	};
}

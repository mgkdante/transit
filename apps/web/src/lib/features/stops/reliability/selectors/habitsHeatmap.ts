// habitsHeatmap — the per-stop 7×24 severe-delay habits matrix.
//
// Ports the StopDetail inline habits transforms VERBATIM: the matrix + its
// presence flag (`hasHabits` — stands the section down when NO cell carries a
// real value, so we never draw a fabricated empty grid) + the per-cell
// plain-language intensity word bucketed on the same ramp the colour uses.

/** The habits view-model: the matrix + whether any cell carries real data. */
export interface HabitsVM {
	/** 7×24 (dow × hour) severe-delay matrix; a null cell = "no data". */
	readonly matrix: (number | null)[][];
	/** True when at least one cell carries a real value. */
	readonly hasHabits: boolean;
}

export function selectHabitsHeatmap(matrix: (number | null)[][] | null | undefined): HabitsVM {
	const m = matrix ?? [];
	const hasHabits = m.some((row) => row.some((cell) => cell != null));
	return { matrix: m, hasHabits };
}

/**
 * A cell's plain-language intensity word (low/medium/high), bucketed on the same
 * [0,1] normalised ramp the colour uses. Returns the noData word when the cell or
 * its normalised value is absent. `words` = [low, medium, high, noData].
 */
export function habitsCellText(
	value: number | null,
	norm: number | null,
	words: { low: string; medium: string; high: string; noData: string },
): string {
	if (value == null || norm == null) return words.noData;
	const bucket = Math.min(4, Math.floor(Math.min(1, Math.max(0, norm)) * 5));
	return [words.low, words.low, words.medium, words.high, words.high][bucket];
}

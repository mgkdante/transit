// bestTimeInsight.ts — the §1 "when to ride" plain-language takeaway (the verdict SENTENCE
// the Section1 header earmarks). Pure: reads the 7×24 HabitsVM matrix and names the line's
// WORST (day, hour) for repeat delays + its CALMEST weekday, so a rider gets the at-a-glance
// "when should I avoid / when is it fine" answer without decoding the heatmap.
//
// HONESTY: the matrix is `repeat_problem_relative` — each cell is normalised to THIS line's own
// worst hour ([0,1], 1.0 = the worst). So the insight is RELATIVE to the line itself (its own
// peak-problem window), never an absolute "this line is unreliable" claim — the copy must word it
// that way. `null`/NaN cells are no-data and are skipped (never read as a calm 0). The calmest is a
// per-weekday MEAN (not a single cell) so one noisy low cell can't crown an arbitrary "best" hour.
//
// No DOM, no i18n: labels arrive resolved via opts (matches every sibling selector).

import type { HabitsVM } from '../clusters';

export interface BestTimeInsightOpts {
	/** Full weekday names in matrix ROW order (Mon..Sun, length 7). */
	readonly fullRowLabels: readonly string[];
	/** Format an hour index (0..23) into a label (e.g. "16:00"). */
	readonly hourLabel: (hour: number) => string;
}

export interface BestTimeInsight {
	/** Matrix row (0=Mon..6=Sun) + hour (0..23) of the line's worst repeat-problem cell. */
	readonly worstDayIdx: number;
	readonly worstHour: number;
	/** Resolved labels for the worst cell. */
	readonly worstDayLabel: string;
	readonly worstHourLabel: string;
	/** The calmest weekday (lowest per-row mean). -1 + '' when not distinct from the worst day. */
	readonly calmDayIdx: number;
	readonly calmDayLabel: string;
}

/**
 * Build the §1 takeaway, or null when the matrix carries no usable cell (the caller already gates
 * on `!habits.isEmpty`, but this stays null-safe). The worst is the single MAX cell; the calmest
 * weekday is the row with the lowest mean of its non-null cells — distinct from the worst day, else
 * the calm clause is suppressed (`calmDayIdx === -1`).
 */
export function selectBestTimeInsight(
	habits: HabitsVM,
	opts: BestTimeInsightOpts,
): BestTimeInsight | null {
	const m = habits.matrix;
	let worst = { r: -1, c: -1, v: Number.NEGATIVE_INFINITY };
	const rowMeans: (number | null)[] = [];

	for (let r = 0; r < m.length; r++) {
		const row = m[r] ?? [];
		let sum = 0;
		let n = 0;
		for (let c = 0; c < row.length; c++) {
			const v = row[c];
			if (v == null || Number.isNaN(v)) continue;
			if (v > worst.v) worst = { r, c, v };
			sum += v;
			n += 1;
		}
		rowMeans[r] = n > 0 ? sum / n : null;
	}

	if (worst.r < 0) return null;

	// Calmest weekday = the row with the lowest mean (a per-day aggregate is robust to a single
	// noisy cell). Exclude the worst day so "calmest" never points at the same day as "worst".
	let calm = { r: -1, mean: Number.POSITIVE_INFINITY };
	for (let r = 0; r < rowMeans.length; r++) {
		const mean = rowMeans[r];
		if (mean == null || r === worst.r) continue;
		if (mean < calm.mean) calm = { r, mean };
	}

	return {
		worstDayIdx: worst.r,
		worstHour: worst.c,
		worstDayLabel: opts.fullRowLabels[worst.r] ?? '',
		worstHourLabel: opts.hourLabel(worst.c),
		calmDayIdx: calm.r,
		calmDayLabel: calm.r >= 0 ? (opts.fullRowLabels[calm.r] ?? '') : '',
	};
}

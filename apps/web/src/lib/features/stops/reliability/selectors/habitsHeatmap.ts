// habitsHeatmap — the per-stop 7×24 severe-delay habits matrix.
//
// Ports the StopDetail inline habits transforms VERBATIM: the matrix + its
// presence flag (`hasHabits` — stands the section down when NO cell carries a
// real value, so we never draw a fabricated empty grid).
//
// P5.2: emits a classed-tier `heatmap` ChartSpec (the legacy Heatmap primitive is
// retired). The matrix lands ALREADY normalised in [0,1] ('severe_relative' — the
// stop\'s worst cell = 1.0, same family as the route habits), so the honest read is
// ABSOLUTE on the fixed HABITS_DOMAIN [0,1]: the mark bins every cell onto the same
// four tiers everywhere. The legacy primitive re-normalised PER ROW, which painted a
// mild day\'s worst hour as dark as a severe day\'s — the same misleading-viz bug the
// lines surface fixed in S7 P4; this migration fixes it for stops.

import type { Locale } from '$lib/i18n';
import type { HeatmapCell, HeatmapSpec } from '$lib/components/dataviz/chart';
import { HABITS_DOMAIN } from '$lib/features/reliability/domains';

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

export interface HabitsSpecOpts {
	/** Accessible name describing the data + takeaway. */
	readonly title: string;
	/** What a single cell encodes, for the tooltip + SR table. */
	readonly valueLabel: string;
	readonly rowAxisLabel: string;
	readonly colAxisLabel: string;
	/** Short day labels, row order Mon..Sun (length 7). */
	readonly rowLabels: readonly string[];
	/** Full day names, row order Mon..Sun — tooltip heading + SR table. */
	readonly fullRowLabels: readonly string[];
	/** Plain-language tier labels, calmest → worst (length 4). */
	readonly tierLabels: readonly string[];
	readonly noDataLabel: string;
	/** Glyph stamped on the worst tier (colour is never the sole channel). */
	readonly worstGlyph?: string;
	readonly hourLabel: (hour: number) => string;
	readonly hourTicks: readonly number[];
}

const HOURS = 24;

/**
 * Build the absolute, classed-tier HeatmapSpec. The caller gates on `hasHabits`, so at
 * least one real cell exists; a `null` cell is the honest no-data swatch (never a real 0).
 */
export function selectHabitsHeatmapSpec(
	vm: HabitsVM,
	locale: Locale,
	opts: HabitsSpecOpts,
): HeatmapSpec {
	const cells: HeatmapCell[][] = vm.matrix.map((row) =>
		Array.from({ length: HOURS }, (_, c) => {
			const v = row[c];
			return v == null || Number.isNaN(v)
				? ({ value: null, absentReason: 'no-observations' } as const)
				: ({ value: v } as const);
		}),
	);

	const colLabels = Array.from({ length: HOURS }, (_, h) => opts.hourLabel(h));
	const colTicks = opts.hourTicks
		.filter((h) => h >= 0 && h < HOURS)
		.map((h) => ({ index: h, label: opts.hourLabel(h) }));

	return {
		kind: 'heatmap',
		title: opts.title,
		locale,
		mode: 'absolute',
		domain: HABITS_DOMAIN,
		rowLabels: opts.rowLabels,
		colLabels,
		cells,
		tiers: {
			tierLabels: opts.tierLabels,
			noDataLabel: opts.noDataLabel,
			worstGlyph: opts.worstGlyph,
		},
		valueLabel: opts.valueLabel,
		rowAxisLabel: opts.rowAxisLabel,
		colAxisLabel: opts.colAxisLabel,
		fullRowLabels: opts.fullRowLabels,
		colTicks,
	};
}

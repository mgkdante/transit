// Scores are already normalized to this line’s maximum. The fixed [0,1] domain
// preserves that supplied scale across weekdays; it does not compare different lines.

import type { Locale } from '$lib/i18n';
import type { HeatmapSpec, HeatmapCell } from '$lib/components/dataviz/chart/ChartSpec';
import { HABITS_DOMAIN } from '$lib/features/reliability/domains';
import type { HabitsVM } from '../clusters';

export interface HabitsHeatmapOpts {
	/** Accessible name describing the data + takeaway. */
	readonly title: string;
	/** What a single cell encodes, for the tooltip + SR table (e.g. "Relative score"). */
	readonly valueLabel: string;
	/** Row (day) axis caption. */
	readonly rowAxisLabel: string;
	/** Column (hour) axis caption. */
	readonly colAxisLabel: string;
	/** Short day labels, row order Mon..Sun (length 7). */
	readonly rowLabels: readonly string[];
	/** Full day names, row order Mon..Sun (length 7) — tooltip heading + SR table. */
	readonly fullRowLabels: readonly string[];
	/** Relative-score bands from lowest to highest (length 4). */
	readonly tierLabels: readonly string[];
	/** Label for a no-data cell. */
	readonly noDataLabel: string;
	/** Glyph stamped on the highest band, including scores below the exact maximum. */
	readonly worstGlyph?: string;
	/** Format an hour index (0..23) into a full cell label (e.g. "06:00"). */
	readonly hourLabel: (hour: number) => string;
	/** Which hour columns carry an axis tick (e.g. [0, 3, 6, 9, 12, 15, 18, 21]). */
	readonly hourTicks: readonly number[];
}

const HOURS = 24;

/**
 * Build the fixed-domain, relative-score HeatmapSpec from the habits matrix. The caller gates on
 * `!habits.isEmpty`, so at least one real cell exists here; a `null` cell is the honest
 * no-data swatch (never coerced to a real 0). The domain is the fixed [0,1] the pipeline
 * already normalised to — the renderer bins it, never re-derives a scale.
 */
export function selectHabitsHeatmap(
	habits: HabitsVM,
	locale: Locale,
	opts: HabitsHeatmapOpts,
): HeatmapSpec {
	const cells: HeatmapCell[][] = habits.matrix.map((row) =>
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

import type { Locale } from '$lib/i18n';
import type { HeatmapSpec } from '$lib/components/dataviz/chart';
import { HABITS_DOMAIN } from '$lib/features/reliability/domains';

export interface HabitsHeatmapOptions {
	readonly title: string;
	readonly valueLabel: string;
	readonly rowAxisLabel: string;
	readonly colAxisLabel: string;
	readonly rowLabels: readonly string[];
	readonly fullRowLabels: readonly string[];
	readonly tierLabels: readonly string[];
	readonly noDataLabel: string;
	readonly worstGlyph?: string;
	readonly hourLabel: (hour: number) => string;
	readonly hourTicks: readonly number[];
}

export function hasHabits(matrix: (number | null)[][] | null | undefined): boolean {
	return (matrix ?? []).some((row) => row.some((cell) => cell != null));
}

export function buildHabitsHeatmap(
	matrix: (number | null)[][],
	locale: Locale,
	opts: HabitsHeatmapOptions,
): HeatmapSpec {
	return {
		kind: 'heatmap',
		title: opts.title,
		locale,
		mode: 'absolute',
		domain: HABITS_DOMAIN,
		rowLabels: opts.rowLabels,
		colLabels: Array.from({ length: 24 }, (_, hour) => opts.hourLabel(hour)),
		cells: matrix.map((row) =>
			Array.from({ length: 24 }, (_, hour) => {
				const value = row[hour];
				return value == null || Number.isNaN(value)
					? { value: null, absentReason: 'no-observations' as const }
					: { value };
			}),
		),
		tiers: {
			tierLabels: opts.tierLabels,
			noDataLabel: opts.noDataLabel,
			worstGlyph: opts.worstGlyph,
		},
		valueLabel: opts.valueLabel,
		rowAxisLabel: opts.rowAxisLabel,
		colAxisLabel: opts.colAxisLabel,
		fullRowLabels: opts.fullRowLabels,
		colTicks: opts.hourTicks
			.filter((hour) => hour >= 0 && hour < 24)
			.map((hour) => ({ index: hour, label: opts.hourLabel(hour) })),
	};
}

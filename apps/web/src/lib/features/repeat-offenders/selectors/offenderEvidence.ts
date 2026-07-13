import type { RepeatOffenderEntry } from '$lib/v1/schemas';

export interface OffenderEvidenceRow {
	readonly key: string;
	readonly title: string;
	readonly href: string | null;
	readonly ariaLabel: string;
	readonly typeId: string;
	readonly severeRate: string | null;
	readonly confidenceInterval: string | null;
	readonly recurrence: string;
	readonly averageDelay: string | null;
	readonly readings: string | null;
}

export interface OffenderEvidenceLabels {
	readonly unnamed: (entry: RepeatOffenderEntry) => string;
	readonly href: (entry: RepeatOffenderEntry) => string | null;
	readonly ariaLabel: (title: string) => string;
	readonly typeId: (entry: RepeatOffenderEntry) => string;
	readonly severeRate: (value: number | null | undefined) => string | null;
	readonly confidenceInterval: (lower: number, upper: number) => string | null;
	readonly recurrence: (entry: RepeatOffenderEntry) => string;
	readonly averageDelay: (value: number | null | undefined) => string | null;
	readonly readings: (value: number | null | undefined) => string | null;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function buildOffenderEvidenceRows(
	entries: readonly RepeatOffenderEntry[],
	cap: number,
	labels: OffenderEvidenceLabels,
): OffenderEvidenceRow[] {
	return entries.slice(0, Math.max(0, cap)).map((entry) => {
		const title = entry.route_name ?? labels.unnamed(entry);
		const confidenceInterval =
			entry.wilson_lo != null && entry.wilson_hi != null
				? labels.confidenceInterval(round1(100 - entry.wilson_hi), round1(100 - entry.wilson_lo))
				: null;

		return {
			key: `${entry.type}-${entry.id}-${entry.route ?? ''}`,
			title,
			href: labels.href(entry),
			ariaLabel: labels.ariaLabel(title),
			typeId: labels.typeId(entry),
			severeRate: labels.severeRate(entry.severe_pct),
			confidenceInterval,
			recurrence: labels.recurrence(entry),
			averageDelay: labels.averageDelay(entry.avg_delay_min),
			readings: labels.readings(entry.observation_count),
		};
	});
}

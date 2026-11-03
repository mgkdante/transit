export const RELIABILITY_GRAINS = ['day', 'week', 'month'] as const;
export type ReliabilityGrain = (typeof RELIABILITY_GRAINS)[number];

export interface ReliabilityGrainSnapshot {
	readonly periods?: readonly { readonly grain: string }[] | null;
	readonly series?: readonly unknown[] | null;
	readonly weekly?: readonly unknown[] | null;
	readonly monthly?: readonly unknown[] | null;
}

export function presentGrains(
	snapshot: ReliabilityGrainSnapshot | null | undefined,
): Set<ReliabilityGrain> {
	const series = { day: snapshot?.series, week: snapshot?.weekly, month: snapshot?.monthly };
	return new Set(
		RELIABILITY_GRAINS.filter(
			(grain) =>
				(snapshot?.periods?.some((window) => window.grain === grain) ?? false) ||
				(series[grain]?.length ?? 0) > 0,
		),
	);
}

export function defaultReliabilityGrain(present: ReadonlySet<ReliabilityGrain>): ReliabilityGrain {
	return RELIABILITY_GRAINS.find((grain) => present.has(grain)) ?? 'day';
}

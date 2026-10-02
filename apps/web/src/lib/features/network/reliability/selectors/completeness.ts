import type { TrendPoint } from '$lib/v1';

export interface CompletenessVM {
	readonly hasData: boolean;
	readonly latest: number | null;
}

export function selectCompleteness(points: readonly TrendPoint[]): CompletenessVM {
	for (let i = points.length - 1; i >= 0; i--) {
		const r = points[i].service_completeness_rate;
		if (r != null && !Number.isNaN(r)) return { hasData: true, latest: r };
	}
	return { hasData: false, latest: null };
}

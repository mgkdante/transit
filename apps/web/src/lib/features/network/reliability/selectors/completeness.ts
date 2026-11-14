import type { NetworkPointView as TrendPoint } from '#lib/v1/reliabilityView.ts';

export interface CompletenessVM {
	readonly hasData: boolean;
	readonly latest: number | null;
}

export function selectCompleteness(points: readonly TrendPoint[]): CompletenessVM {
	for (let i = points.length - 1; i >= 0; i--) {
		const r = points[i].completenessPct;
		if (r != null && !Number.isNaN(r)) return { hasData: true, latest: r };
	}
	return { hasData: false, latest: null };
}

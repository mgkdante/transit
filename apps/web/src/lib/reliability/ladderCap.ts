import { WORST_N_LADDER, type WorstN } from '$lib/filters';
import type { GrainSegment } from '$lib/components/surface';

export const DEFAULT_WORST_N: WorstN = '10';
export const SMALLEST_WORST_N = Number(WORST_N_LADDER[0]);

export function worstNCap(n: WorstN): number {
	return n === 'all' ? Number.POSITIVE_INFINITY : Number(n);
}

export function worstNSegments(allLabel: string): GrainSegment<WorstN>[] {
	return [...WORST_N_LADDER.map((key) => ({ key, label: key })), { key: 'all', label: allLabel }];
}

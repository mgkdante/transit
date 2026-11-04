import type { RouteReliability } from '#lib/v1/index.ts';
import { reliabilityVerdict } from '#lib/v1/verdict.ts';
export { selectHeadlinePeriod } from '#lib/v1/verdict.ts';
export function selectDayVerdictHeadline(data: RouteReliability) {
	return reliabilityVerdict(data);
}

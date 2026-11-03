import type { RouteReliability } from '$lib/v1';
import { reliabilityVerdict } from '$lib/v1/verdict';
export { selectHeadlinePeriod } from '$lib/v1/verdict';
export function selectDayVerdictHeadline(data: RouteReliability) {
	return reliabilityVerdict(data);
}

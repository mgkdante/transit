import { DELAY_POS_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { SeverityCode, StopByRoute } from '$lib/v1/schemas';

export interface RankedRouteRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly severity: SeverityCode;
	readonly value: number;
	readonly domain: readonly [number, number];
	readonly unit: string;
	readonly display: string;
	readonly href: string;
	readonly ariaLabel: string;
}

export interface RankedRouteLinks {
	readonly href: (routeId: string) => string;
	readonly ariaLabel: (routeId: string) => string;
}

export function selectRankedRoutes(
	byRoute: readonly StopByRoute[] | null | undefined,
	fmtMin: (v: number | null) => string,
	links: RankedRouteLinks,
): RankedRouteRow[] {
	const rows = (byRoute ?? [])
		.filter((br): br is StopByRoute & { avg_delay_min: number } => br.avg_delay_min != null)
		.slice()
		.sort((a, b) => b.avg_delay_min - a.avg_delay_min);
	return rows.map((br, i) => {
		const delay = br.avg_delay_min;
		const severity: SeverityCode = delay >= 10 ? 'critical' : delay >= 5 ? 'high' : 'watch';
		return {
			key: br.route,
			rank: i + 1,
			title: br.route,
			severity,
			value: delay,
			domain: DELAY_POS_DOMAIN,
			unit: ' min',
			display: fmtMin(delay),
			href: links.href(br.route),
			ariaLabel: links.ariaLabel(br.route),
		};
	});
}

import type { Receipt } from '$lib/v1/schemas';

export interface WorstRowVM {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly meta: string;
}

export interface WorstOfDayVM {
	readonly route: WorstRowVM | null;
	readonly stop: WorstRowVM | null;
	readonly hasWorst: boolean;
}

export interface WorstOfDayLabels {
	readonly routeName: (id: string, fallbackName: string | null | undefined) => string;
	readonly stopName: (id: string, fallbackName: string | null | undefined) => string;
	readonly routeLabel: string;
	readonly stopLabel: string;
	readonly routeDeltaLabel: string;
	readonly stopDelayLabel: string;
	readonly fmtDelta: (v: number | null | undefined) => string;
	readonly fmtMin: (v: number | null | undefined) => string;
}

export function selectWorstOfDay(
	receipt: Pick<Receipt, 'worst_route' | 'worst_stop'>,
	labels: WorstOfDayLabels,
): WorstOfDayVM {
	const wr = receipt.worst_route;
	const ws = receipt.worst_stop;
	const route: WorstRowVM | null = wr?.id
		? {
				id: wr.id,
				title: labels.routeName(wr.id, wr.name),
				subtitle: `${labels.routeLabel} · ${wr.id}`,
				meta: `${labels.routeDeltaLabel} ${labels.fmtDelta(wr.otp_delta_pts)}`,
			}
		: null;
	const stop: WorstRowVM | null = ws?.id
		? {
				id: ws.id,
				title: labels.stopName(ws.id, ws.name),
				subtitle: `${labels.stopLabel} · ${ws.id}`,
				meta: `${labels.stopDelayLabel} ${labels.fmtMin(ws.avg_delay_min)}`,
			}
		: null;
	return { route, stop, hasWorst: route != null || stop != null };
}

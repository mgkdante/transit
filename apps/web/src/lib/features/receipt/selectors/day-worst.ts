// worstOfDay — the receipt's worst-route + worst-stop callouts (S13).
//
// Ports the AccountabilityReceipt inline worst-panel logic into a PURE presenter: the
// single worst route (linked to /lines/[id]) + worst stop (linked to /stop/[id]),
// each an EntityRow-ready VM with its resolved title/subtitle/meta. A worst entity
// counts ONLY when it carries an id; the whole panel stands DOWN (hasWorst=false)
// when the receipt carries neither — the grid reflows past it, never a fabricated
// empty card.

import type { Receipt } from '$lib/v1/schemas';

/** One worst-entity row VM (EntityRow-ready). */
export interface WorstRowVM {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly meta: string;
}

export interface WorstOfDayVM {
	readonly route: WorstRowVM | null;
	readonly stop: WorstRowVM | null;
	/** The panel stands down unless at least one worst entity (with an id) is present. */
	readonly hasWorst: boolean;
}

export interface WorstOfDayLabels {
	/** rid → the localized route name (through the unknown-data fallback). */
	readonly routeName: (id: string, fallbackName: string | null | undefined) => string;
	/** sid → the localized stop name (through the unknown-data fallback). */
	readonly stopName: (id: string, fallbackName: string | null | undefined) => string;
	readonly routeLabel: string;
	readonly stopLabel: string;
	readonly routeDeltaLabel: string;
	readonly stopDelayLabel: string;
	/** Signed OTP delta ("-8 pts" / "+2 pts" / no-data). */
	readonly fmtDelta: (v: number | null | undefined) => string;
	/** Inline avg-delay ("6.1 min" / no-data string). */
	readonly fmtMin: (v: number | null | undefined) => string;
}

/** Build the worst-of-day VM from the day's receipt. */
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

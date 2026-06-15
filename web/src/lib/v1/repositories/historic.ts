// Historic repository — thin async delegation over adapter.historic.
//
// The historic tier is the daily-rebuilt analytics archive (daily ttl):
//   network_trend.json              — trailing OTP/delay series
//   hotspots.json                   — worst stop/route problem cells
//   repeat_offenders.json           — chronically-late entities
//   alert_history.json              — resolved/expired alert log
//   receipts/index.json             — published receipt dates (discovery)
//   receipts/{date}.json            — one day's network receipt (404 => empty)
//   route_reliability/{route}.json   — per-route reliability (404 => empty)
//   stop_reliability/{stop}.json     — per-stop reliability (404 => empty)
//
// Per-entity 404 is a render-empty-state signal, NOT an error — the adapter
// surfaces that as `null`. The adapter owns the {prefix}{id}.json URL assembly
// and parsePort validation; this module just delegates.

import { adapter } from '$lib/v1/adapter';
import type {
	AlertHistory,
	Hotspots,
	NetworkTrend,
	Receipt,
	ReceiptsIndex,
	RepeatOffenders,
	RouteReliability,
	StopReliability,
} from '$lib/v1/schemas';

/** Fetch + validate the trailing network-trend series. */
export async function getNetworkTrend(): Promise<NetworkTrend> {
	return adapter.historic.networkTrend();
}

/** Fetch + validate the worst-cell hotspots roll-up. */
export async function getHotspots(): Promise<Hotspots> {
	return adapter.historic.hotspots();
}

/** Fetch + validate the repeat-offenders roll-up. */
export async function getRepeatOffenders(): Promise<RepeatOffenders> {
	return adapter.historic.repeatOffenders();
}

/** Fetch + validate the resolved/expired alert-history log. */
export async function getAlertHistory(): Promise<AlertHistory> {
	return adapter.historic.alertHistory();
}

/** Fetch + validate the discovery index of published receipt dates. */
export async function getReceiptsIndex(): Promise<ReceiptsIndex> {
	return adapter.historic.receiptsIndex();
}

/**
 * Fetch + validate one day's network receipt.
 * `null` = HTTP 404 (no receipt for this date) — render empty state, not error.
 */
export async function getReceipt(date: string): Promise<Receipt | null> {
	return adapter.historic.receipt(date);
}

/**
 * Fetch + validate one route's reliability detail.
 * `null` = HTTP 404 (no data for this route) — render empty state, not an error.
 */
export async function getRouteReliability(routeId: string): Promise<RouteReliability | null> {
	return adapter.historic.routeReliability(routeId);
}

/**
 * Fetch + validate one stop's reliability detail.
 * `null` = HTTP 404 (no data for this stop) — render empty state, not an error.
 */
export async function getStopReliability(stopId: string): Promise<StopReliability | null> {
	return adapter.historic.stopReliability(stopId);
}

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
import type { AdapterCtx } from '$lib/v1/adapter';
import type { DateWindow } from '$lib/filters';
import {
	HistoryArtifactContractError,
	assertSafeHistoryArtifactPath,
	loadHistoryPartitions,
	mergeAlertArchivePages,
	selectAlertEntriesForWindow,
	selectAlertPageRefs,
	strictIsoDate,
} from '$lib/v1/history';
import type {
	AlertArchiveEntry,
	AlertArchiveIndex,
	AlertHistory,
	HistoricAvailabilityIndex,
	Hotspots,
	NetworkTrend,
	Receipt,
	ReceiptsIndex,
	RepeatOffenders,
	RouteReliability,
	StopReliability,
} from '$lib/v1/schemas';

/** Fetch the optional shared retained-history availability root. */
export async function getHistoricAvailability(
	ctx?: AdapterCtx,
): Promise<HistoricAvailabilityIndex | null> {
	return adapter.historic.historyIndex(ctx);
}

export async function getAlertArchiveIndex(ctx?: AdapterCtx): Promise<AlertArchiveIndex | null> {
	return adapter.historic.alertArchiveIndex(ctx);
}

export async function getAlertArchiveRange(
	index: AlertArchiveIndex,
	window: DateWindow,
	ctx?: AdapterCtx,
): Promise<AlertArchiveEntry[]> {
	const refs = selectAlertPageRefs(index, window);
	for (const ref of refs) assertSafeHistoryArtifactPath(ref.path);

	const pages = await loadHistoryPartitions(
		refs,
		async (ref, signal) => {
			const page = await adapter.historic.alertArchivePage(ref.path, { ...ctx, signal });
			if (page === null) {
				throw new HistoryArtifactContractError(ref.path, 'advertised history artifact not found');
			}
			return page;
		},
		{ signal: ctx?.signal },
	);
	return selectAlertEntriesForWindow(mergeAlertArchivePages(pages), window);
}

/** Fetch + validate the trailing network-trend series. */
export async function getNetworkTrend(ctx?: AdapterCtx): Promise<NetworkTrend> {
	return adapter.historic.networkTrend(ctx);
}

/** Fetch + validate the worst-cell hotspots roll-up. */
export async function getHotspots(ctx?: AdapterCtx): Promise<Hotspots> {
	return adapter.historic.hotspots(ctx);
}

/** Fetch + validate the repeat-offenders roll-up. */
export async function getRepeatOffenders(ctx?: AdapterCtx): Promise<RepeatOffenders> {
	return adapter.historic.repeatOffenders(ctx);
}

/** Fetch + validate the resolved/expired alert-history log. */
export async function getAlertHistory(ctx?: AdapterCtx): Promise<AlertHistory> {
	return adapter.historic.alertHistory(ctx);
}

/** Fetch + validate the discovery index of published receipt dates. */
export async function getReceiptsIndex(ctx?: AdapterCtx): Promise<ReceiptsIndex> {
	return adapter.historic.receiptsIndex(ctx);
}

/**
 * Fetch the route-reliability discovery index as a Set of route ids WITH a published
 * reliability file — the always-current daily availability set (the static routes_index
 * `reliability` flag can lag it). `null` = the index is not published yet (HTTP 404), so
 * callers fall back to the legacy flag and the rollout window never breaks.
 */
export async function getRouteReliabilityIndex(ctx?: AdapterCtx): Promise<Set<string> | null> {
	const idx = await adapter.historic.routeReliabilityIndex(ctx);
	return idx ? new Set(idx.route_ids ?? []) : null;
}

/**
 * Fetch + validate one day's network receipt.
 * `null` = HTTP 404 (no receipt for this date) — render empty state, not error.
 */
export async function getReceipt(date: string, ctx?: AdapterCtx): Promise<Receipt | null> {
	return adapter.historic.receipt(date, ctx);
}

export async function getAdvertisedReceipt(
	index: ReceiptsIndex,
	date: string,
	ctx?: AdapterCtx,
): Promise<Receipt> {
	if (!strictIsoDate(date)) {
		throw new RangeError(`invalid receipt date: ${date}`);
	}
	if (!(index.dates ?? []).includes(date)) {
		throw new RangeError(`receipt date is not advertised: ${date}`);
	}

	const receipt = await adapter.historic.receipt(date, ctx);
	if (receipt === null) {
		throw new HistoryArtifactContractError(date, 'advertised receipt not found');
	}
	return receipt;
}

/**
 * Fetch + validate one route's reliability detail.
 * `null` = HTTP 404 (no data for this route) — render empty state, not an error.
 */
export async function getRouteReliability(
	routeId: string,
	ctx?: AdapterCtx,
): Promise<RouteReliability | null> {
	return adapter.historic.routeReliability(routeId, ctx);
}

/**
 * Fetch + validate one stop's reliability detail.
 * `null` = HTTP 404 (no data for this stop) — render empty state, not an error.
 */
export async function getStopReliability(
	stopId: string,
	ctx?: AdapterCtx,
): Promise<StopReliability | null> {
	return adapter.historic.stopReliability(stopId, ctx);
}

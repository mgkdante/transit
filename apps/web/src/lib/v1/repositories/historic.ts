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
import { sha256Hex, type RawJsonEntity } from '$lib/v1/http';
import {
	HistoryArtifactContractError,
	HistoryTransientPublicationError,
	assertSafeHistoryArtifactPath,
	encodeHistoryEntityId,
	loadHistoryPartitions,
	mergeAlertArchivePages,
	selectLineHistoryPartitionRefs,
	selectNetworkHistoryPartitionRefs,
	selectAlertEntriesForWindow,
	selectAlertPageRefs,
	selectStopHistoryPartitionRefs,
	strictIsoDate,
	validateLineHistoryPartition,
	validateNetworkHistoryPartition,
	validateStopHistoryPartition,
} from '$lib/v1/history';
import type {
	AlertArchiveEntry,
	AlertArchiveIndex,
	AlertHistory,
	HistoricAvailabilityIndex,
	HistoricCollectionIndex,
	HistoricEntityDirectoryIndex,
	HistoricFamilyAvailability,
	HistoricPartitionRef,
	Hotspots,
	LineHistoryPartition,
	NetworkTrend,
	NetworkHistoryPartition,
	Receipt,
	ReceiptsIndex,
	RepeatOffenders,
	RouteReliability,
	StopReliability,
	StopHistoryPartition,
} from '$lib/v1/schemas';

/** Fetch the optional shared retained-history availability root. */
export async function getHistoricAvailability(
	ctx?: AdapterCtx,
): Promise<HistoricAvailabilityIndex | null> {
	return adapter.historic.historyIndex(ctx);
}

const SHA256 = /^[0-9a-f]{64}$/;
const ALL_HISTORY: DateWindow = { from: '0001-01-01', to: '9999-12-31' };

function historyRootPath(): string {
	return 'historic/history/index.json';
}

function familyIndexPath(family: 'network' | 'lines' | 'stops'): string {
	return `historic/history/${family}/index.json`;
}

function rootEdge(
	root: HistoricAvailabilityIndex,
	family: 'network' | 'lines' | 'stops',
): HistoricFamilyAvailability | null {
	const matches = (root.families ?? []).filter((entry) => entry.family === family);
	if (matches.length > 1) {
		throw new HistoryArtifactContractError(historyRootPath(), `duplicate ${family} root edge`);
	}
	const edge = matches[0];
	if (edge === undefined) return null;
	const expectedPath = familyIndexPath(family);
	if (
		edge.selection_mode !== 'range' ||
		edge.index_path !== expectedPath ||
		!SHA256.test(edge.collection_generation_id ?? '')
	) {
		throw new HistoryArtifactContractError(edge.index_path, `invalid ${family} root edge`);
	}
	return edge;
}

function assertDirectory(
	family: 'lines' | 'stops',
	directory: HistoricEntityDirectoryIndex,
): HistoricEntityDirectoryIndex {
	const path = familyIndexPath(family);
	if (
		directory.family !== family ||
		directory.selection_mode !== 'range' ||
		!SHA256.test(directory.collection_generation_id)
	) {
		throw new HistoryArtifactContractError(path, `invalid ${family} history directory`);
	}
	const ids = new Set<string>();
	const encodedIds = new Set<string>();
	const paths = new Set<string>();
	for (const entity of directory.entities ?? []) {
		const encoded = encodeHistoryEntityId(entity.entity_id);
		const expectedPath = `historic/history/${family}/${encoded}/index.json`;
		if (
			entity.encoded_id !== encoded ||
			entity.index_path !== expectedPath ||
			!SHA256.test(entity.collection_generation_id)
		) {
			throw new HistoryArtifactContractError(entity.index_path, `invalid ${family} entity edge`);
		}
		if (
			ids.has(entity.entity_id) ||
			encodedIds.has(entity.encoded_id) ||
			paths.has(entity.index_path)
		) {
			throw new HistoryArtifactContractError(entity.index_path, 'duplicate history entity edge');
		}
		ids.add(entity.entity_id);
		encodedIds.add(entity.encoded_id);
		paths.add(entity.index_path);
	}
	return directory;
}

function assertCollection(
	family: 'network' | 'lines' | 'stops',
	entityId: string | null,
	index: HistoricCollectionIndex,
): HistoricCollectionIndex {
	if (family === 'network') selectNetworkHistoryPartitionRefs(index, ALL_HISTORY);
	else if (family === 'lines') selectLineHistoryPartitionRefs(entityId!, index, ALL_HISTORY);
	else selectStopHistoryPartitionRefs(entityId!, index, ALL_HISTORY);
	return index;
}

function abortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

async function refreshRootPin(
	family: 'network' | 'lines' | 'stops',
	childGeneration: string,
	ctx?: AdapterCtx,
): Promise<void> {
	try {
		const freshRoot = await adapter.historic.historyIndex({
			...ctx,
			freshHistoryParent: true,
		});
		const freshEdge = freshRoot == null ? null : rootEdge(freshRoot, family);
		if (freshEdge?.collection_generation_id === childGeneration) return;
	} catch (error) {
		if (abortError(error)) throw error;
	}
	throw new HistoryTransientPublicationError(
		familyIndexPath(family),
		`${family} generation still disagrees after one root refresh`,
	);
}

async function getFamilyDirectory(
	family: 'lines' | 'stops',
	ctx?: AdapterCtx,
): Promise<HistoricEntityDirectoryIndex | null> {
	const root = await adapter.historic.historyIndex(ctx);
	if (root === null) return null;
	const edge = rootEdge(root, family);
	if (edge === null) return null;
	const directory =
		family === 'lines'
			? await adapter.historic.lineHistoryDirectory(ctx)
			: await adapter.historic.stopHistoryDirectory(ctx);
	if (directory === null) {
		throw new HistoryArtifactContractError(
			edge.index_path,
			'advertised history directory not found',
		);
	}
	assertDirectory(family, directory);
	if (directory.collection_generation_id !== edge.collection_generation_id) {
		await refreshRootPin(family, directory.collection_generation_id, ctx);
	}
	return directory;
}

export async function getNetworkHistoryIndex(
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	const root = await adapter.historic.historyIndex(ctx);
	if (root === null) return null;
	const edge = rootEdge(root, 'network');
	if (edge === null) return null;
	const index = await adapter.historic.networkHistoryIndex(ctx);
	if (index === null) {
		throw new HistoryArtifactContractError(edge.index_path, 'advertised history index not found');
	}
	assertCollection('network', null, index);
	if (index.collection_generation_id !== edge.collection_generation_id) {
		await refreshRootPin('network', index.collection_generation_id!, ctx);
	}
	return index;
}

export function getLineHistoryDirectory(
	ctx?: AdapterCtx,
): Promise<HistoricEntityDirectoryIndex | null> {
	return getFamilyDirectory('lines', ctx);
}

export function getStopHistoryDirectory(
	ctx?: AdapterCtx,
): Promise<HistoricEntityDirectoryIndex | null> {
	return getFamilyDirectory('stops', ctx);
}

async function getEntityHistoryIndex(
	family: 'lines' | 'stops',
	entityId: string,
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	const directory = await getFamilyDirectory(family, ctx);
	if (directory === null) return null;
	const edge = (directory.entities ?? []).find((entity) => entity.entity_id === entityId);
	if (edge === undefined) return null;
	const index =
		family === 'lines'
			? await adapter.historic.lineHistoryIndex(entityId, ctx)
			: await adapter.historic.stopHistoryIndex(entityId, ctx);
	if (index === null) {
		throw new HistoryArtifactContractError(
			edge.index_path,
			'advertised entity history index not found',
		);
	}
	assertCollection(family, entityId, index);
	if (index.collection_generation_id !== edge.collection_generation_id) {
		let freshDirectory: HistoricEntityDirectoryIndex | null;
		try {
			freshDirectory =
				family === 'lines'
					? await adapter.historic.lineHistoryDirectory({
							...ctx,
							freshHistoryParent: true,
						})
					: await adapter.historic.stopHistoryDirectory({
							...ctx,
							freshHistoryParent: true,
						});
			if (freshDirectory !== null) assertDirectory(family, freshDirectory);
		} catch (error) {
			if (abortError(error)) throw error;
			freshDirectory = null;
		}
		const freshEdge = (freshDirectory?.entities ?? []).find(
			(entity) => entity.entity_id === entityId,
		);
		if (
			freshDirectory?.collection_generation_id !== directory.collection_generation_id ||
			freshEdge?.collection_generation_id !== index.collection_generation_id
		) {
			throw new HistoryTransientPublicationError(
				edge.index_path,
				`${family} directory chain still disagrees after one directory refresh`,
			);
		}
	}
	return index;
}

export function getLineHistoryIndex(
	entityId: string,
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	return getEntityHistoryIndex('lines', entityId, ctx);
}

export function getStopHistoryIndex(
	entityId: string,
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	return getEntityHistoryIndex('stops', entityId, ctx);
}

async function verifyPartitionBytes<T>(
	ref: HistoricPartitionRef,
	raw: RawJsonEntity<T>,
): Promise<void> {
	if (raw.bytes.byteLength !== ref.byte_size) {
		throw new HistoryArtifactContractError(ref.path, 'advertised partition byte size mismatch');
	}
	const digest = await sha256Hex(raw.bytes);
	if (digest !== ref.sha256) {
		throw new HistoryArtifactContractError(ref.path, 'advertised partition SHA-256 mismatch');
	}
}

export async function loadNetworkHistoryRange(
	index: HistoricCollectionIndex,
	window: DateWindow,
	ctx?: AdapterCtx,
): Promise<NetworkHistoryPartition[]> {
	const refs = selectNetworkHistoryPartitionRefs(index, window);
	return loadHistoryPartitions(
		refs,
		async (ref, signal) => {
			const raw = await adapter.historic.networkHistoryPartition(ref.path, { ...ctx, signal });
			if (raw === null) {
				throw new HistoryArtifactContractError(ref.path, 'advertised history partition not found');
			}
			await verifyPartitionBytes(ref, raw);
			return validateNetworkHistoryPartition(index, ref, raw.value);
		},
		{ signal: ctx?.signal },
	);
}

export async function loadLineHistoryRange(
	entityId: string,
	index: HistoricCollectionIndex,
	window: DateWindow,
	ctx?: AdapterCtx,
): Promise<LineHistoryPartition[]> {
	const refs = selectLineHistoryPartitionRefs(entityId, index, window);
	return loadHistoryPartitions(
		refs,
		async (ref, signal) => {
			const raw = await adapter.historic.lineHistoryPartition(entityId, ref.path, {
				...ctx,
				signal,
			});
			if (raw === null) {
				throw new HistoryArtifactContractError(ref.path, 'advertised history partition not found');
			}
			await verifyPartitionBytes(ref, raw);
			return validateLineHistoryPartition(entityId, index, ref, raw.value);
		},
		{ signal: ctx?.signal },
	);
}

export async function loadStopHistoryRange(
	entityId: string,
	index: HistoricCollectionIndex,
	window: DateWindow,
	ctx?: AdapterCtx,
): Promise<StopHistoryPartition[]> {
	const refs = selectStopHistoryPartitionRefs(entityId, index, window);
	return loadHistoryPartitions(
		refs,
		async (ref, signal) => {
			const raw = await adapter.historic.stopHistoryPartition(entityId, ref.path, {
				...ctx,
				signal,
			});
			if (raw === null) {
				throw new HistoryArtifactContractError(ref.path, 'advertised history partition not found');
			}
			await verifyPartitionBytes(ref, raw);
			return validateStopHistoryPartition(entityId, index, ref, raw.value);
		},
		{ signal: ctx?.signal },
	);
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
	if (receipt.date !== date) {
		throw new HistoryArtifactContractError(
			date,
			`advertised receipt date mismatch (received ${receipt.date})`,
		);
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

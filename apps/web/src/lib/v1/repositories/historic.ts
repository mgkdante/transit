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
	addIsoDays,
	assertSafeHistoryArtifactPath,
	canonicalHistoryJson,
	encodeHistoryEntityId,
	isHistoryEntityIndexPath,
	isHistoryFamilyIndexPath,
	isHistoryPointArtifactPath,
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
	HistoricHotspotsDay,
	HistoricPartitionRef,
	HistoricRepeatOffendersDay,
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
type PointHistoryFamily = 'hotspots' | 'repeat_offenders';

interface PointHistoryDayByFamily {
	readonly hotspots: HistoricHotspotsDay;
	readonly repeat_offenders: HistoricRepeatOffendersDay;
}

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
	if (
		edge.selection_mode !== 'range' ||
		!isHistoryFamilyIndexPath(family, edge.index_path) ||
		!SHA256.test(edge.collection_generation_id ?? '')
	) {
		throw new HistoryArtifactContractError(edge.index_path, `invalid ${family} root edge`);
	}
	return edge;
}

function pointRootEdge(
	root: HistoricAvailabilityIndex,
	family: PointHistoryFamily,
): HistoricFamilyAvailability | null {
	const matches = (root.families ?? []).filter((entry) => entry.family === family);
	if (matches.length > 1) {
		throw new HistoryArtifactContractError(historyRootPath(), `duplicate ${family} root edge`);
	}
	const edge = matches[0];
	if (edge === undefined) return null;
	if (
		edge.selection_mode !== 'date' ||
		!isHistoryFamilyIndexPath(family, edge.index_path) ||
		!SHA256.test(edge.collection_generation_id ?? '') ||
		(edge.metrics ?? []).length !== 0
	) {
		throw new HistoryArtifactContractError(edge.index_path, `invalid ${family} root edge`);
	}
	const first = edge.first_available_date;
	const last = edge.last_available_date;
	if (
		(first == null) !== (last == null) ||
		(first != null && (!strictIsoDate(first) || !strictIsoDate(last) || first > last!))
	) {
		throw new HistoryArtifactContractError(edge.index_path, `invalid ${family} root coverage`);
	}
	return edge;
}

function pointIndexError(path: string, message: string): never {
	throw new HistoryArtifactContractError(path, message);
}

function pointHistoryGaps(dates: readonly string[]): Array<{
	readonly start_date: string;
	readonly end_date: string;
	readonly reason: null;
}> {
	const gaps: Array<{ start_date: string; end_date: string; reason: null }> = [];
	for (let position = 1; position < dates.length; position += 1) {
		const start = addIsoDays(dates[position - 1], 1);
		const end = addIsoDays(dates[position], -1);
		if (start <= end) gaps.push({ start_date: start, end_date: end, reason: null });
	}
	return gaps;
}

function exactPointGaps(
	actual: HistoricCollectionIndex['gaps'],
	expected: ReturnType<typeof pointHistoryGaps>,
): boolean {
	const gaps = actual ?? [];
	return (
		gaps.length === expected.length &&
		gaps.every(
			(gap, position) =>
				gap.start_date === expected[position]?.start_date &&
				gap.end_date === expected[position]?.end_date &&
				gap.reason == null,
		)
	);
}

function pointGenerationBasis(
	index: HistoricCollectionIndex,
	family: PointHistoryFamily,
	dates: readonly string[],
	refs: readonly HistoricPartitionRef[],
) {
	return {
		family,
		selection_mode: 'date',
		entity_id: null,
		first_available_date: dates[0] ?? null,
		last_available_date: dates.at(-1) ?? null,
		available_dates: [...dates],
		gaps: (index.gaps ?? []).map((gap) => ({
			start_date: gap.start_date,
			end_date: gap.end_date,
			reason: gap.reason ?? null,
		})),
		partitions: refs.map((ref) => ({
			path: ref.path,
			coverage_start: ref.coverage_start,
			coverage_end: ref.coverage_end,
			count: ref.count,
			sha256: ref.sha256,
			byte_size: ref.byte_size,
		})),
		metrics: [],
	};
}

async function assertPointHistoryIndex(
	family: PointHistoryFamily,
	index: HistoricCollectionIndex,
	path: string,
): Promise<HistoricCollectionIndex> {
	if (
		index.family !== family ||
		index.selection_mode !== 'date' ||
		index.entity_id != null ||
		!SHA256.test(index.collection_generation_id ?? '') ||
		index.methodology_version !== 'history-1' ||
		typeof index.publish_generation_id !== 'string' ||
		index.publish_generation_id.length === 0 ||
		(index.metrics ?? []).length !== 0
	) {
		pointIndexError(path, `invalid ${family} point history index identity`);
	}

	const dates = index.available_dates ?? [];
	if (
		dates.some((date) => !strictIsoDate(date)) ||
		dates.some((date, position) => position > 0 && date <= dates[position - 1])
	) {
		pointIndexError(path, `${family} available dates must be real, sorted, and unique`);
	}
	const first = dates[0] ?? null;
	const last = dates.at(-1) ?? null;
	const expectedGaps = pointHistoryGaps(dates);
	if (
		index.first_available_date !== first ||
		index.last_available_date !== last ||
		!exactPointGaps(index.gaps, expectedGaps)
	) {
		pointIndexError(path, `${family} point history coverage does not match available dates`);
	}

	const refs = index.partitions ?? [];
	if (refs.length !== dates.length) {
		pointIndexError(path, `${family} point history requires one ref per available date`);
	}
	const paths = new Set<string>();
	for (const [position, date] of dates.entries()) {
		const ref = refs[position];
		if (ref === undefined) {
			pointIndexError(path, `${family} point history ref is missing`);
		}
		if (
			ref.coverage_start !== date ||
			ref.coverage_end !== date ||
			ref.count !== 1 ||
			!SHA256.test(ref.sha256 ?? '') ||
			!Number.isSafeInteger(ref.byte_size) ||
			(ref.byte_size ?? 0) <= 0 ||
			!isHistoryPointArtifactPath(family, date, ref.path) ||
			!ref.path.includes(`/generations/${ref.sha256}/`)
		) {
			pointIndexError(ref.path, `invalid ${family} point history ref for ${date}`);
		}
		if (paths.has(ref.path)) {
			pointIndexError(ref.path, `duplicate ${family} point history ref`);
		}
		paths.add(ref.path);
	}

	const expectedGeneration = await sha256Hex(
		new TextEncoder().encode(
			canonicalHistoryJson(pointGenerationBasis(index, family, dates, refs)),
		),
	);
	if (index.collection_generation_id !== expectedGeneration) {
		pointIndexError(path, `${family} collection generation does not match exact index semantics`);
	}
	return index;
}

function pointRootMatchesIndex(
	edge: HistoricFamilyAvailability,
	index: HistoricCollectionIndex,
): boolean {
	return (
		edge.collection_generation_id === index.collection_generation_id &&
		edge.first_available_date === index.first_available_date &&
		edge.last_available_date === index.last_available_date &&
		exactPointGaps(edge.gaps, pointHistoryGaps(index.available_dates ?? [])) &&
		(edge.metrics ?? []).length === 0
	);
}

function readPointHistoryIndex(
	family: PointHistoryFamily,
	path: string,
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	return family === 'hotspots'
		? adapter.historic.hotspotsHistoryIndex(path, ctx)
		: adapter.historic.repeatOffendersHistoryIndex(path, ctx);
}

async function getPointHistoryIndex(
	family: PointHistoryFamily,
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	const root = await adapter.historic.historyIndex(ctx);
	if (root === null) return null;
	const edge = pointRootEdge(root, family);
	if (edge === null) return null;
	const index = await readPointHistoryIndex(family, edge.index_path, ctx);
	if (index === null) {
		throw new HistoryArtifactContractError(edge.index_path, 'advertised history index not found');
	}
	await assertPointHistoryIndex(family, index, edge.index_path);
	if (pointRootMatchesIndex(edge, index)) return index;

	const refreshCtx = freshHistoryCtx(ctx);
	let freshRoot: HistoricAvailabilityIndex;
	try {
		const refreshed = await adapter.historic.historyIndex(refreshCtx);
		if (refreshed === null) {
			throw new HistoryTransientPublicationError(
				edge.index_path,
				`${family} root disappeared during bounded pointer-chain refresh`,
			);
		}
		freshRoot = refreshed;
	} catch (error) {
		if (abortError(error)) throw error;
		if (error instanceof HistoryTransientPublicationError) throw error;
		throw new HistoryTransientPublicationError(
			edge.index_path,
			`${family} root could not be refreshed during bounded pointer-chain recovery`,
		);
	}
	const freshEdge = pointRootEdge(freshRoot, family);
	if (freshEdge === null) {
		throw new HistoryTransientPublicationError(
			edge.index_path,
			`${family} root edge disappeared during bounded pointer-chain refresh`,
		);
	}
	if (freshEdge.index_path === edge.index_path && pointRootMatchesIndex(freshEdge, index)) {
		return index;
	}

	const freshIndex = await readPointHistoryIndex(family, freshEdge.index_path, refreshCtx);
	if (freshIndex === null) {
		throw new HistoryArtifactContractError(
			freshEdge.index_path,
			'advertised history index not found',
		);
	}
	await assertPointHistoryIndex(family, freshIndex, freshEdge.index_path);
	if (pointRootMatchesIndex(freshEdge, freshIndex)) return freshIndex;
	throw new HistoryTransientPublicationError(
		freshEdge.index_path,
		`${family} generation still disagrees after one bounded pointer-chain refresh`,
	);
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
		if (
			entity.encoded_id !== encoded ||
			!isHistoryEntityIndexPath(family, entity.entity_id, entity.index_path) ||
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

function freshHistoryCtx(ctx?: AdapterCtx): AdapterCtx {
	return { ...ctx, freshHistoryParent: true };
}

async function refreshRootEdge(
	family: 'network' | 'lines' | 'stops',
	ctx?: AdapterCtx,
): Promise<HistoricFamilyAvailability | null> {
	try {
		const freshRoot = await adapter.historic.historyIndex(freshHistoryCtx(ctx));
		return freshRoot == null ? null : rootEdge(freshRoot, family);
	} catch (error) {
		if (abortError(error)) throw error;
		return null;
	}
}

function transientGeneration(family: 'network' | 'lines' | 'stops', message: string): never {
	throw new HistoryTransientPublicationError(familyIndexPath(family), message);
}

async function getFamilyDirectory(
	family: 'lines' | 'stops',
	ctx?: AdapterCtx,
): Promise<HistoricEntityDirectoryIndex | null> {
	return (await getFamilyDirectoryDiscovery(family, ctx))?.directory ?? null;
}

interface FamilyDirectoryDiscovery {
	readonly directory: HistoricEntityDirectoryIndex;
	readonly indexPath: string;
}

async function getFamilyDirectoryDiscovery(
	family: 'lines' | 'stops',
	ctx?: AdapterCtx,
): Promise<FamilyDirectoryDiscovery | null> {
	const root = await adapter.historic.historyIndex(ctx);
	if (root === null) return null;
	const edge = rootEdge(root, family);
	if (edge === null) return null;
	const directory =
		family === 'lines'
			? await adapter.historic.lineHistoryDirectory(edge.index_path, ctx)
			: await adapter.historic.stopHistoryDirectory(edge.index_path, ctx);
	if (directory === null) {
		throw new HistoryArtifactContractError(
			edge.index_path,
			'advertised history directory not found',
		);
	}
	assertDirectory(family, directory);
	if (directory.collection_generation_id !== edge.collection_generation_id) {
		const freshEdge = await refreshRootEdge(family, ctx);
		if (
			freshEdge?.collection_generation_id === directory.collection_generation_id &&
			freshEdge.index_path === edge.index_path
		) {
			return { directory, indexPath: edge.index_path };
		}
		if (freshEdge !== null) {
			const freshDirectory =
				family === 'lines'
					? await adapter.historic.lineHistoryDirectory(freshEdge.index_path, freshHistoryCtx(ctx))
					: await adapter.historic.stopHistoryDirectory(freshEdge.index_path, freshHistoryCtx(ctx));
			if (freshDirectory === null) {
				throw new HistoryArtifactContractError(
					freshEdge.index_path,
					'advertised history directory not found',
				);
			}
			assertDirectory(family, freshDirectory);
			if (freshDirectory.collection_generation_id === freshEdge.collection_generation_id) {
				return { directory: freshDirectory, indexPath: freshEdge.index_path };
			}
		}
		transientGeneration(
			family,
			`${family} generation still disagrees after one bounded pointer-chain refresh`,
		);
	}
	return { directory, indexPath: edge.index_path };
}

export async function getNetworkHistoryIndex(
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	const root = await adapter.historic.historyIndex(ctx);
	if (root === null) return null;
	const edge = rootEdge(root, 'network');
	if (edge === null) return null;
	const index = await adapter.historic.networkHistoryIndex(edge.index_path, ctx);
	if (index === null) {
		throw new HistoryArtifactContractError(edge.index_path, 'advertised history index not found');
	}
	assertCollection('network', null, index);
	if (index.collection_generation_id !== edge.collection_generation_id) {
		const freshEdge = await refreshRootEdge('network', ctx);
		if (
			freshEdge !== null &&
			freshEdge.collection_generation_id === index.collection_generation_id &&
			freshEdge.index_path === edge.index_path
		) {
			return index;
		}
		if (freshEdge !== null) {
			const freshIndex = await adapter.historic.networkHistoryIndex(
				freshEdge.index_path,
				freshHistoryCtx(ctx),
			);
			if (freshIndex === null) {
				throw new HistoryArtifactContractError(
					freshEdge.index_path,
					'advertised history index not found',
				);
			}
			assertCollection('network', null, freshIndex);
			if (freshIndex.collection_generation_id === freshEdge.collection_generation_id) {
				return freshIndex;
			}
		}
		transientGeneration(
			'network',
			'network generation still disagrees after one bounded pointer-chain refresh',
		);
	}
	return index;
}

export function getHotspotsHistoryIndex(ctx?: AdapterCtx): Promise<HistoricCollectionIndex | null> {
	return getPointHistoryIndex('hotspots', ctx);
}

export function getRepeatOffendersHistoryIndex(
	ctx?: AdapterCtx,
): Promise<HistoricCollectionIndex | null> {
	return getPointHistoryIndex('repeat_offenders', ctx);
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
	const discovery = await getFamilyDirectoryDiscovery(family, ctx);
	if (discovery === null) return null;
	const { directory, indexPath: directoryPath } = discovery;
	const edge = (directory.entities ?? []).find((entity) => entity.entity_id === entityId);
	if (edge === undefined) return null;
	const index =
		family === 'lines'
			? await adapter.historic.lineHistoryIndex(entityId, edge.index_path, ctx)
			: await adapter.historic.stopHistoryIndex(entityId, edge.index_path, ctx);
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
					? await adapter.historic.lineHistoryDirectory(directoryPath, freshHistoryCtx(ctx))
					: await adapter.historic.stopHistoryDirectory(directoryPath, freshHistoryCtx(ctx));
			if (freshDirectory !== null) assertDirectory(family, freshDirectory);
		} catch (error) {
			if (abortError(error)) throw error;
			if (error instanceof HistoryArtifactContractError) throw error;
			throw new HistoryTransientPublicationError(
				edge.index_path,
				`${family} directory could not be refreshed during bounded pointer-chain recovery`,
			);
		}
		if (freshDirectory === null) {
			throw new HistoryArtifactContractError(
				directoryPath,
				'advertised history directory not found',
			);
		}
		let recoveryDirectory = freshDirectory;
		let recoveryDirectoryPath = directoryPath;
		let rootMatches =
			recoveryDirectory.collection_generation_id === directory.collection_generation_id;
		if (!rootMatches) {
			const freshRootEdge = await refreshRootEdge(family, ctx);
			if (freshRootEdge !== null && freshRootEdge.index_path !== recoveryDirectoryPath) {
				const rootDirectory =
					family === 'lines'
						? await adapter.historic.lineHistoryDirectory(
								freshRootEdge.index_path,
								freshHistoryCtx(ctx),
							)
						: await adapter.historic.stopHistoryDirectory(
								freshRootEdge.index_path,
								freshHistoryCtx(ctx),
							);
				if (rootDirectory === null) {
					throw new HistoryArtifactContractError(
						freshRootEdge.index_path,
						'advertised history directory not found',
					);
				}
				assertDirectory(family, rootDirectory);
				recoveryDirectory = rootDirectory;
				recoveryDirectoryPath = freshRootEdge.index_path;
			}
			rootMatches =
				freshRootEdge !== null &&
				freshRootEdge.index_path === recoveryDirectoryPath &&
				freshRootEdge.collection_generation_id === recoveryDirectory.collection_generation_id;
		}
		const freshEdge = (recoveryDirectory.entities ?? []).find(
			(entity) => entity.entity_id === entityId,
		);
		if (
			rootMatches &&
			freshEdge !== undefined &&
			freshEdge.collection_generation_id === index.collection_generation_id &&
			freshEdge.index_path === edge.index_path
		) {
			return index;
		}
		if (rootMatches && freshEdge !== undefined) {
			const freshIndex =
				family === 'lines'
					? await adapter.historic.lineHistoryIndex(
							entityId,
							freshEdge.index_path,
							freshHistoryCtx(ctx),
						)
					: await adapter.historic.stopHistoryIndex(
							entityId,
							freshEdge.index_path,
							freshHistoryCtx(ctx),
						);
			if (freshIndex === null) {
				throw new HistoryArtifactContractError(
					freshEdge.index_path,
					'advertised entity history index not found',
				);
			}
			assertCollection(family, entityId, freshIndex);
			if (freshIndex.collection_generation_id === freshEdge.collection_generation_id) {
				return freshIndex;
			}
		}
		throw new HistoryTransientPublicationError(
			edge.index_path,
			`${family} directory chain still disagrees after one bounded pointer-chain refresh`,
		);
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

function readPointHistoryDay<F extends PointHistoryFamily>(
	family: F,
	date: string,
	path: string,
	ctx?: AdapterCtx,
): Promise<RawJsonEntity<PointHistoryDayByFamily[F]> | null> {
	return (
		family === 'hotspots'
			? adapter.historic.hotspotsHistoryDay(date, path, ctx)
			: adapter.historic.repeatOffendersHistoryDay(date, path, ctx)
	) as Promise<RawJsonEntity<PointHistoryDayByFamily[F]> | null>;
}

async function getPointHistoryDay<F extends PointHistoryFamily>(
	family: F,
	date: string,
	index: HistoricCollectionIndex,
	ctx?: AdapterCtx,
): Promise<PointHistoryDayByFamily[F]> {
	await assertPointHistoryIndex(family, index, historyRootPath());
	const dates = index.available_dates ?? [];
	if (!strictIsoDate(date)) {
		throw new RangeError(`invalid ${family} history date: ${date}`);
	}
	if (!dates.includes(date)) {
		throw new RangeError(`${family} history date is not advertised: ${date}`);
	}
	if (date === dates.at(-1)) {
		throw new RangeError(`${family} latest history date uses the current snapshot: ${date}`);
	}
	const position = dates.indexOf(date);
	const ref = index.partitions?.[position];
	if (ref === undefined) {
		throw new HistoryArtifactContractError(historyRootPath(), 'advertised history ref not found');
	}
	const raw = await readPointHistoryDay(family, date, ref.path, ctx);
	if (raw === null) {
		throw new HistoryArtifactContractError(ref.path, 'advertised history artifact not found');
	}
	await verifyPartitionBytes(ref, raw);
	if (
		raw.value.date !== date ||
		raw.value.methodology_version !== 'reliability-1' ||
		raw.value.publish_generation_id != null
	) {
		throw new HistoryArtifactContractError(ref.path, 'advertised point history payload mismatch');
	}
	if (family === 'repeat_offenders') {
		const repeat = raw.value as HistoricRepeatOffendersDay;
		if ((repeat.by_grain ?? []).some((grain) => grain.window_end !== date)) {
			throw new HistoryArtifactContractError(
				ref.path,
				'advertised repeat-offender grain endpoint mismatch',
			);
		}
	}
	return raw.value;
}

export function getHotspotsHistoryDay(
	date: string,
	index: HistoricCollectionIndex,
	ctx?: AdapterCtx,
): Promise<HistoricHotspotsDay> {
	return getPointHistoryDay('hotspots', date, index, ctx);
}

export function getRepeatOffendersHistoryDay(
	date: string,
	index: HistoricCollectionIndex,
	ctx?: AdapterCtx,
): Promise<HistoricRepeatOffendersDay> {
	return getPointHistoryDay('repeat_offenders', date, index, ctx);
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

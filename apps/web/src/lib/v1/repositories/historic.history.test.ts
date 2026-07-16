import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdapterCtx } from '$lib/v1/adapter';
import { adapter } from '$lib/v1/adapter';
import { HistoryArtifactContractError, HistoryTransientPublicationError } from '$lib/v1/history';
import { sha256Hex } from '$lib/v1/http';
import {
	AlertArchiveIndexSchema,
	AlertArchivePageSchema,
	HistoricCollectionIndexSchema,
	HistoricEntityDirectoryIndexSchema,
	HistoricAvailabilityIndexSchema,
	type HistoricCollectionIndex,
	HistoricHotspotsDaySchema,
	type HistoricHotspotsDay,
	HistoricRepeatOffendersDaySchema,
	type HistoricRepeatOffendersDay,
	LineHistoryPartitionSchema,
	NetworkHistoryPartitionSchema,
	ReceiptSchema,
	ReceiptsIndexSchema,
	StopHistoryPartitionSchema,
} from '$lib/v1/schemas';
import {
	getAdvertisedReceipt,
	getAlertArchiveIndex,
	getAlertArchiveRange,
	clearAlertArchivePageMemoForTest,
	getHistoricAvailability,
	getHotspotsHistoryDay,
	getHotspotsHistoryIndex,
	getLineHistoryDirectory,
	getLineHistoryIndex,
	getNetworkHistoryIndex,
	getReceipt,
	getRepeatOffendersHistoryDay,
	getRepeatOffendersHistoryIndex,
	getStopHistoryDirectory,
	getStopHistoryIndex,
	loadLineHistoryRange,
	loadNetworkHistoryRange,
	loadStopHistoryRange,
} from './historic';

const ISO = '2026-03-31T12:00:00Z';
const GENERATION = 'b'.repeat(64);
const NEXT_GENERATION = 'c'.repeat(64);
const OLD_POINTER_SHA = 'd'.repeat(64);
const NEW_POINTER_SHA = 'e'.repeat(64);

function path(month: string, page: number): string {
	return `historic/alerts/generations/${GENERATION}/${month}/page-${String(page).padStart(4, '0')}.json`;
}

function ref(month: string, page: number, coverageStart: string, coverageEnd: string) {
	return {
		path: path(month, page),
		page,
		count: 1,
		byte_size: 100,
		sha256: `${month}-${page}`,
		coverage_start: coverageStart,
		coverage_end: coverageEnd,
	};
}

function archiveIndex(refs: ReturnType<typeof ref>[]) {
	return AlertArchiveIndexSchema.parse({
		generated_utc: ISO,
		collection_generation_id: GENERATION,
		first_available_date: '2026-01-01',
		last_available_date: '2026-03-31',
		total_alerts: refs.length,
		months: refs.map((item) => ({
			month: item.path.split('/').at(-2),
			total_alerts: 1,
			pages: [item],
		})),
	});
}

function archivePage(month: string, page: number, id: string, lastSeen: string) {
	return AlertArchivePageSchema.parse({
		generated_utc: ISO,
		month,
		page,
		alerts: [
			{
				id,
				start_utc: `${month}-01T08:00:00Z`,
				first_seen_utc: `${month}-01T08:00:00Z`,
				last_seen_utc: lastSeen,
			},
		],
	});
}

function availabilityRoot(
	families: Array<{
		family: string;
		index_path: string;
		collection_generation_id: string;
	}>,
) {
	return HistoricAvailabilityIndexSchema.parse({
		generated_utc: ISO,
		families: families.map((family) => ({ ...family, selection_mode: 'range' })),
	});
}

function rootFamily(
	family: 'network' | 'lines' | 'stops',
	generation = GENERATION,
	indexPath = `historic/history/${family}/index.json`,
) {
	return {
		family,
		index_path: indexPath,
		collection_generation_id: generation,
	};
}

function versionedFamilyPath(family: 'network' | 'lines' | 'stops', sha = OLD_POINTER_SHA): string {
	return `historic/history/${family}/generations/${sha}/index.json`;
}

function versionedEntityPath(
	family: 'lines' | 'stops',
	encodedId: string,
	sha = OLD_POINTER_SHA,
): string {
	return `historic/history/${family}/${encodedId}/generations/${sha}/index.json`;
}

function collectionIndex(
	family: 'network' | 'lines' | 'stops',
	generation = GENERATION,
	entityId: string | null = null,
	partitions: Array<Record<string, unknown>> = [],
	metrics: Array<Record<string, unknown>> = [],
) {
	const coverageStarts = partitions
		.map((partition) => partition.coverage_start)
		.filter((value): value is string => typeof value === 'string')
		.sort();
	const coverageEnds = partitions
		.map((partition) => partition.coverage_end)
		.filter((value): value is string => typeof value === 'string')
		.sort();
	return HistoricCollectionIndexSchema.parse({
		generated_utc: ISO,
		family,
		selection_mode: 'range',
		entity_id: entityId,
		collection_generation_id: generation,
		first_available_date: coverageStarts[0] ?? null,
		last_available_date: coverageEnds.at(-1) ?? null,
		partitions,
		metrics,
	});
}

function entityDirectory(
	family: 'lines' | 'stops',
	directoryGeneration = GENERATION,
	entityId = 'A/B',
	entityGeneration = GENERATION,
	entityIndexPath?: string,
) {
	const encodedId = Array.from(new TextEncoder().encode(entityId), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
	return HistoricEntityDirectoryIndexSchema.parse({
		generated_utc: ISO,
		family,
		selection_mode: 'range',
		collection_generation_id: directoryGeneration,
		entities: [
			{
				entity_id: entityId,
				encoded_id: encodedId,
				index_path: entityIndexPath ?? `historic/history/${family}/${encodedId}/index.json`,
				collection_generation_id: entityGeneration,
			},
		],
	});
}

async function networkArtifact(month: string, day: string) {
	const value = NetworkHistoryPartitionSchema.parse({
		generated_utc: ISO,
		month,
		days: [
			{
				date: day,
				delay: {
					observation_count: 10,
					in_clamp_observation_count: 10,
					on_time_count: 8,
					severe_count: 1,
					sum_delay_seconds: 100,
				},
			},
		],
	});
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const sha = await sha256Hex(bytes);
	return {
		value,
		bytes,
		ref: {
			path: `historic/history/network/generations/${sha}/${month}.json`,
			coverage_start: day,
			coverage_end: day,
			count: 1,
			sha256: sha,
			byte_size: bytes.byteLength,
		},
	};
}

async function entityArtifact(
	family: 'lines' | 'stops',
	entityId: string,
	month: string,
	day: string,
) {
	const encodedId = Array.from(new TextEncoder().encode(entityId), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
	const value =
		family === 'lines'
			? LineHistoryPartitionSchema.parse({
					generated_utc: ISO,
					month,
					entity_id: entityId,
					days: [
						{
							date: day,
							delay: {
								observation_count: 10,
								in_clamp_observation_count: 10,
								on_time_count: 8,
								severe_count: 1,
								sum_delay_seconds: 100,
							},
						},
					],
				})
			: StopHistoryPartitionSchema.parse({
					generated_utc: ISO,
					month,
					entity_id: entityId,
					days: [
						{
							date: day,
							delay: {
								observation_count: 10,
								in_clamp_observation_count: 10,
								severe_count: 1,
								sum_delay_seconds: 100,
							},
						},
					],
				});
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const sha = await sha256Hex(bytes);
	return {
		value,
		bytes,
		ref: {
			path: `historic/history/${family}/${encodedId}/generations/${sha}/${month}.json`,
			coverage_start: day,
			coverage_end: day,
			count: 1,
			sha256: sha,
			byte_size: bytes.byteLength,
		},
	};
}

type PointFamily = 'hotspots' | 'repeat_offenders';

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(',')}}`;
}

function internalDateGaps(dates: readonly string[]) {
	const gaps: Array<{ start_date: string; end_date: string; reason: null }> = [];
	for (let index = 1; index < dates.length; index += 1) {
		const previous = new Date(`${dates[index - 1]}T00:00:00Z`);
		const current = new Date(`${dates[index]}T00:00:00Z`);
		previous.setUTCDate(previous.getUTCDate() + 1);
		current.setUTCDate(current.getUTCDate() - 1);
		if (previous <= current) {
			gaps.push({
				start_date: previous.toISOString().slice(0, 10),
				end_date: current.toISOString().slice(0, 10),
				reason: null,
			});
		}
	}
	return gaps;
}

interface PointArtifact<T> {
	readonly value: T;
	readonly bytes: Uint8Array;
	readonly ref: {
		readonly path: string;
		readonly coverage_start: string;
		readonly coverage_end: string;
		readonly count: number;
		readonly sha256: string;
		readonly byte_size: number;
	};
}

function pointArtifact(
	family: 'hotspots',
	date: string,
): Promise<PointArtifact<HistoricHotspotsDay>>;
function pointArtifact(
	family: 'repeat_offenders',
	date: string,
): Promise<PointArtifact<HistoricRepeatOffendersDay>>;
async function pointArtifact(
	family: PointFamily,
	date: string,
): Promise<PointArtifact<HistoricHotspotsDay | HistoricRepeatOffendersDay>> {
	const value =
		family === 'hotspots'
			? HistoricHotspotsDaySchema.parse({
					generated_utc: ISO,
					date,
					hotspots: [],
					by_grain: [],
					methodology_version: 'reliability-1',
					publish_generation_id: null,
				})
			: HistoricRepeatOffendersDaySchema.parse({
					generated_utc: ISO,
					date,
					offenders: [],
					by_grain: [],
					methodology_version: 'reliability-1',
					publish_generation_id: null,
				});
	const bytes = new TextEncoder().encode(` ${JSON.stringify(value)}\n`);
	const sha = await sha256Hex(bytes);
	return {
		value,
		bytes,
		ref: {
			path: `historic/history/${family}/generations/${sha}/${date}.json`,
			coverage_start: date,
			coverage_end: date,
			count: 1,
			sha256: sha,
			byte_size: bytes.byteLength,
		},
	};
}

async function pointCollectionIndex(
	family: PointFamily,
	artifacts: Array<PointArtifact<HistoricHotspotsDay | HistoricRepeatOffendersDay>>,
) {
	const dates = artifacts.map((artifact) => artifact.value.date);
	const base = {
		generated_utc: ISO,
		family,
		selection_mode: 'date' as const,
		entity_id: null,
		first_available_date: dates[0] ?? null,
		last_available_date: dates.at(-1) ?? null,
		available_dates: dates,
		gaps: internalDateGaps(dates),
		partitions: artifacts.map((artifact) => artifact.ref),
		metrics: [],
		methodology_version: 'history-1',
		publish_generation_id: 'published-run',
	};
	const generationBasis = {
		family: base.family,
		selection_mode: base.selection_mode,
		entity_id: base.entity_id,
		first_available_date: base.first_available_date,
		last_available_date: base.last_available_date,
		available_dates: base.available_dates,
		gaps: base.gaps,
		partitions: base.partitions,
		metrics: base.metrics,
	};
	const collectionGeneration = await sha256Hex(
		new TextEncoder().encode(canonicalJson(generationBasis)),
	);
	return HistoricCollectionIndexSchema.parse({
		...base,
		collection_generation_id: collectionGeneration,
	});
}

function pointRootEdge(
	index: ReturnType<typeof HistoricCollectionIndexSchema.parse>,
	indexPath = `historic/history/${index.family}/generations/${OLD_POINTER_SHA}/index.json`,
) {
	return HistoricAvailabilityIndexSchema.parse({
		generated_utc: ISO,
		methodology_version: 'history-1',
		publish_generation_id: 'published-run',
		families: [
			{
				family: index.family,
				selection_mode: 'date',
				index_path: indexPath,
				collection_generation_id: index.collection_generation_id,
				first_available_date: index.first_available_date,
				last_available_date: index.last_available_date,
				gaps: index.gaps,
				metrics: [],
			},
		],
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

afterEach(() => {
	clearAlertArchivePageMemoForTest();
	vi.restoreAllMocks();
});

describe('historic repository collection seams', () => {
	it('delegates optional indexes with the exact adapter context', async () => {
		const ctx: AdapterCtx = { signal: new AbortController().signal };
		const history = HistoricAvailabilityIndexSchema.parse({ generated_utc: ISO, families: [] });
		const alerts = archiveIndex([]);
		const historyPort = vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(history);
		const alertsPort = vi.spyOn(adapter.historic, 'alertArchiveIndex').mockResolvedValue(alerts);

		await expect(getHistoricAvailability(ctx)).resolves.toBe(history);
		await expect(getAlertArchiveIndex(ctx)).resolves.toBe(alerts);
		expect(historyPort).toHaveBeenCalledWith(ctx);
		expect(alertsPort).toHaveBeenCalledWith(ctx);
	});

	it('fetches only overlapping refs with the caller signal and merges deterministically', async () => {
		const january = ref('2026-01', 1, '2026-01-01', '2026-03-05');
		const february = ref('2026-02', 1, '2026-02-01', '2026-02-28');
		const march = ref('2026-03', 1, '2026-03-01', '2026-03-31');
		const index = archiveIndex([january, february, march]);
		const controller = new AbortController();
		const partitionSignals: AbortSignal[] = [];
		const pagePort = vi
			.spyOn(adapter.historic, 'alertArchivePage')
			.mockImplementation(async (advertisedPath, ctx) => {
				expect(ctx?.signal).toBeInstanceOf(AbortSignal);
				partitionSignals.push(ctx!.signal!);
				if (advertisedPath === january.path) {
					return archivePage('2026-01', 1, 'old-running', '2026-03-05T12:00:00Z');
				}
				return archivePage('2026-03', 1, 'new', '2026-03-31T12:00:00Z');
			});

		await expect(
			getAlertArchiveRange(
				index,
				{ from: '2026-03-05', to: '2026-03-10' },
				{
					signal: controller.signal,
				},
			),
		).resolves.toMatchObject([{ id: 'new' }, { id: 'old-running' }]);
		expect(pagePort.mock.calls.map(([advertisedPath]) => advertisedPath)).toEqual([
			january.path,
			march.path,
		]);
		expect(partitionSignals).toHaveLength(2);
		expect(partitionSignals[0]).toBe(partitionSignals[1]);
		expect(partitionSignals[0].aborted).toBe(false);
	});

	it('reuses successfully parsed immutable pages across overlapping range reads', async () => {
		const january = ref('2026-01', 1, '2026-01-01', '2026-03-05');
		const march = ref('2026-03', 1, '2026-03-01', '2026-03-31');
		const index = archiveIndex([january, march]);
		const pagePort = vi
			.spyOn(adapter.historic, 'alertArchivePage')
			.mockImplementation(async (advertisedPath) =>
				advertisedPath === january.path
					? archivePage('2026-01', 1, 'old-running', '2026-03-05T12:00:00Z')
					: archivePage('2026-03', 1, 'new', '2026-03-31T12:00:00Z'),
			);

		await getAlertArchiveRange(index, { from: '2026-03-01', to: '2026-03-10' });
		await getAlertArchiveRange(index, { from: '2026-03-05', to: '2026-03-10' });

		expect(pagePort).toHaveBeenCalledTimes(2);
		expect(pagePort.mock.calls.map(([advertisedPath]) => advertisedPath)).toEqual([
			january.path,
			march.path,
		]);
	});

	it('returns only entries that exactly intersect the requested range after loading a broad page', async () => {
		const advertised = ref('2026-03', 1, '2026-01-01', '2026-03-31');
		vi.spyOn(adapter.historic, 'alertArchivePage').mockResolvedValue(
			AlertArchivePageSchema.parse({
				generated_utc: ISO,
				month: '2026-03',
				page: 1,
				alerts: [
					{
						id: 'scalar-in',
						first_seen_utc: '2026-01-01T00:00:00Z',
						last_seen_utc: '2026-03-31T00:00:00Z',
						start_utc: '2026-03-10T00:00:00Z',
						end_utc: '2026-03-11T00:00:00Z',
					},
					{
						id: 'scalar-out',
						first_seen_utc: '2026-01-01T00:00:00Z',
						last_seen_utc: '2026-03-31T00:00:00Z',
						start_utc: '2026-02-01T00:00:00Z',
						end_utc: '2026-02-02T00:00:00Z',
					},
					{
						id: 'first-last-in',
						first_seen_utc: '2026-03-12T00:00:00Z',
						last_seen_utc: '2026-03-14T00:00:00Z',
					},
					{
						id: 'first-last-out',
						first_seen_utc: '2026-01-12T00:00:00Z',
						last_seen_utc: '2026-01-14T00:00:00Z',
					},
				],
			}),
		);

		const entries = await getAlertArchiveRange(archiveIndex([advertised]), {
			from: '2026-03-05',
			to: '2026-03-15',
		});

		expect(entries.map((entry) => entry.id).sort()).toEqual(['first-last-in', 'scalar-in']);
	});

	it('preflights every selected path before starting any fetch', async () => {
		const safe = ref('2026-03', 1, '2026-03-01', '2026-03-31');
		const unsafe = { ...ref('2026-03', 2, '2026-03-01', '2026-03-31'), path: '//evil.test/x' };
		const pagePort = vi.spyOn(adapter.historic, 'alertArchivePage');

		await expect(
			getAlertArchiveRange(archiveIndex([safe, unsafe]), {
				from: '2026-03-01',
				to: '2026-03-31',
			}),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(pagePort).not.toHaveBeenCalled();
	});

	it('treats a 404 for an advertised alert page as typed corruption', async () => {
		const advertised = ref('2026-03', 1, '2026-03-01', '2026-03-31');
		vi.spyOn(adapter.historic, 'alertArchivePage').mockResolvedValue(null);

		await expect(
			getAlertArchiveRange(archiveIndex([advertised]), {
				from: '2026-03-01',
				to: '2026-03-31',
			}),
		).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: advertised.path,
		});
	});
});

describe('strict advertised receipts', () => {
	const index = ReceiptsIndexSchema.parse({
		generated_utc: ISO,
		dates: ['2026-03-29', '2026-03-30'],
	});

	it('rejects malformed and unpublished dates before calling the adapter', async () => {
		const receiptPort = vi.spyOn(adapter.historic, 'receipt');

		await expect(getAdvertisedReceipt(index, '2026-02-30')).rejects.toBeInstanceOf(RangeError);
		await expect(getAdvertisedReceipt(index, '2026-03-28')).rejects.toBeInstanceOf(RangeError);
		expect(receiptPort).not.toHaveBeenCalled();
	});

	it('turns an advertised receipt 404 into typed corruption', async () => {
		vi.spyOn(adapter.historic, 'receipt').mockResolvedValue(null);

		await expect(getAdvertisedReceipt(index, '2026-03-29')).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: '2026-03-29',
		});
	});

	it('rejects a mismatched advertised receipt date without changing the legacy seam', async () => {
		const wrongDate = ReceiptSchema.parse({ generated_utc: ISO, date: '2026-03-30' });
		vi.spyOn(adapter.historic, 'receipt').mockResolvedValue(wrongDate);

		await expect(getAdvertisedReceipt(index, '2026-03-29')).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: '2026-03-29',
			message: expect.stringContaining('received 2026-03-30'),
		});
		await expect(getReceipt('2026-03-29')).resolves.toBe(wrongDate);
	});

	it('returns an advertised receipt and preserves legacy direct-receipt null behavior', async () => {
		const ctx: AdapterCtx = { signal: new AbortController().signal };
		const receipt = ReceiptSchema.parse({ generated_utc: ISO, date: '2026-03-29' });
		const receiptPort = vi
			.spyOn(adapter.historic, 'receipt')
			.mockResolvedValueOnce(receipt)
			.mockResolvedValueOnce(null);

		await expect(getAdvertisedReceipt(index, '2026-03-29', ctx)).resolves.toBe(receipt);
		await expect(getReceipt('2026-03-29', ctx)).resolves.toBeNull();
		expect(receiptPort).toHaveBeenNthCalledWith(1, '2026-03-29', ctx);
		expect(receiptPort).toHaveBeenNthCalledWith(2, '2026-03-29', ctx);
	});
});

describe('retained family discovery and generation pins', () => {
	it('returns null only when the optional root or requested family is absent', async () => {
		const rootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(availabilityRoot([]));
		const childPort = vi.spyOn(adapter.historic, 'networkHistoryIndex');

		await expect(getNetworkHistoryIndex()).resolves.toBeNull();
		await expect(getNetworkHistoryIndex()).resolves.toBeNull();
		expect(rootPort).toHaveBeenCalledTimes(2);
		expect(childPort).not.toHaveBeenCalled();
	});

	it('rejects an unsafe root edge before reading its advertised child', async () => {
		const unsafeRoot = {
			...availabilityRoot([]),
			families: [
				{
					...rootFamily('network', GENERATION, 'https://evil.test/index.json'),
					selection_mode: 'range' as const,
				},
			],
		};
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(unsafeRoot);
		const childPort = vi.spyOn(adapter.historic, 'networkHistoryIndex');

		await expect(getNetworkHistoryIndex()).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(childPort).not.toHaveBeenCalled();
	});

	it('reads the exact versioned network child advertised by a cached root', async () => {
		const oldPath = versionedFamilyPath('network');
		const newerPath = versionedFamilyPath('network', NEW_POINTER_SHA);
		const rootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(availabilityRoot([rootFamily('network', GENERATION, oldPath)]))
			.mockResolvedValue(availabilityRoot([rootFamily('network', NEXT_GENERATION, newerPath)]));
		const oldIndex = collectionIndex('network', GENERATION);
		const childPort = vi
			.spyOn(adapter.historic, 'networkHistoryIndex')
			.mockImplementation(async (path) =>
				path === oldPath ? oldIndex : collectionIndex('network', NEXT_GENERATION),
			);

		await expect(getNetworkHistoryIndex()).resolves.toBe(oldIndex);
		expect(rootPort).toHaveBeenCalledTimes(1);
		expect(childPort).toHaveBeenCalledOnce();
		expect(childPort).toHaveBeenCalledWith(oldPath, undefined);
	});

	it('does not fall back when an advertised immutable network child is missing', async () => {
		const oldPath = versionedFamilyPath('network');
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(
			availabilityRoot([rootFamily('network', GENERATION, oldPath)]),
		);
		const childPort = vi.spyOn(adapter.historic, 'networkHistoryIndex').mockResolvedValue(null);

		await expect(getNetworkHistoryIndex()).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: oldPath,
		});
		expect(childPort).toHaveBeenCalledOnce();
		expect(childPort).toHaveBeenCalledWith(oldPath, undefined);
	});

	it('switches exact versioned network paths only inside one bounded mismatch recovery', async () => {
		const oldPath = versionedFamilyPath('network');
		const newPath = versionedFamilyPath('network', NEW_POINTER_SHA);
		const rootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(availabilityRoot([rootFamily('network', NEXT_GENERATION, oldPath)]))
			.mockResolvedValueOnce(availabilityRoot([rootFamily('network', NEXT_GENERATION, newPath)]));
		const staleIndex = collectionIndex('network', GENERATION);
		const freshIndex = collectionIndex('network', NEXT_GENERATION);
		const childPort = vi
			.spyOn(adapter.historic, 'networkHistoryIndex')
			.mockResolvedValueOnce(staleIndex)
			.mockResolvedValueOnce(freshIndex);

		await expect(getNetworkHistoryIndex()).resolves.toBe(freshIndex);
		expect(rootPort).toHaveBeenCalledTimes(2);
		expect(childPort).toHaveBeenCalledTimes(2);
		expect(childPort).toHaveBeenNthCalledWith(1, oldPath, undefined);
		expect(childPort).toHaveBeenNthCalledWith(
			2,
			newPath,
			expect.objectContaining({ freshHistoryParent: true }),
		);
	});

	it('treats an advertised network child 404 as strict contract failure', async () => {
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(
			availabilityRoot([rootFamily('network')]),
		);
		vi.spyOn(adapter.historic, 'networkHistoryIndex').mockResolvedValue(null);

		await expect(getNetworkHistoryIndex()).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: 'historic/history/network/index.json',
		});
	});

	it('refreshes only the immediate root once when the network generation races', async () => {
		const firstRoot = availabilityRoot([rootFamily('network', GENERATION)]);
		const freshRoot = availabilityRoot([rootFamily('network', NEXT_GENERATION)]);
		const rootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(firstRoot)
			.mockResolvedValueOnce(freshRoot);
		const child = collectionIndex('network', NEXT_GENERATION);
		const childPort = vi.spyOn(adapter.historic, 'networkHistoryIndex').mockResolvedValue(child);

		await expect(getNetworkHistoryIndex()).resolves.toBe(child);
		expect(childPort).toHaveBeenCalledTimes(1);
		expect(rootPort).toHaveBeenNthCalledWith(1, undefined);
		expect(rootPort).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ freshHistoryParent: true }),
		);
	});

	it('reloads a stale fixed network child once when its parent is already newer', async () => {
		const root = availabilityRoot([rootFamily('network', NEXT_GENERATION)]);
		const rootPort = vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		const staleChild = collectionIndex('network', GENERATION);
		const freshChild = collectionIndex('network', NEXT_GENERATION);
		const childPort = vi
			.spyOn(adapter.historic, 'networkHistoryIndex')
			.mockResolvedValueOnce(staleChild)
			.mockResolvedValueOnce(freshChild);

		await expect(getNetworkHistoryIndex()).resolves.toBe(freshChild);
		expect(rootPort).toHaveBeenCalledTimes(2);
		expect(childPort).toHaveBeenCalledTimes(2);
		expect(childPort).toHaveBeenNthCalledWith(
			2,
			'historic/history/network/index.json',
			expect.objectContaining({ freshHistoryParent: true }),
		);
	});

	it('keeps an advertised child 404 strict during the bounded network reload', async () => {
		const root = availabilityRoot([rootFamily('network', NEXT_GENERATION)]);
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		const childPort = vi
			.spyOn(adapter.historic, 'networkHistoryIndex')
			.mockResolvedValueOnce(collectionIndex('network', GENERATION))
			.mockResolvedValueOnce(null);

		await expect(getNetworkHistoryIndex()).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: 'historic/history/network/index.json',
		});
		expect(childPort).toHaveBeenCalledTimes(2);
	});

	it('preserves abort identity during the bounded stale-child reload', async () => {
		const root = availabilityRoot([rootFamily('network', NEXT_GENERATION)]);
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		const abort = new DOMException('cancelled', 'AbortError');
		const childPort = vi
			.spyOn(adapter.historic, 'networkHistoryIndex')
			.mockResolvedValueOnce(collectionIndex('network', GENERATION))
			.mockRejectedValueOnce(abort);

		await expect(getNetworkHistoryIndex()).rejects.toBe(abort);
		expect(childPort).toHaveBeenCalledTimes(2);
	});

	it('fails closed with a typed transient error after exactly one persistent root mismatch', async () => {
		const root = availabilityRoot([rootFamily('network', GENERATION)]);
		const rootPort = vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		vi.spyOn(adapter.historic, 'networkHistoryIndex').mockResolvedValue(
			collectionIndex('network', NEXT_GENERATION),
		);

		await expect(getNetworkHistoryIndex()).rejects.toBeInstanceOf(HistoryTransientPublicationError);
		expect(rootPort).toHaveBeenCalledTimes(2);
	});

	it('refreshes only the immediate directory once for an entity-index generation race', async () => {
		const root = availabilityRoot([rootFamily('lines')]);
		const firstDirectory = entityDirectory('lines', GENERATION, 'A/B', GENERATION);
		const freshDirectory = entityDirectory('lines', GENERATION, 'A/B', NEXT_GENERATION);
		const rootPort = vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		const directoryPort = vi
			.spyOn(adapter.historic, 'lineHistoryDirectory')
			.mockResolvedValueOnce(firstDirectory)
			.mockResolvedValueOnce(freshDirectory);
		const child = collectionIndex('lines', NEXT_GENERATION, 'A/B');
		const childPort = vi.spyOn(adapter.historic, 'lineHistoryIndex').mockResolvedValue(child);

		await expect(getLineHistoryIndex('A/B')).resolves.toBe(child);
		expect(rootPort).toHaveBeenCalledTimes(1);
		expect(childPort).toHaveBeenCalledTimes(1);
		expect(directoryPort).toHaveBeenNthCalledWith(
			1,
			'historic/history/lines/index.json',
			undefined,
		);
		expect(directoryPort).toHaveBeenNthCalledWith(
			2,
			'historic/history/lines/index.json',
			expect.objectContaining({ freshHistoryParent: true }),
		);
	});

	it('reloads a stale fixed entity index once when its directory is already newer', async () => {
		const root = availabilityRoot([rootFamily('lines', NEXT_GENERATION)]);
		const directory = entityDirectory('lines', NEXT_GENERATION, 'A/B', NEXT_GENERATION);
		const rootPort = vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		const directoryPort = vi
			.spyOn(adapter.historic, 'lineHistoryDirectory')
			.mockResolvedValue(directory);
		const staleChild = collectionIndex('lines', GENERATION, 'A/B');
		const freshChild = collectionIndex('lines', NEXT_GENERATION, 'A/B');
		const childPort = vi
			.spyOn(adapter.historic, 'lineHistoryIndex')
			.mockResolvedValueOnce(staleChild)
			.mockResolvedValueOnce(freshChild);

		await expect(getLineHistoryIndex('A/B')).resolves.toBe(freshChild);
		expect(rootPort).toHaveBeenCalledTimes(1);
		expect(directoryPort).toHaveBeenCalledTimes(2);
		expect(childPort).toHaveBeenCalledTimes(2);
		expect(directoryPort).toHaveBeenNthCalledWith(
			2,
			'historic/history/lines/index.json',
			expect.objectContaining({ freshHistoryParent: true }),
		);
		expect(childPort).toHaveBeenNthCalledWith(
			2,
			'A/B',
			'historic/history/lines/412f42/index.json',
			expect.objectContaining({ freshHistoryParent: true }),
		);
	});

	it('fails closed after one bounded entity child reload when the mismatch persists', async () => {
		const root = availabilityRoot([rootFamily('lines', NEXT_GENERATION)]);
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		const directoryPort = vi
			.spyOn(adapter.historic, 'lineHistoryDirectory')
			.mockResolvedValue(entityDirectory('lines', NEXT_GENERATION, 'A/B', NEXT_GENERATION));
		const childPort = vi
			.spyOn(adapter.historic, 'lineHistoryIndex')
			.mockResolvedValue(collectionIndex('lines', GENERATION, 'A/B'));

		await expect(getLineHistoryIndex('A/B')).rejects.toBeInstanceOf(
			HistoryTransientPublicationError,
		);
		expect(directoryPort).toHaveBeenCalledTimes(2);
		expect(childPort).toHaveBeenCalledTimes(2);
	});

	it('keeps the advertised directory 404 strict during entity-chain recovery', async () => {
		const root = availabilityRoot([rootFamily('lines', NEXT_GENERATION)]);
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		vi.spyOn(adapter.historic, 'lineHistoryDirectory')
			.mockResolvedValueOnce(entityDirectory('lines', NEXT_GENERATION, 'A/B', NEXT_GENERATION))
			.mockResolvedValueOnce(null);
		vi.spyOn(adapter.historic, 'lineHistoryIndex').mockResolvedValueOnce(
			collectionIndex('lines', GENERATION, 'A/B'),
		);

		await expect(getLineHistoryIndex('A/B')).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: 'historic/history/lines/index.json',
		});
	});

	it('reloads a stale fixed directory once when its root is already newer', async () => {
		const root = availabilityRoot([rootFamily('stops', NEXT_GENERATION)]);
		const rootPort = vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		const staleDirectory = entityDirectory('stops', GENERATION, '..', GENERATION);
		const freshDirectory = entityDirectory('stops', NEXT_GENERATION, '..', NEXT_GENERATION);
		const directoryPort = vi
			.spyOn(adapter.historic, 'stopHistoryDirectory')
			.mockResolvedValueOnce(staleDirectory)
			.mockResolvedValueOnce(freshDirectory);

		await expect(getStopHistoryDirectory()).resolves.toBe(freshDirectory);
		expect(rootPort).toHaveBeenCalledTimes(2);
		expect(directoryPort).toHaveBeenCalledTimes(2);
		expect(directoryPort).toHaveBeenNthCalledWith(
			2,
			'historic/history/stops/index.json',
			expect.objectContaining({ freshHistoryParent: true }),
		);
	});

	it('fails transiently when an entity retry sees a directory generation newer than the root', async () => {
		const root = availabilityRoot([rootFamily('lines', GENERATION)]);
		const firstDirectory = entityDirectory('lines', GENERATION, 'A/B', GENERATION);
		const freshDirectory = entityDirectory('lines', NEXT_GENERATION, 'A/B', NEXT_GENERATION);
		const rootPort = vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		const directoryPort = vi
			.spyOn(adapter.historic, 'lineHistoryDirectory')
			.mockResolvedValueOnce(firstDirectory)
			.mockResolvedValueOnce(freshDirectory);
		vi.spyOn(adapter.historic, 'lineHistoryIndex').mockResolvedValue(
			collectionIndex('lines', NEXT_GENERATION, 'A/B'),
		);

		await expect(getLineHistoryIndex('A/B')).rejects.toBeInstanceOf(
			HistoryTransientPublicationError,
		);
		expect(rootPort).toHaveBeenCalledTimes(2);
		expect(rootPort).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ freshHistoryParent: true }),
		);
		expect(directoryPort).toHaveBeenCalledTimes(2);
	});

	it('validates the root-to-directory path and refreshes that root pin exactly once', async () => {
		const badRoot = {
			...availabilityRoot([]),
			families: [
				{
					...rootFamily('lines', GENERATION, 'historic/history/stops/index.json'),
					selection_mode: 'range' as const,
				},
			],
		};
		const directoryPort = vi.spyOn(adapter.historic, 'lineHistoryDirectory');
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValueOnce(badRoot);
		await expect(getLineHistoryDirectory()).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(directoryPort).not.toHaveBeenCalled();
		vi.mocked(adapter.historic.historyIndex).mockClear();

		const rootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(availabilityRoot([rootFamily('lines', GENERATION)]))
			.mockResolvedValueOnce(availabilityRoot([rootFamily('lines', NEXT_GENERATION)]));
		const directory = entityDirectory('lines', NEXT_GENERATION);
		directoryPort.mockResolvedValue(directory);

		await expect(getLineHistoryDirectory()).resolves.toBe(directory);
		expect(rootPort).toHaveBeenCalledTimes(2);
		expect(directoryPort).toHaveBeenCalledTimes(1);
	});

	it('returns null for an unadvertised entity but makes an advertised entity 404 strict', async () => {
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(
			availabilityRoot([rootFamily('lines')]),
		);
		vi.spyOn(adapter.historic, 'lineHistoryDirectory')
			.mockResolvedValueOnce(entityDirectory('lines', GENERATION, 'other'))
			.mockResolvedValueOnce(entityDirectory('lines', GENERATION, 'A/B'));
		const childPort = vi.spyOn(adapter.historic, 'lineHistoryIndex').mockResolvedValue(null);

		await expect(getLineHistoryIndex('A/B')).resolves.toBeNull();
		await expect(getLineHistoryIndex('A/B')).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: 'historic/history/lines/412f42/index.json',
		});
		expect(childPort).toHaveBeenCalledTimes(1);
	});

	it('discovers matching line and stop directories through their exact root pins', async () => {
		vi.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(availabilityRoot([rootFamily('lines')]))
			.mockResolvedValueOnce(availabilityRoot([rootFamily('stops')]));
		const line = entityDirectory('lines');
		const stop = entityDirectory('stops', GENERATION, '..');
		vi.spyOn(adapter.historic, 'lineHistoryDirectory').mockResolvedValue(line);
		vi.spyOn(adapter.historic, 'stopHistoryDirectory').mockResolvedValue(stop);

		await expect(getLineHistoryDirectory()).resolves.toBe(line);
		await expect(getStopHistoryDirectory()).resolves.toBe(stop);
	});

	it('loads a matching Stop entity index without touching any other entity', async () => {
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(
			availabilityRoot([rootFamily('stops')]),
		);
		vi.spyOn(adapter.historic, 'stopHistoryDirectory').mockResolvedValue(
			entityDirectory('stops', GENERATION, '..'),
		);
		const child = collectionIndex('stops', GENERATION, '..');
		const childPort = vi.spyOn(adapter.historic, 'stopHistoryIndex').mockResolvedValue(child);

		await expect(getStopHistoryIndex('..')).resolves.toBe(child);
		expect(childPort).toHaveBeenCalledWith(
			'..',
			'historic/history/stops/2e2e/index.json',
			undefined,
		);
	});

	it('follows versioned directory and awkward entity pointers without fixed-path fallback', async () => {
		const directoryPath = versionedFamilyPath('lines');
		const entityPath = versionedEntityPath('lines', '412f42');
		const rootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(availabilityRoot([rootFamily('lines', GENERATION, directoryPath)]))
			.mockResolvedValue(
				availabilityRoot([
					rootFamily('lines', NEXT_GENERATION, versionedFamilyPath('lines', NEW_POINTER_SHA)),
				]),
			);
		const directory = entityDirectory('lines', GENERATION, 'A/B', GENERATION, entityPath);
		const directoryPort = vi
			.spyOn(adapter.historic, 'lineHistoryDirectory')
			.mockResolvedValue(directory);
		const index = collectionIndex('lines', GENERATION, 'A/B');
		const childPort = vi.spyOn(adapter.historic, 'lineHistoryIndex').mockResolvedValue(index);

		await expect(getLineHistoryIndex('A/B')).resolves.toBe(index);
		expect(rootPort).toHaveBeenCalledOnce();
		expect(directoryPort).toHaveBeenCalledWith(directoryPath, undefined);
		expect(childPort).toHaveBeenCalledWith('A/B', entityPath, undefined);
	});

	it('keeps missing versioned directory and entity children strict without legacy fallback', async () => {
		const directoryPath = versionedFamilyPath('lines');
		const entityPath = versionedEntityPath('lines', '412f42');
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(
			availabilityRoot([rootFamily('lines', GENERATION, directoryPath)]),
		);
		const directoryPort = vi.spyOn(adapter.historic, 'lineHistoryDirectory');
		directoryPort.mockResolvedValueOnce(null);

		await expect(getLineHistoryDirectory()).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: directoryPath,
		});
		expect(directoryPort).toHaveBeenCalledOnce();
		expect(directoryPort).toHaveBeenCalledWith(directoryPath, undefined);

		directoryPort.mockResolvedValueOnce(
			entityDirectory('lines', GENERATION, 'A/B', GENERATION, entityPath),
		);
		const childPort = vi.spyOn(adapter.historic, 'lineHistoryIndex').mockResolvedValueOnce(null);

		await expect(getLineHistoryIndex('A/B')).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: entityPath,
		});
		expect(childPort).toHaveBeenCalledOnce();
		expect(childPort).toHaveBeenCalledWith('A/B', entityPath, undefined);
	});
});

describe('root-pinned point-family history', () => {
	it('returns current-only null when the optional root or point family is absent', async () => {
		const rootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(HistoricAvailabilityIndexSchema.parse({ generated_utc: ISO }));
		const hotspotsIndexPort = vi.spyOn(adapter.historic, 'hotspotsHistoryIndex');
		const repeatIndexPort = vi.spyOn(adapter.historic, 'repeatOffendersHistoryIndex');

		await expect(getHotspotsHistoryIndex()).resolves.toBeNull();
		await expect(getRepeatOffendersHistoryIndex()).resolves.toBeNull();
		expect(rootPort).toHaveBeenCalledTimes(2);
		expect(hotspotsIndexPort).not.toHaveBeenCalled();
		expect(repeatIndexPort).not.toHaveBeenCalled();
	});

	it('loads each exact immutable child and validates its complete root edge', async () => {
		const hotspots = [
			await pointArtifact('hotspots', '2026-03-29'),
			await pointArtifact('hotspots', '2026-03-31'),
		];
		const repeats = [
			await pointArtifact('repeat_offenders', '2026-03-29'),
			await pointArtifact('repeat_offenders', '2026-03-31'),
		];
		const hotspotsIndex = await pointCollectionIndex('hotspots', hotspots);
		const repeatIndex = await pointCollectionIndex('repeat_offenders', repeats);
		const hotspotsPath = `historic/history/hotspots/generations/${OLD_POINTER_SHA}/index.json`;
		const repeatPath = `historic/history/repeat_offenders/generations/${NEW_POINTER_SHA}/index.json`;
		vi.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(pointRootEdge(hotspotsIndex, hotspotsPath))
			.mockResolvedValueOnce(pointRootEdge(repeatIndex, repeatPath));
		const hotspotsPort = vi
			.spyOn(adapter.historic, 'hotspotsHistoryIndex')
			.mockResolvedValue(hotspotsIndex);
		const repeatPort = vi
			.spyOn(adapter.historic, 'repeatOffendersHistoryIndex')
			.mockResolvedValue(repeatIndex);

		await expect(getHotspotsHistoryIndex()).resolves.toBe(hotspotsIndex);
		await expect(getRepeatOffendersHistoryIndex()).resolves.toBe(repeatIndex);
		expect(hotspotsPort).toHaveBeenCalledWith(hotspotsPath, undefined);
		expect(repeatPort).toHaveBeenCalledWith(repeatPath, undefined);
	});

	it('treats an advertised missing index as corruption without current fallback', async () => {
		const artifact = await pointArtifact('hotspots', '2026-03-29');
		const index = await pointCollectionIndex('hotspots', [artifact]);
		const root = pointRootEdge(index);
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue(root);
		const indexPort = vi.spyOn(adapter.historic, 'hotspotsHistoryIndex').mockResolvedValue(null);

		await expect(getHotspotsHistoryIndex()).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: root.families?.[0]?.index_path,
		});
		expect(indexPort).toHaveBeenCalledOnce();
	});

	it('rejects malformed or duplicate point root edges before reading a child', async () => {
		const artifact = await pointArtifact('hotspots', '2026-03-29');
		const index = await pointCollectionIndex('hotspots', [artifact]);
		const valid = pointRootEdge(index);
		const edge = valid.families![0];
		const invalidRoots = [
			{ ...valid, families: [edge, edge] },
			{ ...valid, families: [{ ...edge, selection_mode: 'range' }] },
			{ ...valid, families: [{ ...edge, index_path: 'historic/history/hotspots/index.json' }] },
			{
				...valid,
				families: [{ ...edge, index_path: edge.index_path.replace('/hotspots/', '/network/') }],
			},
			{ ...valid, families: [{ ...edge, collection_generation_id: GENERATION.toUpperCase() }] },
			{
				...valid,
				families: [{ ...edge, metrics: [{ metric: 'delay', aggregation: 'daily_only' }] }],
			},
		];
		const rootPort = vi.spyOn(adapter.historic, 'historyIndex');
		const childPort = vi.spyOn(adapter.historic, 'hotspotsHistoryIndex');

		for (const root of invalidRoots) {
			rootPort.mockResolvedValueOnce(root as typeof valid);
			await expect(getHotspotsHistoryIndex()).rejects.toBeInstanceOf(HistoryArtifactContractError);
		}
		expect(childPort).not.toHaveBeenCalled();
	});

	it('refreshes the root and exact child at most once on a generation race', async () => {
		const oldArtifact = await pointArtifact('hotspots', '2026-03-28');
		const newArtifacts = [
			await pointArtifact('hotspots', '2026-03-29'),
			await pointArtifact('hotspots', '2026-03-31'),
		];
		const oldIndex = await pointCollectionIndex('hotspots', [oldArtifact]);
		const newIndex = await pointCollectionIndex('hotspots', newArtifacts);
		const oldPath = `historic/history/hotspots/generations/${OLD_POINTER_SHA}/index.json`;
		const newPath = `historic/history/hotspots/generations/${NEW_POINTER_SHA}/index.json`;
		const controller = new AbortController();
		const ctx: AdapterCtx = { signal: controller.signal };
		const rootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(pointRootEdge(newIndex, oldPath))
			.mockResolvedValueOnce(pointRootEdge(newIndex, newPath));
		const indexPort = vi
			.spyOn(adapter.historic, 'hotspotsHistoryIndex')
			.mockResolvedValueOnce(oldIndex)
			.mockResolvedValueOnce(newIndex);

		await expect(getHotspotsHistoryIndex(ctx)).resolves.toBe(newIndex);
		expect(rootPort).toHaveBeenCalledTimes(2);
		expect(indexPort).toHaveBeenCalledTimes(2);
		expect(rootPort).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ signal: controller.signal, freshHistoryParent: true }),
		);
		expect(indexPort).toHaveBeenNthCalledWith(
			2,
			newPath,
			expect.objectContaining({ signal: controller.signal, freshHistoryParent: true }),
		);
	});

	it('preserves abort identity and fails transiently after one persistent mismatch', async () => {
		const artifact = await pointArtifact('repeat_offenders', '2026-03-29');
		const index = await pointCollectionIndex('repeat_offenders', [artifact]);
		const mismatchedRoot = pointRootEdge({
			...index,
			collection_generation_id: NEXT_GENERATION,
		});
		const abort = new DOMException('cancelled', 'AbortError');
		const rootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValueOnce(mismatchedRoot)
			.mockRejectedValueOnce(abort);
		vi.spyOn(adapter.historic, 'repeatOffendersHistoryIndex').mockResolvedValue(index);

		await expect(getRepeatOffendersHistoryIndex()).rejects.toBe(abort);
		expect(rootPort).toHaveBeenCalledTimes(2);

		vi.restoreAllMocks();
		const persistentRoot = pointRootEdge({
			...index,
			collection_generation_id: NEXT_GENERATION,
		});
		const persistentRootPort = vi
			.spyOn(adapter.historic, 'historyIndex')
			.mockResolvedValue(persistentRoot);
		vi.spyOn(adapter.historic, 'repeatOffendersHistoryIndex').mockResolvedValue(index);

		await expect(getRepeatOffendersHistoryIndex()).rejects.toBeInstanceOf(
			HistoryTransientPublicationError,
		);
		expect(persistentRootPort).toHaveBeenCalledTimes(2);
	});

	it('fails transiently when refreshed root first or last coverage still disagrees', async () => {
		const artifacts = [
			await pointArtifact('hotspots', '2026-03-29'),
			await pointArtifact('hotspots', '2026-03-31'),
		];
		const index = await pointCollectionIndex('hotspots', artifacts);
		const validRoot = pointRootEdge(index);
		const edge = validRoot.families![0];
		const mismatches = [
			{ ...edge, first_available_date: '2026-03-28' },
			{ ...edge, last_available_date: '2026-04-01' },
		];

		for (const mismatch of mismatches) {
			vi.restoreAllMocks();
			const rootPort = vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue({
				...validRoot,
				families: [mismatch],
			});
			const indexPort = vi.spyOn(adapter.historic, 'hotspotsHistoryIndex').mockResolvedValue(index);

			await expect(getHotspotsHistoryIndex()).rejects.toBeInstanceOf(
				HistoryTransientPublicationError,
			);
			expect(rootPort).toHaveBeenCalledTimes(2);
			expect(indexPort).toHaveBeenCalledTimes(2);
		}
	});

	it('rejects malformed point indexes and root coverage before selecting any date ref', async () => {
		const first = await pointArtifact('hotspots', '2026-03-29');
		const second = await pointArtifact('hotspots', '2026-03-31');
		const valid = await pointCollectionIndex('hotspots', [first, second]);
		const artifactPort = vi.spyOn(adapter.historic, 'hotspotsHistoryDay');
		const invalidIndexes: HistoricCollectionIndex[] = [
			{ ...valid, family: 'repeat_offenders' },
			{ ...valid, selection_mode: 'range' },
			{ ...valid, entity_id: 'not-null' },
			{ ...valid, collection_generation_id: 'not-a-sha' },
			{ ...valid, collection_generation_id: 'f'.repeat(64) },
			{ ...valid, available_dates: ['2026-03-31', '2026-03-29'] },
			{ ...valid, available_dates: ['2026-03-29', '2026-03-29'] },
			{ ...valid, available_dates: ['2026-02-30', '2026-03-31'] },
			{ ...valid, first_available_date: '2026-03-28' },
			{ ...valid, last_available_date: '2026-04-01' },
			{ ...valid, gaps: [] },
			{
				...valid,
				gaps: [{ start_date: '2026-03-30', end_date: '2026-03-30', reason: 'outage' }],
			},
			{ ...valid, metrics: [{ metric: 'delay', aggregation: 'daily_only' }] },
			{ ...valid, partitions: [first.ref, first.ref] },
			{ ...valid, partitions: [second.ref, first.ref] },
			{
				...valid,
				partitions: [{ ...first.ref, coverage_start: '2026-03-28' }, second.ref],
			},
			{
				...valid,
				partitions: [{ ...first.ref, coverage_end: '2026-03-30' }, second.ref],
			},
			{
				...valid,
				partitions: [{ ...first.ref, count: 2 }, second.ref],
			},
			{
				...valid,
				partitions: [
					first.ref,
					{
						...second.ref,
						path: second.ref.path.replace('/hotspots/', '/repeat_offenders/'),
					},
				],
			},
			{
				...valid,
				partitions: [first.ref, { ...second.ref, byte_size: 0 }],
			},
			{
				...valid,
				partitions: [first.ref, { ...second.ref, sha256: first.ref.sha256 }],
			},
		];

		for (const index of invalidIndexes) {
			await expect(getHotspotsHistoryDay('2026-03-29', index)).rejects.toBeInstanceOf(
				HistoryArtifactContractError,
			);
		}
		expect(artifactPort).not.toHaveBeenCalled();

		const root = pointRootEdge(valid);
		vi.spyOn(adapter.historic, 'historyIndex').mockResolvedValue({
			...root,
			families: root.families?.map((edge) => ({ ...edge, gaps: [] })),
		});
		vi.spyOn(adapter.historic, 'hotspotsHistoryIndex').mockResolvedValue(valid);
		await expect(getHotspotsHistoryIndex()).rejects.toBeInstanceOf(
			HistoryTransientPublicationError,
		);
	});

	it('never calls the day port for latest, malformed, or unpublished dates', async () => {
		const artifacts = [
			await pointArtifact('hotspots', '2026-03-29'),
			await pointArtifact('hotspots', '2026-03-31'),
		];
		const index = await pointCollectionIndex('hotspots', artifacts);
		const dayPort = vi.spyOn(adapter.historic, 'hotspotsHistoryDay');

		await expect(getHotspotsHistoryDay('2026-03-31', index)).rejects.toBeInstanceOf(RangeError);
		await expect(getHotspotsHistoryDay('2026-02-30', index)).rejects.toBeInstanceOf(RangeError);
		await expect(getHotspotsHistoryDay('2026-03-30', index)).rejects.toBeInstanceOf(RangeError);
		expect(dayPort).not.toHaveBeenCalled();
	});

	it('loads valid older published-empty artifacts from exact raw bytes', async () => {
		const hotspots = [
			await pointArtifact('hotspots', '2026-03-29'),
			await pointArtifact('hotspots', '2026-03-31'),
		];
		const repeats = [
			await pointArtifact('repeat_offenders', '2026-03-29'),
			await pointArtifact('repeat_offenders', '2026-03-31'),
		];
		const hotspotsIndex = await pointCollectionIndex('hotspots', hotspots);
		const repeatIndex = await pointCollectionIndex('repeat_offenders', repeats);
		const ctx: AdapterCtx = { signal: new AbortController().signal };
		const hotspotsPort = vi
			.spyOn(adapter.historic, 'hotspotsHistoryDay')
			.mockResolvedValue(hotspots[0]);
		const repeatPort = vi
			.spyOn(adapter.historic, 'repeatOffendersHistoryDay')
			.mockResolvedValue(repeats[0]);

		await expect(getHotspotsHistoryDay('2026-03-29', hotspotsIndex, ctx)).resolves.toBe(
			hotspots[0].value,
		);
		await expect(getRepeatOffendersHistoryDay('2026-03-29', repeatIndex, ctx)).resolves.toBe(
			repeats[0].value,
		);
		expect(hotspots[0].value.hotspots).toEqual([]);
		expect(repeats[0].value.offenders).toEqual([]);
		expect(hotspotsPort).toHaveBeenCalledWith('2026-03-29', hotspots[0].ref.path, ctx);
		expect(repeatPort).toHaveBeenCalledWith('2026-03-29', repeats[0].ref.path, ctx);
	});

	it('fails closed for an advertised day 404, exact-byte drift, and payload date drift', async () => {
		const artifacts = [
			await pointArtifact('hotspots', '2026-03-29'),
			await pointArtifact('hotspots', '2026-03-31'),
		];
		const index = await pointCollectionIndex('hotspots', artifacts);
		const port = vi.spyOn(adapter.historic, 'hotspotsHistoryDay');

		port.mockResolvedValueOnce(null);
		await expect(getHotspotsHistoryDay('2026-03-29', index)).rejects.toMatchObject({
			name: 'HistoryArtifactContractError',
			path: artifacts[0].ref.path,
		});

		await expect(
			getHotspotsHistoryDay('2026-03-29', {
				...index,
				partitions: [
					{ ...artifacts[0].ref, byte_size: artifacts[0].ref.byte_size + 1 },
					artifacts[1].ref,
				],
			}),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);

		const wrongSha = 'f'.repeat(64);
		await expect(
			getHotspotsHistoryDay('2026-03-29', {
				...index,
				partitions: [
					{
						...artifacts[0].ref,
						sha256: wrongSha,
						path: `historic/history/hotspots/generations/${wrongSha}/2026-03-29.json`,
					},
					artifacts[1].ref,
				],
			}),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(port).toHaveBeenCalledTimes(1);

		port.mockResolvedValueOnce({
			...artifacts[0],
			bytes: artifacts[0].bytes.slice(0, -1),
		});
		await expect(getHotspotsHistoryDay('2026-03-29', index)).rejects.toBeInstanceOf(
			HistoryArtifactContractError,
		);

		const alteredBytes = artifacts[0].bytes.slice();
		alteredBytes[0] = alteredBytes[0] === 32 ? 10 : 32;
		port.mockResolvedValueOnce({ ...artifacts[0], bytes: alteredBytes });
		await expect(getHotspotsHistoryDay('2026-03-29', index)).rejects.toBeInstanceOf(
			HistoryArtifactContractError,
		);

		port.mockResolvedValueOnce({
			...artifacts[0],
			value: { ...artifacts[0].value, date: '2026-03-28' },
		});
		await expect(getHotspotsHistoryDay('2026-03-29', index)).rejects.toBeInstanceOf(
			HistoryArtifactContractError,
		);
	});

	it('rejects Repeat grain endpoints that disagree with the advertised date', async () => {
		const artifacts = [
			await pointArtifact('repeat_offenders', '2026-03-29'),
			await pointArtifact('repeat_offenders', '2026-03-31'),
		];
		const index = await pointCollectionIndex('repeat_offenders', artifacts);
		vi.spyOn(adapter.historic, 'repeatOffendersHistoryDay').mockResolvedValue({
			...artifacts[0],
			value: {
				...artifacts[0].value,
				by_grain: [
					{
						grain: 'week',
						date: '2026-03-23',
						window_end: '2026-03-30',
						window_days: 7,
						entries: [],
						tray: [],
					},
				],
			},
		});

		await expect(getRepeatOffendersHistoryDay('2026-03-29', index)).rejects.toBeInstanceOf(
			HistoryArtifactContractError,
		);
	});
});

describe('retained network partition loading', () => {
	it('loads awkward Line and Stop entities through isolated exact-byte validators', async () => {
		const lineId = 'A/B';
		const stopId = '..';
		const line = await entityArtifact('lines', lineId, '2026-01', '2026-01-31');
		const stop = await entityArtifact('stops', stopId, '2026-01', '2026-01-31');
		const coverage = [
			{
				metric: 'delay',
				aggregation: 'additive',
				first_available_date: '2026-01-31',
				last_available_date: '2026-01-31',
			},
		];
		const linePort = vi.spyOn(adapter.historic, 'lineHistoryPartition').mockResolvedValue(line);
		const stopPort = vi.spyOn(adapter.historic, 'stopHistoryPartition').mockResolvedValue(stop);

		await expect(
			loadLineHistoryRange(
				lineId,
				collectionIndex('lines', GENERATION, lineId, [line.ref], coverage),
				{ from: '2026-01-31', to: '2026-01-31' },
			),
		).resolves.toEqual([line.value]);
		await expect(
			loadStopHistoryRange(
				stopId,
				collectionIndex('stops', GENERATION, stopId, [stop.ref], coverage),
				{ from: '2026-01-31', to: '2026-01-31' },
			),
		).resolves.toEqual([stop.value]);
		expect(linePort).toHaveBeenCalledWith(lineId, line.ref.path, expect.any(Object));
		expect(stopPort).toHaveBeenCalledWith(stopId, stop.ref.path, expect.any(Object));
	});

	it('fails Line/Stop loads on cross-family, cross-entity, month, or byte-size drift', async () => {
		const lineId = 'A/B';
		const line = await entityArtifact('lines', lineId, '2026-01', '2026-01-31');
		const coverage = [
			{
				metric: 'delay',
				aggregation: 'additive',
				first_available_date: '2026-01-31',
				last_available_date: '2026-01-31',
			},
		];
		const linePort = vi.spyOn(adapter.historic, 'lineHistoryPartition');

		await expect(
			loadLineHistoryRange(
				lineId,
				collectionIndex('stops', GENERATION, lineId, [line.ref], coverage),
				{ from: '2026-01-31', to: '2026-01-31' },
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(linePort).not.toHaveBeenCalled();

		linePort.mockResolvedValueOnce({
			...line,
			value: { ...line.value, entity_id: 'other' },
		});
		await expect(
			loadLineHistoryRange(
				lineId,
				collectionIndex('lines', GENERATION, lineId, [line.ref], coverage),
				{ from: '2026-01-31', to: '2026-01-31' },
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);

		linePort.mockResolvedValueOnce({
			...line,
			value: { ...line.value, month: '2026-02' },
		});
		await expect(
			loadLineHistoryRange(
				lineId,
				collectionIndex('lines', GENERATION, lineId, [line.ref], coverage),
				{ from: '2026-01-31', to: '2026-01-31' },
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);

		linePort.mockResolvedValueOnce(line);
		await expect(
			loadLineHistoryRange(
				lineId,
				collectionIndex(
					'lines',
					GENERATION,
					lineId,
					[{ ...line.ref, byte_size: line.ref.byte_size + 1 }],
					coverage,
				),
				{ from: '2026-01-31', to: '2026-01-31' },
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
	});

	it('preflights every ref, fetches only intersections, and returns deterministic month order', async () => {
		const january = await networkArtifact('2026-01', '2026-01-31');
		const february = await networkArtifact('2026-02', '2026-02-01');
		const march = await networkArtifact('2026-03', '2026-03-01');
		const index = collectionIndex(
			'network',
			GENERATION,
			null,
			[march.ref, february.ref, january.ref],
			[
				{
					metric: 'delay',
					aggregation: 'additive',
					first_available_date: '2026-01-31',
					last_available_date: '2026-03-01',
				},
			],
		);
		const byPath = new Map(
			[january, february, march].map((artifact) => [artifact.ref.path, artifact]),
		);
		const partitionPort = vi
			.spyOn(adapter.historic, 'networkHistoryPartition')
			.mockImplementation(async (advertisedPath) => byPath.get(advertisedPath)!);

		const result = await loadNetworkHistoryRange(index, {
			from: '2026-01-31',
			to: '2026-02-01',
		});

		expect(result.map((partition) => partition.month)).toEqual(['2026-01', '2026-02']);
		expect(partitionPort.mock.calls.map(([advertisedPath]) => advertisedPath)).toEqual([
			january.ref.path,
			february.ref.path,
		]);
	});

	it('rejects an unsafe later ref before starting any partition fetch', async () => {
		const safe = await networkArtifact('2026-01', '2026-01-31');
		const unsafe = {
			...safe.ref,
			path: 'https://evil.test/history.json',
			coverage_start: '2026-02-01',
			coverage_end: '2026-02-01',
		};
		const index = {
			...collectionIndex('network', GENERATION, null, [], []),
			partitions: [safe.ref, unsafe],
		};
		const partitionPort = vi.spyOn(adapter.historic, 'networkHistoryPartition');

		await expect(
			loadNetworkHistoryRange(index, { from: '2026-01-01', to: '2026-02-28' }),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
		expect(partitionPort).not.toHaveBeenCalled();
	});

	it('fails closed for advertised 404, byte-size drift, and SHA drift', async () => {
		const artifact = await networkArtifact('2026-01', '2026-01-31');
		const baseMetrics = [
			{
				metric: 'delay',
				aggregation: 'additive',
				first_available_date: '2026-01-31',
				last_available_date: '2026-01-31',
			},
		];
		const partitionPort = vi.spyOn(adapter.historic, 'networkHistoryPartition');

		partitionPort.mockResolvedValueOnce(null);
		await expect(
			loadNetworkHistoryRange(
				collectionIndex('network', GENERATION, null, [artifact.ref], baseMetrics),
				{ from: '2026-01-31', to: '2026-01-31' },
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);

		partitionPort.mockResolvedValueOnce(artifact);
		await expect(
			loadNetworkHistoryRange(
				collectionIndex(
					'network',
					GENERATION,
					null,
					[{ ...artifact.ref, byte_size: artifact.ref.byte_size + 1 }],
					baseMetrics,
				),
				{ from: '2026-01-31', to: '2026-01-31' },
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);

		const wrongSha = 'a'.repeat(64);
		partitionPort.mockResolvedValueOnce(artifact);
		await expect(
			loadNetworkHistoryRange(
				collectionIndex(
					'network',
					GENERATION,
					null,
					[
						{
							...artifact.ref,
							sha256: wrongSha,
							path: `historic/history/network/generations/${wrongSha}/2026-01.json`,
						},
					],
					baseMetrics,
				),
				{ from: '2026-01-31', to: '2026-01-31' },
			),
		).rejects.toBeInstanceOf(HistoryArtifactContractError);
	});

	it('uses exactly four workers, threads one abort signal, and stops on caller cancellation', async () => {
		const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
		const artifacts = await Promise.all(
			months.map((month) => networkArtifact(month, `${month}-01`)),
		);
		const index = collectionIndex(
			'network',
			GENERATION,
			null,
			artifacts.map((artifact) => artifact.ref),
			[
				{
					metric: 'delay',
					aggregation: 'additive',
					first_available_date: '2026-01-01',
					last_available_date: '2026-05-01',
				},
			],
		);
		const waits = new Map(
			artifacts.map((artifact) => [artifact.ref.path, deferred<typeof artifact>()]),
		);
		const started: string[] = [];
		const signals: AbortSignal[] = [];
		const partitionPort = vi
			.spyOn(adapter.historic, 'networkHistoryPartition')
			.mockImplementation(async (advertisedPath, ctx) => {
				started.push(advertisedPath);
				signals.push(ctx!.signal!);
				return waits.get(advertisedPath)!.promise;
			});
		const caller = new AbortController();
		const loading = loadNetworkHistoryRange(
			index,
			{ from: '2026-01-01', to: '2026-05-01' },
			{ signal: caller.signal },
		);

		await vi.waitFor(() => expect(started).toHaveLength(4));
		expect(new Set(signals).size).toBe(1);
		caller.abort();
		await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
		expect(signals[0].aborted).toBe(true);
		expect(started).toHaveLength(4);
		expect(partitionPort).toHaveBeenCalledTimes(4);
	});

	it('does not turn an abort-ignoring late partition completion into success', async () => {
		const artifact = await networkArtifact('2026-01', '2026-01-31');
		const index = collectionIndex(
			'network',
			GENERATION,
			null,
			[artifact.ref],
			[
				{
					metric: 'delay',
					aggregation: 'additive',
					first_available_date: '2026-01-31',
					last_available_date: '2026-01-31',
				},
			],
		);
		const late = deferred<typeof artifact>();
		vi.spyOn(adapter.historic, 'networkHistoryPartition').mockImplementation(
			async () => late.promise,
		);
		const caller = new AbortController();
		let resolved = false;
		const loading = loadNetworkHistoryRange(
			index,
			{ from: '2026-01-31', to: '2026-01-31' },
			{ signal: caller.signal },
		).then(
			() => {
				resolved = true;
			},
			(error: unknown) => error,
		);

		caller.abort();
		await expect(loading).resolves.toMatchObject({ name: 'AbortError' });
		late.resolve(artifact);
		await Promise.resolve();
		expect(resolved).toBe(false);
	});

	it('does not memoize raw bytes between repeated range loads', async () => {
		const artifact = await networkArtifact('2026-01', '2026-01-31');
		const index = collectionIndex(
			'network',
			GENERATION,
			null,
			[artifact.ref],
			[
				{
					metric: 'delay',
					aggregation: 'additive',
					first_available_date: '2026-01-31',
					last_available_date: '2026-01-31',
				},
			],
		);
		const partitionPort = vi
			.spyOn(adapter.historic, 'networkHistoryPartition')
			.mockResolvedValue(artifact);
		const ctx: AdapterCtx = { cache: new Map<string, unknown>() };

		await loadNetworkHistoryRange(index, { from: '2026-01-31', to: '2026-01-31' }, ctx);
		await loadNetworkHistoryRange(index, { from: '2026-01-31', to: '2026-01-31' }, ctx);

		expect(partitionPort).toHaveBeenCalledTimes(2);
	});
});

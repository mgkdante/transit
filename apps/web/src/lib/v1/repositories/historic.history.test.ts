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
	getHistoricAvailability,
	getLineHistoryDirectory,
	getLineHistoryIndex,
	getNetworkHistoryIndex,
	getReceipt,
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

afterEach(() => vi.restoreAllMocks());

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

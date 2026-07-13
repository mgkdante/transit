import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdapterCtx } from '$lib/v1/adapter';
import { adapter } from '$lib/v1/adapter';
import { HistoryArtifactContractError } from '$lib/v1/history';
import {
	AlertArchiveIndexSchema,
	AlertArchivePageSchema,
	HistoricAvailabilityIndexSchema,
	ReceiptSchema,
	ReceiptsIndexSchema,
} from '$lib/v1/schemas';
import {
	getAdvertisedReceipt,
	getAlertArchiveIndex,
	getAlertArchiveRange,
	getHistoricAvailability,
	getReceipt,
} from './historic';

const ISO = '2026-03-31T12:00:00Z';
const GENERATION = 'b'.repeat(64);

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

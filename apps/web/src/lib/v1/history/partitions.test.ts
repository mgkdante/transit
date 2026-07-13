import { describe, expect, it, vi } from 'vitest';
import { AlertArchiveIndexSchema, AlertArchivePageSchema } from '$lib/v1/schemas';
import type { AlertArchivePageRef } from '$lib/v1/schemas';
import type { DateWindow } from '$lib/filters';
import {
	HISTORY_PARTITION_CONCURRENCY,
	HistoryArtifactContractError,
	HistoryPartitionLoadError,
	assertSafeHistoryArtifactPath,
	loadHistoryPartitions,
	mergeAlertArchivePages,
	selectAlertPageRefs,
} from './index';

const GENERATION = 'a'.repeat(64);
const ISO = '2026-03-31T12:00:00Z';

function path(month: string, page: number): string {
	return `historic/alerts/generations/${GENERATION}/${month}/page-${String(page).padStart(4, '0')}.json`;
}

function ref(
	month: string,
	page: number,
	coverageStart: string,
	coverageEnd: string,
): AlertArchivePageRef {
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

function archiveIndex(refsByMonth: ReadonlyArray<[string, readonly AlertArchivePageRef[]]>) {
	return AlertArchiveIndexSchema.parse({
		generated_utc: ISO,
		collection_generation_id: GENERATION,
		first_available_date: '2026-01-01',
		last_available_date: '2026-03-31',
		total_alerts: refsByMonth.reduce((sum, [, refs]) => sum + refs.length, 0),
		months: refsByMonth.map(([month, refs]) => ({
			month,
			total_alerts: refs.length,
			pages: refs,
		})),
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

describe('alert page selection', () => {
	it('selects refs by inclusive coverage overlap, including a long-running old-month alert', () => {
		const januaryLongRunning = ref('2026-01', 1, '2026-01-20', '2026-03-05');
		const february = ref('2026-02', 1, '2026-02-01', '2026-02-28');
		const march = ref('2026-03', 1, '2026-03-01', '2026-03-31');
		const index = archiveIndex([
			['2026-01', [januaryLongRunning]],
			['2026-02', [february]],
			['2026-03', [march]],
		]);
		const window: DateWindow = { from: '2026-03-05', to: '2026-03-10' };

		expect(selectAlertPageRefs(index, window).map((item) => item.path)).toEqual([
			januaryLongRunning.path,
			march.path,
		]);
	});

	it('collapses byte-identical duplicate refs in first-advertised order', () => {
		const first = ref('2026-03', 1, '2026-03-01', '2026-03-15');
		const second = ref('2026-03', 2, '2026-03-16', '2026-03-31');
		const index = archiveIndex([['2026-03', [first, { ...first }, second, { ...second }]]]);

		expect(
			selectAlertPageRefs(index, { from: '2026-03-01', to: '2026-03-31' }).map((item) => item.path),
		).toEqual([first.path, second.path]);
	});

	it('throws typed contract corruption for one path with conflicting metadata', () => {
		const first = ref('2026-03', 1, '2026-03-01', '2026-03-15');
		const index = archiveIndex([['2026-03', [first, { ...first, count: 2 }]]]);

		expect(() => selectAlertPageRefs(index, { from: '2026-03-01', to: '2026-03-31' })).toThrowError(
			HistoryArtifactContractError,
		);
		try {
			selectAlertPageRefs(index, { from: '2026-03-01', to: '2026-03-31' });
		} catch (error) {
			expect(error).toMatchObject({ path: first.path });
		}
	});
});

describe('advertised artifact path safety', () => {
	it('accepts only the exact provider-relative generation path', () => {
		const valid = path('2026-03', 12);
		expect(assertSafeHistoryArtifactPath(valid)).toBe(valid);
	});

	it.each([
		'https://evil.test/file.json',
		'//evil.test/file.json',
		`/${path('2026-03', 1)}`,
		`historic\\alerts\\generations\\${GENERATION}\\2026-03\\page-0001.json`,
		`${path('2026-03', 1)}?download=1`,
		`${path('2026-03', 1)}#fragment`,
		`historic/alerts/generations/${GENERATION}/../2026-03/page-0001.json`,
		`historic/alerts/generations/${GENERATION}/./2026-03/page-0001.json`,
		`historic/alerts/generations/${GENERATION}/%2e%2e/page-0001.json`,
		`historic/alerts/generations/${GENERATION}%2f2026-03/page-0001.json`,
		`historic/alerts/generations/${GENERATION}/2026-13/page-0001.json`,
		`historic/alerts/generations/${GENERATION.toUpperCase()}/2026-03/page-0001.json`,
		`historic/alerts/generations/${GENERATION}/2026-03/page-001.json`,
	])('rejects unsafe or non-contract path %s', (unsafe) => {
		expect(() => assertSafeHistoryArtifactPath(unsafe)).toThrowError(HistoryArtifactContractError);
	});
});

describe('bounded partition loading', () => {
	it('defaults to exactly four active loads and preserves ref order across out-of-order completion', async () => {
		expect(HISTORY_PARTITION_CONCURRENCY).toBe(4);
		const refs = Array.from({ length: 9 }, (_, index) => ({ path: `ref-${index}` }));
		const waits = refs.map(() => deferred<string>());
		const started: number[] = [];
		let active = 0;
		let maxActive = 0;

		const loading = loadHistoryPartitions(refs, async (item) => {
			const index = Number(item.path.slice(4));
			started.push(index);
			active += 1;
			maxActive = Math.max(maxActive, active);
			try {
				return await waits[index].promise;
			} finally {
				active -= 1;
			}
		});

		await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
		expect(maxActive).toBe(4);

		waits[3].resolve('value-3');
		await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3, 4]));
		waits[1].resolve('value-1');
		await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3, 4, 5]));
		for (let index = 0; index < waits.length; index += 1) {
			waits[index].resolve(`value-${index}`);
		}

		expect(await loading).toEqual(refs.map((_, index) => `value-${index}`));
		expect(maxActive).toBe(4);
	});

	it('clamps caller concurrency overrides to 1..8', async () => {
		const refs = Array.from({ length: 9 }, (_, index) => ({ path: `ref-${index}` }));

		async function startsBeforeRelease(concurrency: number): Promise<number> {
			const release = deferred<void>();
			let started = 0;
			const loading = loadHistoryPartitions(
				refs,
				async () => {
					started += 1;
					await release.promise;
					return started;
				},
				{ concurrency },
			);
			await vi.waitFor(() => expect(started).toBe(concurrency > 8 ? 8 : 1));
			const observed = started;
			release.resolve();
			await loading;
			return observed;
		}

		expect(await startsBeforeRelease(99)).toBe(8);
		expect(await startsBeforeRelease(0)).toBe(1);
	});

	it('aborts siblings, stops scheduling, and names the first failed advertised path', async () => {
		const refs = [{ path: 'page-a' }, { path: 'page-b' }, { path: 'page-c' }];
		const failA = deferred<void>();
		const started: string[] = [];
		let siblingSignal: AbortSignal | undefined;

		const loading = loadHistoryPartitions(
			refs,
			async (item, signal) => {
				started.push(item.path);
				if (item.path === 'page-a') {
					await failA.promise;
					throw new Error('broken page');
				}
				siblingSignal = signal;
				return await new Promise<string>((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			},
			{ concurrency: 2 },
		);

		await vi.waitFor(() => expect(started).toEqual(['page-a', 'page-b']));
		failA.resolve();
		await expect(loading).rejects.toMatchObject({
			name: 'HistoryPartitionLoadError',
			path: 'page-a',
		});
		expect(siblingSignal?.aborted).toBe(true);
		expect(started).toEqual(['page-a', 'page-b']);
	});

	it('links caller cancellation and does not wrap it as advertised-path corruption', async () => {
		const caller = new AbortController();
		let internalSignal: AbortSignal | undefined;
		const loading = loadHistoryPartitions(
			[{ path: 'page-a' }, { path: 'page-b' }],
			async (_item, signal) => {
				internalSignal = signal;
				return await new Promise<string>((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				});
			},
			{ signal: caller.signal },
		);

		await vi.waitFor(() => expect(internalSignal).toBeDefined());
		caller.abort();
		await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
		expect(internalSignal?.aborted).toBe(true);
	});
});

describe('stable alert page merging', () => {
	function page(month: string, pageNumber: number, alerts: readonly Record<string, unknown>[]) {
		return AlertArchivePageSchema.parse({
			generated_utc: ISO,
			month,
			page: pageNumber,
			alerts,
		});
	}

	it('sorts newest-first by start/first-seen, then last-seen, then id', () => {
		const pages = [
			page('2026-03', 1, [
				{
					id: 'b',
					start_utc: '2026-03-05T10:00:00Z',
					first_seen_utc: '2026-03-01T00:00:00Z',
					last_seen_utc: '2026-03-06T00:00:00Z',
				},
				{
					id: 'newest',
					start_utc: '2026-03-06T00:00:00Z',
					first_seen_utc: '2026-03-01T00:00:00Z',
					last_seen_utc: '2026-03-06T00:00:00Z',
				},
			]),
			page('2026-03', 2, [
				{
					id: 'a',
					start_utc: null,
					first_seen_utc: '2026-03-05T10:00:00Z',
					last_seen_utc: '2026-03-06T00:00:00Z',
				},
			]),
		];

		expect(mergeAlertArchivePages(pages).map((alert) => alert.id)).toEqual(['newest', 'a', 'b']);
	});

	it('collapses exact duplicates and chooses divergent IDs deterministically', () => {
		const exact = {
			id: 'exact',
			first_seen_utc: '2026-03-01T00:00:00Z',
			last_seen_utc: '2026-03-02T00:00:00Z',
		};
		const older = {
			id: 'divergent',
			header_text: 'older',
			first_seen_utc: '2026-03-01T00:00:00Z',
			last_seen_utc: '2026-03-02T00:00:00Z',
		};
		const newer = { ...older, header_text: 'newer', last_seen_utc: '2026-03-03T00:00:00Z' };
		const tieA = {
			id: 'tie',
			header_text: 'alpha',
			first_seen_utc: '2026-03-01T00:00:00Z',
			last_seen_utc: '2026-03-04T00:00:00Z',
		};
		const tieB = { ...tieA, header_text: 'beta' };
		const first = page('2026-03', 1, [exact, older, tieB]);
		const second = page('2026-03', 2, [{ ...exact }, newer, tieA]);

		const forward = mergeAlertArchivePages([first, second]);
		const reverse = mergeAlertArchivePages([second, first]);
		expect(forward).toEqual(reverse);
		expect(forward.filter((alert) => alert.id === 'exact')).toHaveLength(1);
		expect(forward.find((alert) => alert.id === 'divergent')?.header_text).toBe('newer');
		expect(forward.filter((alert) => alert.id === 'tie')).toHaveLength(1);
	});
});

it('exports typed partition errors through the history barrel', () => {
	const loadError = new HistoryPartitionLoadError('advertised.json', new Error('broken'));
	expect(loadError.path).toBe('advertised.json');
	expect(loadError.cause).toBeInstanceOf(Error);
});

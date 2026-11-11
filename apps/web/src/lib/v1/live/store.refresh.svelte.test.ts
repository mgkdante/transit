import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV1Runtime } from '../runtime';
import type { Manifest } from '../schemas/manifest';
import { isoUtc } from '../schemas/types';
import type { VehiclesFile } from '../schemas/vehicles';
import { createLiveStore, type LiveReader } from './store.svelte';
import { createMemoryLiveReader } from './__fixtures__/reader';

vi.mock('$app/env', () => ({ browser: true }));
const ISO = isoUtc().parse('2026-06-21T12:00:00Z');
const disposers: Array<() => void> = [];

function mount(refreshManifest?: LiveReader['refreshManifest']) {
	const reader = { ...createMemoryLiveReader(), refreshManifest };
	reader.vehicles.mockResolvedValue({ generated_utc: ISO, vehicles: [] });
	const manifest: Manifest = {
		provider: 'stm',
		display_name: 'Fixture',
		dataset_version: 'v1',
		attribution: 'Fixture',
		bbox: [-74, 45, -73, 46],
		labels: {},
		surfaces: [],
		files: { live: { generated_utc: ISO, ttl_s: 30, source_lag_s: 0 } },
	};
	const restore = configureV1Runtime({
		clock: {
			get serverNow() {
				return Date.now();
			},
			noteServerEpochMs() {},
			subscribe: () => () => {},
		},
		refresh: { epoch: 0 },
	});
	let store!: ReturnType<typeof createLiveStore>;
	const dispose = $effect.root(() => {
		store = createLiveStore(manifest, reader, { families: ['vehicles'] });
	});
	disposers.push(() => {
		store.stop();
		dispose();
		restore();
	});
	return { store, reader };
}

describe('explicit live refresh', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.parse(ISO));
	});
	afterEach(() => {
		disposers
			.splice(0)
			.reverse()
			.forEach((dispose) => dispose());
		vi.useRealTimers();
	});

	it('supersedes an in-flight background poll and ignores its late response', async () => {
		const { store, reader } = mount();
		store.start();
		await vi.advanceTimersByTimeAsync(1);
		let finishOld!: () => void;
		const old = new Promise<VehiclesFile>((resolve) => {
			finishOld = () => resolve({ generated_utc: ISO, vehicles: [] });
		});
		const newer = isoUtc().parse('2026-06-21T12:00:30Z');
		reader.vehicles
			.mockImplementationOnce(() => old)
			.mockResolvedValueOnce({ generated_utc: newer, vehicles: [] });
		await vi.advanceTimersByTimeAsync(30_000);
		const oldSignal = reader.vehicles.mock.calls[1][0].signal!;
		const forced = store.refresh({ force: true });
		try {
			await vi.advanceTimersByTimeAsync(1);
			expect(oldSignal.aborted).toBe(true);
			expect(reader.vehicles).toHaveBeenCalledTimes(3);
			await forced;
			expect(store.vehicles?.generated_utc).toBe(newer);
			finishOld();
			await vi.advanceTimersByTimeAsync(1);
			expect(store.vehicles?.generated_utc).toBe(newer);
		} finally {
			finishOld();
		}
	});

	it('retries an unchanged stale report once with reload and commits the newer report', async () => {
		const { store, reader } = mount();
		await store.refresh();
		vi.setSystemTime(Date.parse(ISO) + 120_000);
		const newer = isoUtc().parse('2026-06-21T12:02:00Z');
		reader.vehicles
			.mockResolvedValueOnce({ generated_utc: ISO, vehicles: [] })
			.mockResolvedValueOnce({ generated_utc: newer, vehicles: [] });
		await store.refresh({ force: true });
		expect(reader.vehicles.mock.calls.slice(1).map(([context]) => context.requestCache)).toEqual([
			'no-cache',
			'reload',
		]);
		expect(store.vehicles?.generated_utc).toBe(newer);
	});

	it('suspends due background polls while the forced manifest is loading', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const refreshManifest: NonNullable<LiveReader['refreshManifest']> = async ({ manifest }) => {
			await gate;
			return {
				...manifest,
				files: {
					...manifest.files,
					live: { ...manifest.files.live, vehicles: 'live/new-vehicles.json' },
				},
			};
		};
		const { store, reader } = mount(refreshManifest);
		store.start();
		await vi.advanceTimersByTimeAsync(1);
		await vi.advanceTimersByTimeAsync(29_000);
		const forced = store.refresh({ force: true });
		try {
			await vi.advanceTimersByTimeAsync(2000);
			expect(reader.vehicles).toHaveBeenCalledTimes(1);
		} finally {
			release();
		}
		await forced;
		expect(reader.vehicles.mock.calls[1][0]).toMatchObject({
			requestCache: 'no-cache',
			manifest: { files: { live: { vehicles: 'live/new-vehicles.json' } } },
		});
		const calls = reader.vehicles.mock.calls.length;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(reader.vehicles).toHaveBeenCalledTimes(calls + 1);
	});

	it('retains the current report when both forced reads return an older publication', async () => {
		const { store, reader } = mount();
		await store.refresh();
		reader.vehicles.mockResolvedValue({
			generated_utc: isoUtc().parse('2026-06-21T11:59:30Z'),
			vehicles: [],
		});
		await expect(store.refresh({ force: true })).rejects.toThrow(/older/);
		expect(store.vehicles?.generated_utc).toBe(ISO);
		expect(store.familyStates.vehicles.successRevision).toBe(1);
	});

	it('leaves an unchanged upstream report stale after one bounded retry', async () => {
		const { store, reader } = mount();
		await store.refresh();
		vi.setSystemTime(Date.parse(ISO) + 120_000);
		await store.refresh({ force: true });
		expect(reader.vehicles).toHaveBeenCalledTimes(3);
		expect(store.familyStates.vehicles.health.isStale).toBe(true);
		expect(store.familyStates.vehicles.successRevision).toBe(1);
	});

	it('uses the latest manifest pointer and retries a fresh-looking report behind that manifest', async () => {
		const newer = isoUtc().parse('2026-06-21T12:00:05Z');
		const refreshManifest = vi.fn<NonNullable<LiveReader['refreshManifest']>>(
			async ({ manifest }) => ({
				...manifest,
				files: {
					...manifest.files,
					live: {
						...manifest.files.live,
						generated_utc: newer,
						vehicles: 'live/new-vehicles.json',
					},
				},
			}),
		);
		const { store, reader } = mount(refreshManifest);
		await store.refresh();
		vi.setSystemTime(Date.parse(ISO) + 5000);
		reader.vehicles
			.mockResolvedValueOnce({ generated_utc: ISO, vehicles: [] })
			.mockResolvedValueOnce({ generated_utc: newer, vehicles: [] });
		await store.refresh({ force: true });
		expect(refreshManifest).toHaveBeenCalledOnce();
		expect(reader.vehicles.mock.calls[1][0].manifest.files.live.vehicles).toBe(
			'live/new-vehicles.json',
		);
		expect(reader.vehicles.mock.calls.slice(1).map(([context]) => context.requestCache)).toEqual([
			'no-cache',
			'reload',
		]);
		expect(store.vehicles?.generated_utc).toBe(newer);
	});
});

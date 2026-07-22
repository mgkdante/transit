import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/v1/schemas/manifest';
import type { ContentAdapter } from './types';

vi.mock('$app/environment', () => ({ browser: true }));

const evaluated = vi.hoisted(() => ({
	live: 0,
	static: 0,
	historic: 0,
}));

vi.mock('$lib/v1/schemas/data_health', async (importOriginal) => {
	evaluated.live += 1;
	return importOriginal<typeof import('$lib/v1/schemas/data_health')>();
});

vi.mock('$lib/v1/schemas/routes_index', async (importOriginal) => {
	evaluated.static += 1;
	return importOriginal<typeof import('$lib/v1/schemas/routes_index')>();
});

vi.mock('$lib/v1/schemas/provenance', async (importOriginal) => {
	evaluated.historic += 1;
	return importOriginal<typeof import('$lib/v1/schemas/provenance')>();
});

const PORT_METHODS = {
	manifest: ['get'],
	labels: ['get'],
	live: ['vehicles', 'trips', 'stopDepartures', 'alerts', 'network'],
	static: ['routesIndex', 'route', 'stopsIndex', 'stop'],
	historic: [
		'historyIndex',
		'networkHistoryIndex',
		'hotspotsHistoryIndex',
		'repeatOffendersHistoryIndex',
		'lineHistoryDirectory',
		'stopHistoryDirectory',
		'lineHistoryIndex',
		'stopHistoryIndex',
		'networkHistoryPartition',
		'lineHistoryPartition',
		'stopHistoryPartition',
		'hotspotsHistoryDay',
		'repeatOffendersHistoryDay',
		'alertArchiveIndex',
		'alertArchivePage',
		'networkTrend',
		'hotspots',
		'repeatOffenders',
		'alertHistory',
		'receiptsIndex',
		'routeReliabilityIndex',
		'receipt',
		'routeReliability',
		'stopReliability',
	],
	provenance: ['get'],
	dataHealth: ['get'],
	basemap: ['get'],
} as const satisfies Record<keyof ContentAdapter, readonly string[]>;

interface ObjectSnapshot {
	keys: readonly PropertyKey[];
	values: ReadonlyMap<PropertyKey, unknown>;
}

function expectOrdinaryValueObject(value: object, expectedKeys: readonly string[]): void {
	const ownKeys = Reflect.ownKeys(value);

	expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
	expect(Object.isFrozen(value)).toBe(false);
	expect(new Set(ownKeys)).toEqual(new Set(expectedKeys));
	for (const key of expectedKeys) {
		expect(Object.getOwnPropertyDescriptor(value, key)).toEqual({
			value: Reflect.get(value, key),
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}
}

function snapshotObject(value: object): ObjectSnapshot {
	const keys = Reflect.ownKeys(value);
	return {
		keys,
		values: new Map(keys.map((key) => [key, Reflect.get(value, key)])),
	};
}

function expectUnchanged(value: object, snapshot: ObjectSnapshot): void {
	expect(new Set(Reflect.ownKeys(value))).toEqual(new Set(snapshot.keys));
	for (const key of snapshot.keys) {
		expect(Reflect.get(value, key)).toBe(snapshot.values.get(key));
	}
}

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

describe('r2 lazy adapter boundaries', () => {
	it('does not evaluate tier schemas when only the adapter root is imported', async () => {
		const { r2Adapter } = await import('./r2');

		expect(evaluated).toEqual({
			live: 0,
			static: 0,
			historic: 0,
		});
		expect(r2Adapter).toBeDefined();
	});

	it('exposes stable ordinary value objects for the facade and all eight ports', async () => {
		const { r2Adapter } = await import('./r2');
		const facade = r2Adapter as unknown as Record<string, object>;

		expectOrdinaryValueObject(r2Adapter, Object.keys(PORT_METHODS));
		const facadeSnapshot = snapshotObject(r2Adapter);
		for (const [portName, methodNames] of Object.entries(PORT_METHODS)) {
			const port = facade[portName];
			expectOrdinaryValueObject(port, methodNames);
			expectUnchanged(port, snapshotObject(port));
		}
		expectUnchanged(r2Adapter, facadeSnapshot);
	});

	it('loads only the live family on first data-health use without mutating the facade', async () => {
		const { r2Adapter } = await import('./r2');
		const facade = r2Adapter as unknown as Record<string, object>;
		const facadeSnapshot = snapshotObject(r2Adapter);
		const portSnapshots = new Map(
			Object.keys(PORT_METHODS).map((portName) => [portName, snapshotObject(facade[portName])]),
		);
		const generatedUtc = '2026-07-15T12:00:00Z';
		const dataHealth = { generated_utc: generatedUtc, lanes: [], feeds: [] };
		const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			json(dataHealth),
		);
		const manifest = {
			provider: 'stm',
			display_name: 'STM',
			bbox: [-74, 45, -73, 46],
			attribution: 'STM',
			dataset_version: 'v1',
			labels: {},
			files: {
				live: {
					generated_utc: generatedUtc,
					data_health: 'status/current-data-health.json',
				},
			},
			surfaces: [],
		} as unknown as Manifest;

		await expect(
			r2Adapter.dataHealth.get({
				fetch: request as unknown as typeof fetch,
				manifest,
			}),
		).resolves.toEqual(dataHealth);

		expect(evaluated).toEqual({
			live: 1,
			static: 0,
			historic: 0,
		});
		expectUnchanged(r2Adapter, facadeSnapshot);
		for (const [portName, snapshot] of portSnapshots) {
			expectUnchanged(facade[portName], snapshot);
		}
	});
});

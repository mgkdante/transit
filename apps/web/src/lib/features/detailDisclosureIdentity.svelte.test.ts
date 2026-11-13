import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteFile, StopFile, RouteReliability, StopReliability } from '#lib/v1/index.ts';
import rich from '../../../scripts/__fixtures__/b9/rich.json';
import RouteDetail from './lines/RouteDetail.svelte';
import StopDetail from './stops/StopDetail.svelte';

const navigation = vi.hoisted(() => ({ setPath: (_path: string) => {} }));
const ports = vi.hoisted(() => ({
	getRoute: vi.fn<(id: string) => Promise<RouteFile | null>>(),
	getStop: vi.fn<(id: string) => Promise<StopFile | null>>(),
	getRouteReliability: vi.fn<(id: string) => Promise<RouteReliability | null>>(),
	getStopReliability: vi.fn<(id: string) => Promise<StopReliability | null>>(),
}));

vi.mock('$app/state', async () => {
	const { createSubscriber } = await import('svelte/reactivity');
	let url = new URL('http://localhost/lines/24');
	let notify: (() => void) | undefined;
	const subscribe = createSubscriber((update) => {
		notify = update;
		return () => {
			notify = undefined;
		};
	});
	navigation.setPath = (path) => {
		url = new URL(path, url);
		window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
		notify?.();
	};
	return {
		page: {
			get url() {
				subscribe();
				return url;
			},
			state: {},
			data: {},
		},
	};
});
vi.mock('$app/navigation', () => ({
	afterNavigate: () => {},
	replaceState: (url: string | URL) => navigation.setPath(String(url)),
}));
vi.mock('#lib/v1/repositories/static.ts', () => ({
	getRoute: ports.getRoute,
	getStop: ports.getStop,
}));
vi.mock('#lib/v1/repositories/historic.ts', () => ({
	getRouteReliability: ports.getRouteReliability,
	getStopReliability: ports.getStopReliability,
	getLineHistoryIndex: async () => null,
	getStopHistoryIndex: async () => null,
	loadLineHistoryRange: vi.fn(),
	loadStopHistoryRange: vi.fn(),
}));
vi.mock('#lib/v1/repositories/provenance.ts', () => ({
	getProvenance: async () => ({ gaps: [] }),
}));
vi.mock('#lib/v1/boot.ts', () => ({
	getV1Context: () => ({
		manifest: { provider: 'stm', short_name: 'STM', display_name: 'STM', files: { historic: {} } },
	}),
}));
vi.mock('#lib/v1/live/routeStopPredictions.ts', () => ({
	deriveRouteStopPredictions: () => new Map(),
}));
vi.mock('#lib/v1/live/store.svelte.ts', () => ({
	LIVE_FAMILIES: ['vehicles', 'trips', 'departures', 'alerts', 'network'],
	createLiveStore: () => ({
		departures: { generated_utc: '2026-08-30T16:00:00Z' },
		alerts: { alerts: [] },
		network: null,
		index: { vehiclesByRoute: new Map(), byVehicleId: new Map(), byStopId: new Map() },
		familyStates: Object.fromEntries(
			['departures', 'alerts'].map((family) => [
				family,
				{
					phase: 'ready',
					health: { state: 'live', ageSeconds: 0, isStale: false, notice: null },
				},
			]),
		),
		loading: false,
		error: null,
		start() {},
		stop() {},
		refresh: async () => {},
	}),
}));

const route = rich.files['static/routes/24.json'] as unknown as RouteFile;
const stop = rich.files['static/stops/52095.json'] as unknown as StopFile;
const lineReliability = rich.files[
	'historic/route_reliability/24.json'
] as unknown as RouteReliability;
const stopReliability = rich.files[
	'historic/stop_reliability/52095.json'
] as unknown as StopReliability;

beforeEach(() => {
	ports.getRoute.mockImplementation(async (id) => ({ ...route, id }));
	ports.getStop.mockImplementation(async (id) => ({ ...stop, id }));
	ports.getRouteReliability.mockImplementation(async (id) => ({ ...lineReliability, id }));
	ports.getStopReliability.mockImplementation(async (id) => ({ ...stopReliability, id }));
});
afterEach(cleanup);

async function expectResetOnIdChange(
	container: HTMLElement,
	selector: string,
	rerenderSame: () => Promise<void>,
	rerenderNext: () => Promise<void>,
) {
	const triggers = () => [...container.querySelectorAll<HTMLButtonElement>(selector)];
	await waitFor(() => expect(triggers().length).toBeGreaterThan(0));
	const previous = triggers();
	for (const trigger of previous) {
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(trigger);
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
	}
	await rerenderSame();
	for (const trigger of previous) {
		expect(trigger.isConnected).toBe(true);
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
	}
	await rerenderNext();
	await waitFor(() => {
		const next = triggers();
		expect(next).toHaveLength(previous.length);
		for (const trigger of previous) expect(trigger.isConnected).toBe(false);
		for (const trigger of next) expect(trigger).toHaveAttribute('aria-expanded', 'true');
	});
}

describe.each([false, true])('entity disclosure identity with seeded static data=%s', (seeded) => {
	it.each(['detail', 'schedule', 'reliability'] as const)(
		'RouteDetail resets %s cards on an id change',
		async (tab) => {
			const props = (id: string) => ({
				id,
				seed: { id, name: `Line ${id}` },
				routeSeed: seeded ? { key: id, data: { ...route, id } } : undefined,
			});
			navigation.setPath(`/lines/24?tab=${tab}`);
			const view = render(RouteDetail, { props: props('24') });
			const selector =
				tab === 'reliability'
					? '[data-slot="reliability-clusters"] [data-band] [data-section-trigger]'
					: `[data-toc^="line-${tab}-"] [data-section-trigger]`;
			await expectResetOnIdChange(
				view.container,
				selector,
				() => view.rerender(props('24')),
				async () => {
					navigation.setPath(`/lines/51?tab=${tab}`);
					await view.rerender(props('51'));
				},
			);
		},
	);
	it.each(['detail', 'schedule', 'reliability'] as const)(
		'StopDetail resets %s cards on an id change',
		async (tab) => {
			const props = (id: string) => ({
				id,
				seed: { id, name: `Stop ${id}` },
				stopSeed: seeded ? { key: id, data: { ...stop, id } } : undefined,
			});
			navigation.setPath(`/stop/52095?tab=${tab}`);
			const view = render(StopDetail, { props: props('52095') });
			const selector =
				tab === 'reliability'
					? '.stop-reliability [data-toc^="stop-rel-"] [data-section-trigger]'
					: `[data-toc^="stop-${tab === 'schedule' ? 'schedule' : 'detail'}-"] [data-section-trigger]`;
			await expectResetOnIdChange(
				view.container,
				selector,
				() => view.rerender(props('52095')),
				async () => {
					navigation.setPath(`/stop/52096?tab=${tab}`);
					await view.rerender(props('52096'));
				},
			);
		},
	);
});

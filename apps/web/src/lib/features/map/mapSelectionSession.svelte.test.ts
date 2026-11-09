import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, settled } from 'svelte';
import { buildLiveIndex } from '#lib/v1/live/index.ts';
import type { LiveFamily, LiveFamilyState } from '#lib/v1/live/store.svelte.ts';
import { createFilterStore, emptyFilterState, fromSearchParams } from '#lib/filters/index.ts';
import { RouteFileSchema, StopFileSchema, VehicleSchema } from '#lib/v1/schemas/index.ts';
import { createMapSelectionSession } from './mapSelectionSession.svelte';
import type { SlimStopsIndex } from '#lib/v1/repositories/stopsSlim.ts';

const generation = '2026-06-20T12:00:00Z';
const vehicle = VehicleSchema.parse({
	id: 'bus-1',
	lat: 45.51,
	lon: -73.57,
	status: 'on_time',
	updated_utc: generation,
	route: '24',
});
const stops = [{ id: 'stop-1', name: 'Sherbrooke', lat: 45.51, lon: -73.57 }];
const route = RouteFileSchema.parse({
	id: '24',
	generated_utc: generation,
	long: 'Sherbrooke',
	directions: [],
});
const stop = StopFileSchema.parse({
	...stops[0],
	generated_utc: generation,
	routes_served: ['24'],
	scheduled: [],
});
const disposers: (() => void)[] = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
});

function setup(search = '', stopsRequest?: Promise<SlimStopsIndex>) {
	const families = Object.fromEntries(
		['vehicles', 'trips', 'departures', 'alerts', 'network'].map((name) => [
			name,
			{
				phase: name === 'vehicles' || name === 'alerts' ? 'ready' : 'idle',
				active: name === 'vehicles' || name === 'alerts',
				lastGoodAt: null,
				retainedGeneration: name === 'vehicles' || name === 'alerts' ? generation : null,
				health: {
					ageSource: null,
					ageTimestamp: null,
					state: name === 'vehicles' || name === 'alerts' ? 'live' : 'never-loaded',
					ageSeconds: name === 'vehicles' || name === 'alerts' ? 0 : null,
					isStale: false,
					retained: name === 'vehicles' || name === 'alerts',
					notice: null,
				},
				error: null,
				successRevision: 1,
			},
		]),
	) as Record<LiveFamily, LiveFamilyState>;
	let vehicles = $state([vehicle]);
	let now = $state(Date.parse(generation));
	const familyStates = $state(families);
	const release = vi.fn();
	const live = {
		get index() {
			return buildLiveIndex({ vehicles: { generated_utc: vehicle.updated_utc, vehicles } });
		},
		get vehicles() {
			return { generated_utc: vehicle.updated_utc, vehicles };
		},
		alerts: { generated_utc: vehicle.updated_utc, alerts: [] },
		familyStates,
		subscribeFamilies: vi.fn(() => release),
	};
	const repositories = {
		getStopsIndexSlim: vi.fn(async () => stopsRequest ?? { generated_utc: generation, stops }),
		getRoutesIndex: vi.fn(async () => ({ generated_utc: vehicle.updated_utc, routes: [] })),
		getRoute: vi.fn(
			async (_id: string, _ctx?: { signal?: AbortSignal }): Promise<typeof route | null> => route,
		),
		getStop: vi.fn(async (_id: string, _ctx?: { signal?: AbortSignal }) => stop),
	};
	const filters = createFilterStore(
		search ? fromSearchParams(new URLSearchParams(search)) : emptyFilterState(),
	);
	let session!: ReturnType<typeof createMapSelectionSession>;
	const disposeRoot = $effect.root(() => {
		session = createMapSelectionSession({
			live,
			repositories,
			filters,
			locale: 'en',
			timeZone: 'America/Toronto',
			serverNow: () => now,
		});
		flushSync();
	});
	let disposed = false;
	function destroy() {
		if (disposed) return;
		disposeRoot();
		disposed = true;
	}
	disposers.push(destroy);
	return {
		session,
		live,
		repositories,
		filters,
		release,
		destroy,
		advance(seconds: number) {
			now += seconds * 1000;
			flushSync();
		},
		omit() {
			vehicles = [];
			familyStates.vehicles = {
				...familyStates.vehicles,
				phase: 'ready',
				successRevision: familyStates.vehicles.successRevision + 1,
			};
			flushSync();
		},
		fail() {
			familyStates.vehicles = {
				...familyStates.vehicles,
				phase: 'failed',
				health: {
					...familyStates.vehicles.health,
					state: 'retained-stale',
					notice: 'refresh-unavailable',
				},
				error: new Error('offline'),
			};
			flushSync();
		},
		recover() {
			vehicles = [vehicle];
			familyStates.vehicles = {
				...familyStates.vehicles,
				phase: 'ready',
				health: {
					ageSource: null,
					ageTimestamp: null,
					state: 'live',
					ageSeconds: 0,
					isStale: false,
					retained: true,
					notice: null,
				},
				error: null,
				successRevision: familyStates.vehicles.successRevision + 1,
			};
			flushSync();
		},
	};
}

describe('map selection session', () => {
	it.each(['stop', 'route'] as const)(
		'aborts an in-flight %s detail fetch when selection changes',
		async (kind) => {
			const h = setup();
			await settled();
			let finish!: () => void;
			if (kind === 'stop') {
				h.repositories.getStop.mockImplementation(
					() =>
						new Promise((resolve) => {
							finish = () => resolve(stop);
						}),
				);
			} else {
				h.repositories.getRoute.mockImplementation(
					() =>
						new Promise((resolve) => {
							finish = () => resolve(route);
						}),
				);
			}
			h.session.select({ kind, id: kind === 'stop' ? 'stop-1' : 'pending' }, 'detail');
			flushSync();
			const signal = (kind === 'stop' ? h.repositories.getStop : h.repositories.getRoute).mock
				.lastCall?.[1]?.signal;
			expect(signal?.aborted).toBe(false);
			const next =
				kind === 'stop'
					? ({ kind: 'route', id: '24' } as const)
					: ({ kind: 'stop', id: 'stop-1' } as const);
			h.session.select(next, 'detail');
			flushSync();
			expect(signal?.aborted).toBe(true);
			finish();
			await settled();
			expect(h.session.detail?.kind).toBe(next.kind);
			expect(h.session.detail?.id).toBe(next.id);
		},
	);

	it.each([
		{ kind: 'vehicle', id: 'bus-1', family: 'trips' },
		{ kind: 'stop', id: 'stop-1', family: 'departures' },
	] as const)(
		'releases the $family lease when MapHero destroys its session owner with detail still open',
		async ({ kind, id, family }) => {
			const h = setup();
			await settled();
			h.session.select({ kind, id }, 'detail');
			await settled();
			expect(h.session.detailOpen).toBe(true);
			expect(h.live.subscribeFamilies).toHaveBeenCalledExactlyOnceWith([family]);
			expect(h.release).not.toHaveBeenCalled();
			h.destroy();
			expect(h.release).toHaveBeenCalledOnce();
		},
	);

	it('keeps a vehicle for two successful omissions, then auto-closes and clears only selection-owned filters', async () => {
		const h = setup('route=pinned');
		await settled();
		h.session.select({ kind: 'vehicle', id: 'bus-1' }, 'pick');
		flushSync();
		expect(h.filters.vehicles.has('bus-1')).toBe(true);
		expect(h.filters.routes.has('24')).toBe(true);
		expect(h.session.detail?.id).toBe('bus-1');
		for (let omission = 0; omission < 2; omission++) {
			h.omit();
			expect(h.session.presence).toBe('missing-grace');
			expect(h.session.detail?.id).toBe('bus-1');
			expect(h.session.detailOpen).toBe(true);
		}
		h.omit();
		expect(h.session.selected).toBeNull();
		expect(h.session.detailOpen).toBe(false);
		expect([...h.filters.vehicles]).toEqual([]);
		expect([...h.filters.routes]).toEqual(['pinned']);
	});

	it('retains detail through failures and resets grace after the vehicle reappears', async () => {
		const h = setup();
		await settled();
		h.session.select({ kind: 'vehicle', id: 'bus-1' }, 'pick');
		flushSync();
		h.omit();
		h.fail();
		expect(h.session.sourceHealth).toBe('failed');
		expect(h.session.detail?.id).toBe('bus-1');
		h.recover();
		expect(h.session.presence).toBe('present');
		expect(h.session.sourceHealth).toBe('ok');
		h.omit();
		h.omit();
		expect(h.session.detailOpen).toBe(true);
	});

	it('drills into details with LIFO back, dedupes the current identity, and records new picks in history', async () => {
		const h = setup();
		await settled();
		const first = { kind: 'stop', id: 'stop-1' } as const;
		const next = { kind: 'route', id: '24', direction: 0, variantKey: 'east' } as const;
		h.session.select(first, 'pick');
		h.session.select(next, 'detail');
		h.session.select(next, 'detail');
		h.session.select({ ...next, variantKey: 'west' }, 'detail');
		expect(h.session.stack).toEqual([first, next]);
		h.session.back();
		expect(h.session.selected).toEqual(next);
		h.session.back();
		expect(h.session.selected).toEqual(first);
		h.session.back();
		expect(h.session.selected).toEqual(first);
		h.session.select(next, 'detail');
		h.session.select(first, 'pick');
		expect(h.session.stack).toEqual([first, next]);
		h.session.back();
		expect(h.session.canGoForward).toBe(true);
		h.session.forward();
		expect(h.session.selected).toEqual(first);
		h.session.close();
		expect(h.session.selected).toBeNull();
		expect(h.session.stack).toEqual([]);
	});

	it('preserves user-promoted and URL-adopted filters when the detail closes', async () => {
		const h = setup();
		await settled();
		h.session.select({ kind: 'vehicle', id: 'bus-1' }, 'pick');
		h.session.applyFilter({ kind: 'route', value: '24' });
		h.session.close();
		expect([...h.filters.routes]).toEqual(['24']);
		expect([...h.filters.vehicles]).toEqual([]);
		h.session.select({ kind: 'vehicle', id: 'bus-1' }, 'pick');
		h.filters.replaceFromUrl(
			fromSearchParams(new URLSearchParams('route=24&vehicle=bus-1')),
			'adopt',
		);
		h.session.close();
		expect([...h.filters.vehicles]).toEqual(['bus-1']);
	});

	it('leases trips or departures only for committed selections and releases on close', async () => {
		const h = setup();
		await settled();
		h.session.setHovered({ kind: 'vehicle', id: 'bus-1' });
		flushSync();
		expect(h.live.subscribeFamilies).not.toHaveBeenCalled();
		expect(h.repositories.getRoute).not.toHaveBeenCalled();
		expect(h.repositories.getStop).not.toHaveBeenCalled();
		h.session.select({ kind: 'vehicle', id: 'bus-1' }, 'detail');
		await settled();
		expect(h.live.subscribeFamilies).toHaveBeenCalledExactlyOnceWith(['trips']);
		expect(h.repositories.getRoute).toHaveBeenCalledWith('24', expect.anything());
		h.session.select({ kind: 'stop', id: 'stop-1' }, 'detail');
		await settled();
		expect(h.release).toHaveBeenCalledOnce();
		expect(h.live.subscribeFamilies).toHaveBeenLastCalledWith(['departures']);
		expect(h.repositories.getStop).toHaveBeenCalledExactlyOnceWith('stop-1', expect.anything());
		h.session.close();
		flushSync();
		expect(h.release).toHaveBeenCalledTimes(2);
	});

	it('selects an alert stop before its route and keeps alert filters owned by the session', async () => {
		const h = setup();
		await settled();
		h.session.select({ kind: 'vehicle', id: 'bus-1' }, 'pick');
		h.session.selectAlert({
			id: 'alert',
			severity: 'high',
			header_key: 'Detour',
			stops: ['stop-1'],
			routes: ['24'],
		});
		await settled();
		expect(h.session.selected).toEqual({ kind: 'stop', id: 'stop-1' });
		expect(h.filters.alerts).toEqual(['has_alert']);
		expect(h.session.stack).toEqual([{ kind: 'vehicle', id: 'bus-1' }]);
		h.session.back();
		expect(h.session.selected?.kind).toBe('vehicle');
		h.session.close();
		expect(h.filters.isEmpty).toBe(true);
	});

	it('waits for static resources before focus and auto-close, then closes a terminal route miss', async () => {
		const h = setup();
		await settled();
		let finish!: (value: typeof route | null) => void;
		h.repositories.getRoute.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		h.session.select({ kind: 'route', id: 'missing' }, 'detail');
		flushSync();
		expect(h.session.focusReady({ kind: 'route', id: 'missing' })).toBe(false);
		expect(h.session.detailOpen).toBe(true);
		finish(null);
		await vi.waitFor(() => {
			flushSync();
			expect(h.session.detailOpen).toBe(false);
		});
	});

	it('waits for the stop index and distinguishes a settled missing stop from loading', async () => {
		let resolve!: (value: SlimStopsIndex) => void;
		const h = setup(
			'',
			new Promise((done) => {
				resolve = done;
			}),
		);
		h.session.select({ kind: 'stop', id: 'missing' }, 'detail');
		flushSync();
		expect(h.session.focusReady({ kind: 'stop', id: 'missing' })).toBe(false);
		expect(h.session.detailOpen).toBe(true);
		resolve({ generated_utc: generation, stops });
		await vi.waitFor(() => {
			flushSync();
			expect(h.session.detailOpen).toBe(false);
		});
		expect(h.session.focusReady({ kind: 'stop', id: 'missing' })).toBe(true);
	});

	it('recomputes the selected vehicle fix absence as the clock advances without polling', async () => {
		const h = setup();
		await settled();
		h.session.select({ kind: 'vehicle', id: 'bus-1' }, 'pick');
		flushSync();
		expect(h.session.vehicleAbsence).toBeNull();
		h.advance(180);
		expect(h.session.vehicleAbsence).toEqual({ ageS: 180 });
		expect(h.session.presence).toBe('present');
	});
});

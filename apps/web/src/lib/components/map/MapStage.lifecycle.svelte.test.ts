import { cleanup, render, waitFor } from '@testing-library/svelte';
import { flushSync, tick, unmount as unmountComponent, type Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapStage from './MapStage.svelte';

type FailureKind = 'importer' | 'protocol' | 'style' | 'construct' | 'setup';
type Failure = Readonly<{ kind: FailureKind; retry: () => void | Promise<void> }>;
const MAP_LISTENER_TYPES = ['load', 'styledata', 'sourcedata', 'movestart', 'boxzoomend'] as const;

const harness = vi.hoisted(() => {
	function deferred<T>() {
		let resolve!: (value: T | PromiseLike<T>) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<T>((next, fail) => {
			resolve = next;
			reject = fail;
		});
		return { promise, resolve, reject };
	}

	const state = {
		runtime: deferred<void>(),
		css: deferred<void>(),
		pmtiles: deferred<void>(),
		runtimeError: null as Error | null,
		cssError: null as Error | null,
		pmtilesImportError: null as Error | null,
		protocolConstructorFailures: 0,
		addProtocolFailures: 0,
		styleError: false,
		constructFailures: 0,
		setupFailure: null as string | null,
		observerConstructorFailure: false,
		observerObserveFailure: false,
		maps: [] as MapStub[],
		constructorCalls: 0,
		observers: [] as ResizeObserverStub[],
		loseContext: vi.fn(),
		successfulRegistrations: 0,
	};

	class MapStub {
		readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();
		readonly registrations: Array<[string, (...args: unknown[]) => void]> = [];
		readonly container: HTMLElement;
		readonly remove = vi.fn(() => this.container.replaceChildren());
		readonly resize = vi.fn(() => this.emit('movestart', {}));
		readonly setMaxBounds = vi.fn();
		readonly fitBounds = vi.fn((_bounds: unknown, _options?: Record<string, unknown>) =>
			this.emit('movestart', {}),
		);
		readonly jumpTo = vi.fn((_options?: Record<string, unknown>) => this.emit('movestart', {}));
		readonly easeTo = vi.fn((_options?: Record<string, unknown>) => this.emit('movestart', {}));
		readonly flyTo = vi.fn((_options?: Record<string, unknown>) => this.emit('movestart', {}));
		readonly getZoom = vi.fn(() => 11);
		readonly setStyle = vi.fn();
		readonly getStyle = vi.fn(() => ({ version: 8, sources: {}, layers: [] }));
		readonly getLayer = vi.fn(() => undefined);
		readonly setPaintProperty = vi.fn();

		constructor(readonly options: Record<string, unknown>) {
			state.constructorCalls += 1;
			this.container = options.container as HTMLElement;
			if (state.constructFailures > 0) {
				state.constructFailures -= 1;
				this.container.append(document.createElement('canvas'));
				throw new Error('constructor failed');
			}
			this.container.append(document.createElement('canvas'));
			const details = document.createElement('details');
			details.className =
				'maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show maplibregl-attrib-empty';
			details.setAttribute('open', '');
			details.append(document.createElement('summary'), document.createElement('a'));
			this.container.append(details);
			state.maps.push(this);
		}

		on(type: string, handler: (...args: unknown[]) => void) {
			if (state.setupFailure === `on:${type}`) throw new Error(`listener ${type} failed`);
			const handlers = this.handlers.get(type) ?? new Set();
			handlers.add(handler);
			this.handlers.set(type, handlers);
			this.registrations.push([type, handler]);
			return { unsubscribe: () => this.off(type, handler) };
		}

		readonly off = vi.fn((type: string, handler: (...args: unknown[]) => void): this => {
			this.handlers.get(type)?.delete(handler);
			return this;
		});

		once(type: string, handler: (...args: unknown[]) => void): this {
			const once = (...args: unknown[]) => {
				this.off(type, once);
				handler(...args);
			};
			this.on(type, once);
			return this;
		}

		emit(type: string, payload: Record<string, unknown> = {}): void {
			for (const handler of [...(this.handlers.get(type) ?? [])]) handler(payload);
		}
	}

	class ResizeObserverStub {
		readonly observe = vi.fn((_target: Element) => {
			if (state.observerObserveFailure) throw new Error('observe failed');
		});
		readonly disconnect = vi.fn();

		constructor(readonly callback: ResizeObserverCallback) {
			if (state.observerConstructorFailure) throw new Error('observer failed');
			state.observers.push(this);
		}
	}

	const addProtocol = vi.fn(() => {
		if (state.addProtocolFailures > 0) {
			state.addProtocolFailures -= 1;
			throw new Error('addProtocol failed');
		}
		state.successfulRegistrations += 1;
	});

	class ProtocolStub {
		readonly tile = vi.fn();

		constructor() {
			if (state.protocolConstructorFailures > 0) {
				state.protocolConstructorFailures -= 1;
				throw new Error('Protocol failed');
			}
		}
	}

	function reset(): void {
		state.runtime = deferred<void>();
		state.css = deferred<void>();
		state.pmtiles = deferred<void>();
		state.runtimeError = null;
		state.cssError = null;
		state.pmtilesImportError = null;
		state.protocolConstructorFailures = 0;
		state.addProtocolFailures = 0;
		state.styleError = false;
		state.constructFailures = 0;
		state.setupFailure = null;
		state.observerConstructorFailure = false;
		state.observerObserveFailure = false;
		state.maps.length = 0;
		state.constructorCalls = 0;
		state.observers.length = 0;
		state.loseContext.mockClear();
		state.successfulRegistrations = 0;
		addProtocol.mockClear();
	}
	const importers = {
		maplibre: async () => {
			await state.runtime.promise;
			if (state.runtimeError) throw state.runtimeError;
			return { Map: MapStub, addProtocol };
		},
		css: async () => {
			await state.css.promise;
			if (state.cssError) throw state.cssError;
		},
		pmtiles: async () => {
			await state.pmtiles.promise;
			if (state.pmtilesImportError) throw state.pmtilesImportError;
			return { Protocol: ProtocolStub };
		},
	};

	return { state, reset, MapStub, ResizeObserverStub, addProtocol, ProtocolStub, importers };
});

vi.mock('./basemap', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./basemap')>();
	return {
		...actual,
		resolveBasemapStyle: (...args: Parameters<typeof actual.resolveBasemapStyle>) => {
			if (harness.state.styleError) throw new Error('style failed');
			return actual.resolveBasemapStyle(...args);
		},
	};
});

const Stage = MapStage as unknown as Component<Record<string, unknown>>;

async function settle(): Promise<void> {
	await tick();
	await Promise.resolve();
	await Promise.resolve();
}

function releaseImports(): void {
	harness.state.runtime.resolve();
	harness.state.css.resolve();
	harness.state.pmtiles.resolve();
}

async function bootStage(extraProps: Record<string, unknown> = {}) {
	const props = {
		importers: harness.importers,
		basemapLoader: vi.fn(async () => null),
		...extraProps,
	};
	const view = render(Stage, { props });
	releaseImports();
	await waitFor(() => expect(harness.state.maps).toHaveLength(1));
	return { view, props, map: harness.state.maps[0]! };
}

beforeEach(() => {
	harness.reset();
	vi.stubGlobal('ResizeObserver', harness.ResizeObserverStub);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
		() =>
			({
				getExtension: () => ({ loseContext: harness.state.loseContext }),
			}) as unknown as RenderingContext,
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('MapStage boot lifecycle', () => {
	it('classifies every protocol fault and retries after each rejected shared registration', async () => {
		harness.state.pmtilesImportError = new Error('pmtiles import failed');
		const failures: Failure[] = [];
		const signals: AbortSignal[] = [];
		render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader: ({ signal }: { signal: AbortSignal }) => {
					signals.push(signal);
					return Promise.resolve(null);
				},
				onerror: (failure: Failure | null) => {
					if (failure) failures.push(failure);
				},
			},
		});
		releaseImports();
		await waitFor(() => expect(failures).toHaveLength(1));
		expect(failures[0]?.kind).toBe('protocol');
		expect(signals[0]?.aborted).toBe(true);

		harness.state.pmtilesImportError = null;
		harness.state.protocolConstructorFailures = 1;
		await failures[0]!.retry();
		await waitFor(() => expect(failures).toHaveLength(2));
		expect(failures[1]?.kind).toBe('protocol');
		expect(signals[1]?.aborted).toBe(true);

		harness.state.addProtocolFailures = 1;
		await failures[1]!.retry();
		await waitFor(() => expect(failures).toHaveLength(3));
		expect(failures[2]?.kind).toBe('protocol');
		expect(signals[2]?.aborted).toBe(true);

		await failures[2]!.retry();
		await waitFor(() => expect(harness.state.maps).toHaveLength(1));
		expect(signals[3]?.aborted).toBe(false);
		expect(harness.state.constructorCalls).toBe(1);
		expect(harness.state.successfulRegistrations).toBe(1);
	});

	it('starts the abort-aware basemap load before vendor settlement and constructs only after every barrier', async () => {
		const basemap = (() => {
			let resolve!: (value: null) => void;
			const promise = new Promise<null>((next) => (resolve = next));
			return { promise, resolve };
		})();
		const basemapLoader = vi.fn((_ctx: { signal: AbortSignal }) => basemap.promise);
		render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader,
				locale: {
					'Map.Title': 'Interactive map',
					'AttributionControl.ToggleAttribution': 'Toggle attribution',
				},
			},
		});
		await settle();
		expect(basemapLoader).toHaveBeenCalledTimes(1);
		expect(basemapLoader.mock.calls[0]?.[0]?.signal).toBeInstanceOf(AbortSignal);
		expect(harness.state.maps).toHaveLength(0);

		harness.state.runtime.resolve();
		await settle();
		expect(harness.state.maps).toHaveLength(0);
		harness.state.css.resolve();
		await settle();
		expect(harness.state.maps).toHaveLength(0);
		harness.state.pmtiles.resolve();
		await settle();
		expect(harness.state.maps).toHaveLength(0);

		basemap.resolve(null);
		await waitFor(() => expect(harness.state.maps).toHaveLength(1));
		expect(harness.state.maps[0]?.options.locale).toEqual({
			'Map.Title': 'Interactive map',
			'AttributionControl.ToggleAttribution': 'Toggle attribution',
		});
		expect(harness.state.loseContext).toHaveBeenCalledTimes(1);
	});

	it('keeps a rejected basemap fail-soft and constructs from the null fallback', async () => {
		const onerror = vi.fn();
		render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader: vi.fn(async () => Promise.reject(new Error('offline'))),
				onerror,
			},
		});
		releaseImports();

		await waitFor(() => expect(harness.state.maps).toHaveLength(1));
		expect(onerror).not.toHaveBeenCalledWith(expect.objectContaining({ kind: expect.anything() }));
	});

	it('aborts an in-flight basemap after a fatal import and absorbs its late rejection', async () => {
		let signal: AbortSignal | undefined;
		let rejectBasemap!: (reason?: unknown) => void;
		const basemapPromise = new Promise<null>((_resolve, reject) => (rejectBasemap = reject));
		const failures: Failure[] = [];
		const unhandled = vi.fn();
		process.on('unhandledRejection', unhandled);
		try {
			harness.state.runtimeError = new Error('runtime failed');
			render(Stage, {
				props: {
					importers: harness.importers,
					basemapLoader: (ctx?: { signal: AbortSignal }) => {
						signal = ctx?.signal;
						return basemapPromise;
					},
					onerror: (failure: Failure | null) => {
						if (failure) failures.push(failure);
					},
				},
			});
			await settle();
			expect(signal?.aborted).toBe(false);

			releaseImports();
			await waitFor(() => expect(failures.at(-1)?.kind).toBe('importer'));
			expect(signal?.aborted).toBe(true);
			expect(harness.state.maps).toHaveLength(0);

			rejectBasemap(new Error('late basemap failure'));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(unhandled).not.toHaveBeenCalled();
			expect(harness.state.maps).toHaveLength(0);
		} finally {
			process.off('unhandledRejection', unhandled);
		}
	});

	it.each([
		[
			'runtime import',
			'importer',
			(): void => void (harness.state.runtimeError = new Error('runtime failed')),
		],
		['CSS import', 'importer', (): void => void (harness.state.cssError = new Error('CSS failed'))],
		['style resolution', 'style', (): void => void (harness.state.styleError = true)],
		['construction', 'construct', (): void => void (harness.state.constructFailures = 1)],
	] as const)(
		'reports a fatal %s fault without leaking the attempt',
		async (_label, kind, arrange) => {
			arrange();
			let signal: AbortSignal | undefined;
			const failures: Failure[] = [];
			render(Stage, {
				props: {
					importers: harness.importers,
					basemapLoader: (ctx?: { signal: AbortSignal }) => {
						signal = ctx?.signal;
						return Promise.resolve(null);
					},
					onerror: (failure: Failure | null) => {
						if (failure) failures.push(failure);
					},
				},
			});
			releaseImports();

			await waitFor(() => expect(failures.at(-1)?.kind).toBe(kind));
			expect(signal?.aborted).toBe(true);
		},
	);

	it.each([
		['load listener', (): void => void (harness.state.setupFailure = 'on:load'), 0, []],
		[
			'styledata listener',
			(): void => void (harness.state.setupFailure = 'on:styledata'),
			0,
			['load'],
		],
		[
			'sourcedata listener',
			(): void => void (harness.state.setupFailure = 'on:sourcedata'),
			0,
			['load', 'styledata'],
		],
		[
			'movestart listener',
			(): void => void (harness.state.setupFailure = 'on:movestart'),
			0,
			['load', 'styledata', 'sourcedata'],
		],
		[
			'boxzoomend listener',
			(): void => void (harness.state.setupFailure = 'on:boxzoomend'),
			0,
			['load', 'styledata', 'sourcedata', 'movestart'],
		],
		[
			'ResizeObserver construction',
			(): void => void (harness.state.observerConstructorFailure = true),
			0,
			MAP_LISTENER_TYPES,
		],
		[
			'ResizeObserver observation',
			(): void => void (harness.state.observerObserveFailure = true),
			1,
			MAP_LISTENER_TYPES,
		],
	] as const)(
		'cleans the constructed map and observer after fatal %s setup',
		async (_label, arrange, expectedObservers, expectedOffTypes) => {
			arrange();
			const failures: Failure[] = [];
			render(Stage, {
				props: {
					importers: harness.importers,
					basemapLoader: vi.fn(async () => null),
					onerror: (failure: Failure | null) => {
						if (failure) failures.push(failure);
					},
				},
			});
			releaseImports();

			await waitFor(() => expect(failures.at(-1)?.kind).toBe('setup'));
			const map = harness.state.maps[0]!;
			expect(map.off.mock.calls.map(([type]) => type)).toEqual(expectedOffTypes);
			expect(map.off.mock.calls).toEqual(map.registrations);
			for (const type of MAP_LISTENER_TYPES) expect(map.handlers.get(type)?.size ?? 0).toBe(0);
			for (const offOrder of map.off.mock.invocationCallOrder) {
				expect(offOrder).toBeLessThan(map.remove.mock.invocationCallOrder[0]!);
			}
			expect(map.remove).toHaveBeenCalledTimes(1);
			expect(harness.state.observers).toHaveLength(expectedObservers);
			for (const observer of harness.state.observers) {
				expect(observer.disconnect).toHaveBeenCalledTimes(1);
			}
		},
	);

	it('aborts and suppresses a pending attempt when unmounted mid-boot', async () => {
		let signal: AbortSignal | undefined;
		const onerror = vi.fn();
		const view = render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader: (ctx?: { signal: AbortSignal }) => {
					signal = ctx?.signal;
					return new Promise<null>(() => {});
				},
				onerror,
			},
		});
		await settle();

		view.unmount();
		releaseImports();
		await settle();

		expect(signal?.aborted).toBe(true);
		expect(harness.state.maps).toHaveLength(0);
		expect(onerror).not.toHaveBeenCalled();
	});

	it('cleans a successful attempt exactly once on unmount', async () => {
		let signal: AbortSignal | undefined;
		const view = render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader: (ctx?: { signal: AbortSignal }) => {
					signal = ctx?.signal;
					return Promise.resolve(null);
				},
			},
		});
		releaseImports();
		await waitFor(() => expect(harness.state.maps).toHaveLength(1));

		view.unmount();
		view.unmount();

		expect(signal?.aborted).toBe(true);
		expect(harness.state.maps[0]?.remove).toHaveBeenCalledTimes(1);
		expect(harness.state.observers[0]?.disconnect).toHaveBeenCalledTimes(1);
	});

	it('releases the consumer while the map is still live, before MapLibre removal', async () => {
		const order: string[] = [];
		const onbeforeremove = vi.fn((map: InstanceType<typeof harness.MapStub>) => {
			order.push('consumer');
			expect(map.remove).not.toHaveBeenCalled();
		});
		const { view, map } = await bootStage({ onbeforeremove });
		map.remove.mockImplementation(() => {
			order.push('map');
			map.container.replaceChildren();
		});

		view.unmount();

		expect(onbeforeremove).toHaveBeenCalledExactlyOnceWith(map);
		expect(order).toEqual(['consumer', 'map']);
	});

	it('still removes MapLibre exactly once when consumer release throws', async () => {
		const releaseError = new Error('consumer release failed');
		const onbeforeremove = vi.fn(() => {
			throw releaseError;
		});
		const { view, map } = await bootStage({
			onbeforeremove,
		});
		const registeredHandlers = MAP_LISTENER_TYPES.map((type) => {
			const handlers = [...(map.handlers.get(type) ?? [])];
			expect(handlers).toHaveLength(1);
			return handlers[0]!;
		});
		expect(registeredHandlers[1]).toBe(registeredHandlers[2]);
		const mapRemoveError = new Error('MapLibre remove failed after listener cleanup');
		map.remove.mockImplementation(() => {
			map.container.replaceChildren();
			throw mapRemoveError;
		});

		await expect(unmountComponent(view.component)).rejects.toBe(releaseError);
		expect(onbeforeremove).toHaveBeenCalledExactlyOnceWith(map);
		expect(map.off.mock.calls).toEqual(
			MAP_LISTENER_TYPES.map((type, index) => [type, registeredHandlers[index]]),
		);
		for (const type of MAP_LISTENER_TYPES) expect(map.handlers.get(type)?.size ?? 0).toBe(0);
		const consumerOrder = onbeforeremove.mock.invocationCallOrder[0]!;
		for (const offOrder of map.off.mock.invocationCallOrder) {
			expect(consumerOrder).toBeLessThan(offOrder);
			expect(offOrder).toBeLessThan(map.remove.mock.invocationCallOrder[0]!);
		}
		expect(map.remove).toHaveBeenCalledOnce();
	});

	it('uses one document reload for importer-class retry instead of re-importing in place', async () => {
		harness.state.runtimeError = new Error('runtime failed');
		const reload = vi.fn();
		vi.stubGlobal('location', { reload });
		const failures: Failure[] = [];
		render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader: vi.fn(async () => null),
				onerror: (failure: Failure | null) => {
					if (failure) failures.push(failure);
				},
			},
		});
		releaseImports();
		await waitFor(() => expect(failures.at(-1)?.kind).toBe('importer'));

		await Promise.all([failures[0]!.retry(), failures[0]!.retry()]);

		expect(reload).toHaveBeenCalledTimes(1);
		expect(harness.state.constructorCalls).toBe(0);
	});

	it('guards double retry, remounts an empty host, and suppresses the stale attempt', async () => {
		harness.state.constructFailures = 1;
		const failures: Failure[] = [];
		const view = render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader: vi.fn(async () => null),
				onerror: (failure: Failure | null) => {
					if (failure) failures.push(failure);
				},
			},
		});
		releaseImports();
		await waitFor(() => expect(failures.at(-1)?.kind).toBe('construct'));
		const firstHost = view.container.querySelector('[data-slot="map-stage"]');
		expect(firstHost?.querySelector('canvas')).not.toBeNull();

		const firstRetry = failures.at(-1)!.retry();
		const duplicateRetry = failures.at(-1)!.retry();
		await Promise.all([firstRetry, duplicateRetry]);

		await waitFor(() => expect(harness.state.maps).toHaveLength(1));
		const retriedHost = view.container.querySelector('[data-slot="map-stage"]');
		expect(retriedHost).not.toBe(firstHost);
		expect(retriedHost?.querySelectorAll('canvas')).toHaveLength(1);
		expect(harness.state.maps[0]?.options.center).toEqual([-73.5673, 45.5017]);
	});

	it('ignores a stale failure retry after a newer generation has failed', async () => {
		harness.state.constructFailures = 2;
		const failures: Failure[] = [];
		render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader: vi.fn(async () => null),
				onerror: (failure: Failure | null) => {
					if (failure) failures.push(failure);
				},
			},
		});
		releaseImports();
		await waitFor(() => expect(failures).toHaveLength(1));
		await failures[0]!.retry();
		await waitFor(() => expect(failures).toHaveLength(2));

		await failures[0]!.retry();
		await settle();
		expect(harness.state.constructorCalls).toBe(2);
		expect(harness.state.maps).toHaveLength(0);

		await failures[1]!.retry();
		await waitFor(() => expect(harness.state.maps).toHaveLength(1));
		expect(harness.state.constructorCalls).toBe(3);
	});

	it('separates theme repaint from genuine style swaps without constructing a second map', async () => {
		const onthemerepaint = vi.fn();
		const onstyleload = vi.fn();
		const view = render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader: vi.fn(async () => null),
				theme: 'dark',
				onthemerepaint,
				onstyleload,
			},
		});
		releaseImports();
		await waitFor(() => expect(harness.state.maps).toHaveLength(1));

		await view.rerender({
			importers: harness.importers,
			basemapLoader: vi.fn(async () => null),
			theme: 'light',
			center: [-73.6, 45.52],
			zoom: 12,
			bounds: [-74, 45, -73, 46],
			maxBounds: [-75, 44, -72, 47],
			fitPadding: { top: 10, right: 20, bottom: 30, left: 40 },
			onthemerepaint,
			onstyleload,
		});
		await settle();

		expect(harness.state.maps).toHaveLength(1);
		expect(harness.state.constructorCalls).toBe(1);
		expect(harness.state.maps[0]?.setStyle).not.toHaveBeenCalled();
		expect(onstyleload).not.toHaveBeenCalled();
		expect(onthemerepaint).toHaveBeenCalledTimes(1);

		await view.rerender({
			importers: harness.importers,
			basemapLoader: vi.fn(async () => null),
			theme: 'light',
			basemap: {
				url: 'https://example.com/montreal.pmtiles',
				attribution: 'Example',
				generated_utc: '2026-07-31T00:00:00Z',
			},
			onthemerepaint,
			onstyleload,
		});
		await settle();
		expect(harness.state.maps).toHaveLength(1);
		expect(harness.state.maps[0]?.setStyle).toHaveBeenCalledTimes(1);
		expect(onthemerepaint).toHaveBeenCalledTimes(1);
		expect(onstyleload).not.toHaveBeenCalled();

		harness.state.maps[0]?.emit('style.load');
		expect(onstyleload).toHaveBeenCalledTimes(1);
	});

	it('uses the normalized constructor viewport as the first fit with zero boot fitBounds calls', async () => {
		const bounds = [-74, 45, -73, 46];
		const maxBounds = [-75, 44, -72, 47];
		const fitPadding = { top: 10, right: 20, bottom: 30, left: 40 };
		const { map } = await bootStage({ bounds, maxBounds, fitPadding });

		expect(map.options).toMatchObject({
			bounds: [
				[-74, 45],
				[-73, 46],
			],
			maxBounds: [
				[-75, 44],
				[-72, 47],
			],
			fitBoundsOptions: { padding: fitPadding },
		});
		expect(map.fitBounds).not.toHaveBeenCalled();
		expect(map.setMaxBounds).not.toHaveBeenCalled();
	});

	it('coalesces fit-owned layout and bounds changes and applies prop camera changes', async () => {
		const initial = {
			bounds: [-74, 45, -73, 46],
			maxBounds: [-75, 44, -72, 47],
			fitPadding: { top: 10, right: 20, bottom: 30, left: 40 },
			center: [-73.6, 45.5],
			zoom: 11,
		};
		const { view, props, map } = await bootStage(initial);

		await view.rerender({ ...props, ...initial, fitPadding: 48 });
		await settle();
		expect(map.fitBounds).toHaveBeenCalledTimes(1);
		expect(map.setMaxBounds).not.toHaveBeenCalled();
		expect(map.fitBounds.mock.calls[0]?.[1]).not.toHaveProperty('offset');

		await view.rerender({
			...props,
			...initial,
			fitPadding: 64,
			bounds: [-73.9, 45.1, -73.1, 45.9],
			maxBounds: [-74.8, 44.8, -72.8, 46.2],
		});
		await settle();
		expect(map.setMaxBounds).toHaveBeenCalledTimes(1);
		expect(map.fitBounds).toHaveBeenCalledTimes(2);

		await view.rerender({
			...props,
			...initial,
			fitPadding: 64,
			bounds: [-73.9, 45.1, -73.1, 45.9],
			maxBounds: [-74.8, 44.8, -72.8, 46.2],
			center: [-73.7, 45.6],
			zoom: 13,
		});
		await settle();
		expect(map.jumpTo).toHaveBeenCalledWith({ center: [-73.7, 45.6], zoom: 13 });
		expect(harness.state.constructorCalls).toBe(1);
	});

	it.each([
		['wheel', 'movestart', { originalEvent: { type: 'wheel' } }],
		['touch drag', 'movestart', { originalEvent: { type: 'touchmove' } }],
		['keyboard camera', 'movestart', { originalEvent: { type: 'keydown' } }],
		['box zoom', 'boxzoomend', {}],
		['tagged focus', 'movestart', { cameraIntent: 'focus' }],
	] as const)('%s ownership suppresses a layout-driven re-fit', async (_label, event, payload) => {
		const { view, props, map } = await bootStage({ fitPadding: 40 });

		map.emit(event, payload);
		await view.rerender({ ...props, fitPadding: 80 });
		await settle();

		expect(map.fitBounds).not.toHaveBeenCalled();
	});

	it.each([
		['user', { originalEvent: { type: 'wheel' } }],
		['focus', { cameraIntent: 'focus' }],
	] as const)(
		'records each changed signature while %s-owned, applying only current max bounds',
		async (_owner, ownershipEvent) => {
			const initialBounds = [-74, 45, -73, 46];
			const initialMaxBounds = [-75, 44, -72, 47];
			const changedBounds = [-73.9, 45.1, -73.1, 45.9];
			const changedMaxBounds = [-74.8, 44.8, -72.8, 46.2];
			const { view, props, map } = await bootStage({
				bounds: initialBounds,
				maxBounds: initialMaxBounds,
				fitPadding: 40,
				center: [-73.6, 45.5],
				zoom: 11,
			});

			map.emit('movestart', ownershipEvent);
			await view.rerender({
				...props,
				bounds: changedBounds,
				maxBounds: initialMaxBounds,
			});
			await settle();
			expect(map.setMaxBounds).toHaveBeenCalledTimes(1);
			expect(map.setMaxBounds).toHaveBeenLastCalledWith([
				[-75, 44],
				[-72, 47],
			]);

			await view.rerender({ ...props, bounds: changedBounds, maxBounds: initialMaxBounds });
			await settle();
			expect(map.setMaxBounds).toHaveBeenCalledTimes(1);

			await view.rerender({ ...props, bounds: changedBounds, maxBounds: changedMaxBounds });
			await settle();
			expect(map.setMaxBounds).toHaveBeenCalledTimes(2);
			expect(map.setMaxBounds).toHaveBeenLastCalledWith([
				[-74.8, 44.8],
				[-72.8, 46.2],
			]);

			await view.rerender({
				...props,
				bounds: changedBounds,
				maxBounds: changedMaxBounds,
				fitPadding: 80,
				center: [-73.7, 45.6],
				zoom: 13,
			});
			await settle();
			expect(map.setMaxBounds).toHaveBeenCalledTimes(2);
			expect(map.fitBounds).not.toHaveBeenCalled();
			expect(map.jumpTo).not.toHaveBeenCalled();
		},
	);

	it('leaves fit ownership unchanged for untagged programmatic movement', async () => {
		const { view, props, map } = await bootStage({ fitPadding: 40 });

		map.emit('movestart', {});
		await view.rerender({ ...props, fitPadding: 80 });
		await settle();

		expect(map.fitBounds).toHaveBeenCalledTimes(1);
	});

	it('keeps box-zoom user ownership through the following untagged movement', async () => {
		const { view, props, map } = await bootStage({ fitPadding: 40 });

		map.emit('boxzoomend');
		map.emit('movestart', {});
		await view.rerender({ ...props, fitPadding: 80 });
		await settle();

		expect(map.fitBounds).not.toHaveBeenCalled();
	});

	it('keeps fit ownership through untagged resize movement from load and ResizeObserver', async () => {
		const { view, props, map } = await bootStage({ fitPadding: 40 });

		map.emit('load');
		expect(map.resize).toHaveBeenCalledTimes(1);
		await view.rerender({ ...props, fitPadding: 60 });
		await settle();
		expect(map.fitBounds).toHaveBeenCalledTimes(1);

		map.fitBounds.mockClear();
		const observer = harness.state.observers[0]!;
		observer.callback([], observer as unknown as ResizeObserver);
		expect(map.resize).toHaveBeenCalledTimes(2);
		await view.rerender({ ...props, fitPadding: 80 });
		await settle();
		expect(map.fitBounds).toHaveBeenCalledTimes(1);
	});

	it('re-derives constructor viewport and signatures from retry-time props', async () => {
		harness.state.setupFailure = 'on:styledata';
		let claimedUser = false;
		const originalOn = harness.MapStub.prototype.on;
		const setupClaim = vi.spyOn(harness.MapStub.prototype, 'on').mockImplementation(function (
			this: InstanceType<typeof harness.MapStub>,
			type,
			handler,
		) {
			const result = originalOn.call(this, type, handler);
			if (!claimedUser && type === 'load') {
				claimedUser = true;
				flushSync();
				this.emit('movestart', { originalEvent: { type: 'wheel' } });
			}
			return result;
		});
		const failures: Failure[] = [];
		const initialProps = {
			importers: harness.importers,
			basemapLoader: vi.fn(async () => null),
			bounds: [-74, 45, -73, 46],
			maxBounds: [-75, 44, -72, 47],
			fitPadding: 40,
			onerror: (failure: Failure | null) => {
				if (failure) failures.push(failure);
			},
		};
		const view = render(Stage, { props: initialProps });
		releaseImports();
		await waitFor(() => expect(failures).toHaveLength(1));
		expect(claimedUser).toBe(true);
		setupClaim.mockRestore();

		const retryProps = {
			...initialProps,
			bounds: [-73.9, 45.1, -73.1, 45.9],
			maxBounds: [-74.8, 44.8, -72.8, 46.2],
			fitPadding: { top: 12, right: 24, bottom: 36, left: 48 },
			center: [-73.7, 45.6],
			zoom: 13,
		};
		await view.rerender(retryProps);
		harness.state.setupFailure = null;
		await failures[0]!.retry();
		await waitFor(() => expect(harness.state.maps).toHaveLength(2));
		const retriedMap = harness.state.maps[1]!;

		expect(retriedMap.options).toMatchObject({
			center: [-73.7, 45.6],
			zoom: 13,
			bounds: [
				[-73.9, 45.1],
				[-73.1, 45.9],
			],
			maxBounds: [
				[-74.8, 44.8],
				[-72.8, 46.2],
			],
			fitBoundsOptions: { padding: retryProps.fitPadding },
		});
		expect(retriedMap.fitBounds).not.toHaveBeenCalled();

		await view.rerender({ ...retryProps, fitPadding: 72 });
		await settle();
		expect(retriedMap.fitBounds).toHaveBeenCalledTimes(1);
	});

	it('disposes camera ownership listeners with the owning boot attempt', async () => {
		const { view, map } = await bootStage();
		expect(map.handlers.get('movestart')).toHaveLength(1);
		expect(map.handlers.get('boxzoomend')).toHaveLength(1);

		view.unmount();
		await settle();

		expect(map.handlers.get('movestart')).toHaveLength(0);
		expect(map.handlers.get('boxzoomend')).toHaveLength(0);
	});
});

describe('MapStage attribution one-shot', () => {
	it('waits for populated attribution and preserves native keyboard reopening and closing', async () => {
		const stageModule =
			(await import('./MapStage.svelte')) as typeof import('./MapStage.svelte') & {
				collapsePopulatedAttribution?: (container: HTMLElement) => boolean;
			};
		const collapse = stageModule.collapsePopulatedAttribution ?? (() => false);
		const host = document.createElement('div');
		host.innerHTML =
			'<details class="maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show maplibregl-attrib-empty" open><summary></summary><a href="https://example.com">Source</a></details>';
		const details = host.querySelector('details')!;

		expect(collapse(host)).toBe(false);
		details.classList.remove('maplibregl-attrib-empty');
		expect(collapse(host)).toBe(true);
		expect(details).toHaveClass('maplibregl-compact');
		expect(details).not.toHaveClass('maplibregl-compact-show');
		expect(details).not.toHaveAttribute('open');

		const summary = details.querySelector('summary') as HTMLElement;
		summary.click();
		expect(details).toHaveAttribute('open');
		expect(details.querySelector('a')).toHaveAttribute('href', 'https://example.com');
		summary.click();
		expect(details).not.toHaveAttribute('open');
	});

	it('detaches both data listeners after the first populated attribution event', async () => {
		const view = render(Stage, {
			props: {
				importers: harness.importers,
				basemapLoader: vi.fn(async () => null),
			},
		});
		releaseImports();
		await waitFor(() => expect(harness.state.maps).toHaveLength(1));
		const map = harness.state.maps[0]!;
		const details = view.container.querySelector('details')!;

		map.emit('styledata');
		expect(details).toHaveClass('maplibregl-compact-show', 'maplibregl-attrib-empty');
		expect(details).toHaveAttribute('open');

		details.classList.remove('maplibregl-attrib-empty');
		map.emit('sourcedata');
		expect(details).not.toHaveClass('maplibregl-compact-show');
		expect(details).not.toHaveAttribute('open');
		expect(map.handlers.get('styledata')).toHaveLength(0);
		expect(map.handlers.get('sourcedata')).toHaveLength(0);

		details.querySelector('a')!.textContent = 'Updated source';
		map.emit('styledata');
		expect(details).not.toHaveAttribute('open');
		expect(details).not.toHaveClass('maplibregl-compact-show');
	});
});

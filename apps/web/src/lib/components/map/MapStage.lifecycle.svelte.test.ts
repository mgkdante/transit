import { cleanup, render, waitFor } from '@testing-library/svelte';
import { tick, type Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapStage from './MapStage.svelte';

type FailureKind = 'importer' | 'protocol' | 'style' | 'construct' | 'setup';
type Failure = Readonly<{ kind: FailureKind; retry: () => void | Promise<void> }>;

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
		readonly container: HTMLElement;
		readonly remove = vi.fn(() => this.container.replaceChildren());
		readonly resize = vi.fn();
		readonly setMaxBounds = vi.fn();
		readonly fitBounds = vi.fn();
		readonly jumpTo = vi.fn();
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

		on(type: string, handler: (...args: unknown[]) => void): this {
			if (state.setupFailure === `on:${type}`) throw new Error(`listener ${type} failed`);
			const handlers = this.handlers.get(type) ?? new Set();
			handlers.add(handler);
			this.handlers.set(type, handlers);
			return this;
		}

		off(type: string, handler: (...args: unknown[]) => void): this {
			this.handlers.get(type)?.delete(handler);
			return this;
		}

		once(type: string, handler: (...args: unknown[]) => void): this {
			const once = (...args: unknown[]) => {
				this.off(type, once);
				handler(...args);
			};
			return this.on(type, once);
		}

		emit(type: string): void {
			for (const handler of [...(this.handlers.get(type) ?? [])]) handler();
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
		['load listener', (): void => void (harness.state.setupFailure = 'on:load'), 0],
		['styledata listener', (): void => void (harness.state.setupFailure = 'on:styledata'), 0],
		[
			'ResizeObserver construction',
			(): void => void (harness.state.observerConstructorFailure = true),
			0,
		],
		[
			'ResizeObserver observation',
			(): void => void (harness.state.observerObserveFailure = true),
			1,
		],
	] as const)(
		'cleans the constructed map and observer after fatal %s setup',
		async (_label, arrange, expectedObservers) => {
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
			expect(harness.state.maps[0]?.remove).toHaveBeenCalledTimes(1);
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

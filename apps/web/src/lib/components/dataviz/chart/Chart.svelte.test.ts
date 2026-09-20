import { createRawSnippet, tick } from 'svelte';
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Chart from './Chart.svelte';
import ChartFrame from './ChartFrame.svelte';
import type { ChartSpec, HeatmapSpec, MagnitudeBarsSpec, StackedShareSpec } from './ChartSpec';

const fluidSpec: StackedShareSpec = {
	kind: 'stacked-share',
	title: 'Vehicle status',
	locale: 'en',
	scale: 'status',
	segments: [{ key: 'on-time', label: 'On time', share: 100, status: 'on_time' }],
};

const denseSpec: MagnitudeBarsSpec = {
	kind: 'magnitude-bars',
	mark: 'bar',
	title: 'Worst stops',
	locale: 'en',
	domain: [0, 100],
	unit: '%',
	rowLabel: 'Stop',
	rows: [],
	sort: 'given',
	scale: 'severity',
};

const heatmapSpec: HeatmapSpec = {
	kind: 'heatmap',
	title: 'Reliability by hour',
	locale: 'en',
	mode: 'absolute',
	domain: [0, 1],
	rowLabels: ['Mo'],
	colLabels: ['08:00'],
	cells: [[{ value: 0.5 }]],
	rowAxisLabel: 'Day',
	colAxisLabel: 'Hour',
};

const resizeObservers: ResizeObserverStub[] = [];
const intersectionObservers: IntersectionObserverStub[] = [];

class ResizeObserverStub {
	readonly targets = new Set<Element>();
	readonly observe = vi.fn((target: Element) => this.targets.add(target));
	readonly unobserve = vi.fn((target: Element) => this.targets.delete(target));
	readonly disconnect = vi.fn(() => this.targets.clear());

	constructor(private readonly callback: ResizeObserverCallback) {
		resizeObservers.push(this);
	}

	trigger(width = 0, height = 0): void {
		this.callback(
			[...this.targets].map(
				(target) =>
					({
						target,
						contentRect: new DOMRectReadOnly(0, 0, width, height),
					}) as ResizeObserverEntry,
			),
			this as unknown as ResizeObserver,
		);
	}
}

function observerFor(target: Element): ResizeObserverStub | undefined {
	return resizeObservers.find((observer) => observer.targets.has(target));
}

class IntersectionObserverStub {
	readonly targets = new Set<Element>();
	readonly root: Element | Document | null;
	readonly rootMargin: string;
	readonly thresholds: readonly number[];
	readonly observe = vi.fn((target: Element) => this.targets.add(target));
	readonly unobserve = vi.fn((target: Element) => this.targets.delete(target));
	readonly disconnect = vi.fn(() => this.targets.clear());
	readonly takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

	constructor(
		private readonly callback: IntersectionObserverCallback,
		options: IntersectionObserverInit = {},
	) {
		this.root = options.root ?? null;
		this.rootMargin = options.rootMargin ?? '0px';
		this.thresholds = Array.isArray(options.threshold)
			? options.threshold
			: [options.threshold ?? 0];
		intersectionObservers.push(this);
	}

	trigger(target: Element, isIntersecting: boolean): void {
		this.callback(
			[{ target, isIntersecting } as unknown as IntersectionObserverEntry],
			this as unknown as IntersectionObserver,
		);
	}
}

function intersectionObserverFor(target: Element): IntersectionObserverStub | undefined {
	return intersectionObservers.find((observer) => observer.targets.has(target));
}

function renderChart(spec: ChartSpec) {
	return render(Chart, { props: { spec } });
}

describe('Chart shared viewport', () => {
	beforeEach(() => {
		resizeObservers.length = 0;
		intersectionObservers.length = 0;
		vi.stubGlobal('ResizeObserver', ResizeObserverStub);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it.each([
		['fluid', fluidSpec],
		['dense', denseSpec],
		['self-managed', heatmapSpec],
	] as const)('wires the %s family through the shared chart viewport', (layout, spec) => {
		const { container } = renderChart(spec);
		const output = container.querySelector('[data-slot="chart-output"]');
		const viewport = container.querySelector('[data-slot="chart-viewport"]');

		expect(output).toHaveAttribute('data-card-interactive');
		expect(output).toHaveAttribute('data-chart-layout', layout);
		expect(viewport).not.toBeNull();
		if (layout === 'dense') {
			const canvas = container.querySelector<HTMLElement>('[data-slot="chart-canvas"]');
			expect(canvas?.style.getPropertyValue('--chart-mobile-min-width')).toBe('48rem');
		}
	});

	it('adds focus, a label, and an edge cue only while a dense viewport really overflows', async () => {
		const { container } = renderChart(denseSpec);
		const output = container.querySelector('[data-slot="chart-output"]');
		const viewport = container.querySelector<HTMLElement>('[data-slot="chart-viewport"]');

		expect(viewport).not.toBeNull();
		viewport!.style.overflowX = 'auto';
		let clientWidth = 320;
		let scrollWidth = 768;
		Object.defineProperties(viewport!, {
			clientWidth: { configurable: true, get: () => clientWidth },
			scrollWidth: { configurable: true, get: () => scrollWidth },
			scrollLeft: { configurable: true, get: () => 0 },
		});

		const observer = observerFor(viewport!);
		expect(observer).toBeDefined();
		observer?.trigger();
		await tick();
		expect(viewport).toHaveAttribute('role', 'region');
		expect(viewport).toHaveAttribute('aria-label', denseSpec.title);
		expect(viewport).toHaveAttribute('tabindex', '0');
		expect(output).toHaveAttribute('data-more-end', 'true');

		clientWidth = 768;
		scrollWidth = 768;
		observer?.trigger();
		await tick();
		expect(viewport).not.toHaveAttribute('role');
		expect(viewport).not.toHaveAttribute('aria-label');
		expect(viewport).not.toHaveAttribute('tabindex');
		expect(output).toHaveAttribute('data-more-end', 'false');
	});

	it('keeps a sized mark unmounted until its frame approaches the viewport, then latches it', async () => {
		vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(768);
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
		const { container } = renderChart(fluidSpec);
		const frame = container.querySelector<HTMLElement>('[data-slot="chart-frame"]');
		const table = container.querySelector<HTMLTableElement>('table.sr-only');
		observerFor(frame!)?.trigger(768, 120);
		await tick();

		expect(frame).not.toBeNull();
		expect(frame?.style.height).toBe('0.875rem');
		expect(table).not.toBeNull();
		expect(frame?.contains(table)).toBe(false);
		expect(frame?.querySelector('.lc-tooltip-context')).toBeNull();

		const observer = intersectionObserverFor(frame!);
		expect(observer).toBeDefined();
		expect(observer?.rootMargin).toBe('200px 0px');
		expect(observer?.thresholds).toEqual([0]);

		observer?.trigger(frame!, true);
		await vi.waitFor(() => {
			expect(frame?.querySelector('.lc-tooltip-context')).not.toBeNull();
		});
		const mountedMark = frame?.querySelector('.lc-tooltip-context');

		observer?.trigger(frame!, false);
		await tick();
		expect(frame?.querySelector('.lc-tooltip-context')).toBe(mountedMark);
	});

	it.each([true, false])(
		'ignores an inner terminal scroll box with page viewport present: %s',
		async (insideMain) => {
			vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
			const main = document.createElement('main');
			main.id = 'main';
			main.style.overflowY = 'auto';
			const terminal = document.createElement('div');
			terminal.style.overflowY = 'auto';
			document.body.append(main);
			(insideMain ? main : document.body).append(terminal);
			const view = render(Chart, { target: terminal, props: { spec: fluidSpec } });
			try {
				await tick();
				const frame = terminal.querySelector<HTMLElement>('[data-slot="chart-frame"]')!;
				expect(frame).not.toBeNull();
				const intersection = intersectionObserverFor(frame)!;
				expect(intersection.root).toBe(insideMain ? main : null);
				expect(intersection.rootMargin).toBe('200px 0px');
				observerFor(frame)?.trigger(210, 44);
				intersection.trigger(frame, false);
				await tick();
				expect(terminal.querySelector('table.sr-only')).not.toBeNull();
				expect(frame.querySelector('.lc-tooltip-context')).toBeNull();
				intersection.trigger(frame, true);
				await vi.waitFor(() => expect(frame.querySelector('.lc-tooltip-context')).not.toBeNull());
				const mounted = frame.querySelector('.lc-tooltip-context');
				intersection.trigger(frame, false);
				await tick();
				expect(frame.querySelector('.lc-tooltip-context')).toBe(mounted);
			} finally {
				view.unmount();
				terminal.remove();
				main.remove();
			}
		},
	);

	it('waits for a hidden zero-size frame to recover after entering the viewport', async () => {
		vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(768);
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
		const { container } = renderChart(fluidSpec);
		const frame = container.querySelector<HTMLElement>('[data-slot="chart-frame"]');
		const resizeObserver = observerFor(frame!);
		const intersectionObserver = intersectionObserverFor(frame!);

		resizeObserver?.trigger(0, 0);
		intersectionObserver?.trigger(frame!, true);
		await tick();
		expect(frame?.querySelector('.lc-tooltip-context')).toBeNull();

		resizeObserver?.trigger(768, 120);
		await vi.waitFor(() => {
			expect(frame?.querySelector('.lc-tooltip-context')).not.toBeNull();
		});
	});

	it('renders after the size observation when IntersectionObserver is unavailable', async () => {
		vi.stubGlobal('IntersectionObserver', undefined);
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(768);
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
		const { container } = renderChart(fluidSpec);
		const frame = container.querySelector<HTMLElement>('[data-slot="chart-frame"]');
		expect(frame?.querySelector('.lc-tooltip-context')).toBeNull();
		observerFor(frame!)?.trigger(768, 120);

		await vi.waitFor(() => {
			expect(frame?.querySelector('.lc-tooltip-context')).not.toBeNull();
		});
	});

	it('mounts and recovers from observed boxes without synchronous frame geometry reads', async () => {
		vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
		for (const property of ['clientWidth', 'clientHeight'] as const) {
			const nativeGetter =
				Object.getOwnPropertyDescriptor(HTMLElement.prototype, property)?.get ??
				Object.getOwnPropertyDescriptor(Element.prototype, property)?.get;
			expect(nativeGetter).toBeDefined();
			vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(function (
				this: HTMLElement,
			) {
				if (this.matches('[data-slot="chart-frame"]')) {
					throw new Error(`Synchronous ChartFrame ${property} read`);
				}
				return nativeGetter!.call(this);
			});
		}
		const { container } = render(ChartFrame, {
			props: {
				children: createRawSnippet(() => ({
					render: () => '<span data-testid="mark">Mark</span>',
				})),
			},
		});
		const frame = container.querySelector<HTMLElement>('[data-slot="chart-frame"]')!;
		const resizeObserver = observerFor(frame)!;
		intersectionObserverFor(frame)!.trigger(frame, true);

		for (const [width, height, mounted] of [
			[0, 0, false],
			[768, 120, true],
			[0, 0, false],
			[640, 90, true],
		] as const) {
			resizeObserver.trigger(width, height);
			await tick();
			expect(frame.querySelector('[data-testid="mark"]') !== null).toBe(mounted);
		}
	});

	it('disconnects both frame observers when an unentered chart unmounts', () => {
		vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
		const rendered = renderChart(fluidSpec);
		const frame = rendered.container.querySelector<HTMLElement>('[data-slot="chart-frame"]');
		const resizeObserver = observerFor(frame!);
		const intersectionObserver = intersectionObserverFor(frame!);

		rendered.unmount();
		expect(resizeObserver?.disconnect).toHaveBeenCalledOnce();
		expect(intersectionObserver?.disconnect).toHaveBeenCalledOnce();
	});
});

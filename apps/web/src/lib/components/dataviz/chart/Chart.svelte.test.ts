import { tick } from 'svelte';
import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Chart from './Chart.svelte';
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

	trigger(): void {
		this.callback([], this as unknown as ResizeObserver);
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

	it('waits for a hidden zero-size frame to recover after entering the viewport', async () => {
		vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
		let width = 0;
		let height = 0;
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
		const { container } = renderChart(fluidSpec);
		const frame = container.querySelector<HTMLElement>('[data-slot="chart-frame"]');
		const resizeObserver = observerFor(frame!);
		const intersectionObserver = intersectionObserverFor(frame!);

		intersectionObserver?.trigger(frame!, true);
		await tick();
		expect(frame?.querySelector('.lc-tooltip-context')).toBeNull();

		width = 768;
		height = 120;
		resizeObserver?.trigger();
		await vi.waitFor(() => {
			expect(frame?.querySelector('.lc-tooltip-context')).not.toBeNull();
		});
	});

	it('renders eagerly when IntersectionObserver is unavailable', async () => {
		vi.stubGlobal('IntersectionObserver', undefined);
		vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(768);
		vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
		const { container } = renderChart(fluidSpec);
		const frame = container.querySelector<HTMLElement>('[data-slot="chart-frame"]');

		await vi.waitFor(() => {
			expect(frame?.querySelector('.lc-tooltip-context')).not.toBeNull();
		});
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

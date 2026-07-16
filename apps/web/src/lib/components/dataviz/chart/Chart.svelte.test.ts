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

class ResizeObserverStub {
	readonly targets = new Set<Element>();
	readonly observe = vi.fn((target: Element) => this.targets.add(target));
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

function renderChart(spec: ChartSpec) {
	return render(Chart, { props: { spec } });
}

describe('Chart shared viewport', () => {
	beforeEach(() => {
		resizeObservers.length = 0;
		vi.stubGlobal('ResizeObserver', ResizeObserverStub);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
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
});

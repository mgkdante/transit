import { render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ManifestoCanvas from './ManifestoCanvas.svelte';

const ticker = vi.hoisted(() => ({
	subscribe: vi.fn(),
	unsubscribe: vi.fn(),
}));
const motion = vi.hoisted(() => ({ reduced: false }));

vi.mock('$lib/motion', () => ({ isPrefersReducedMotion: () => motion.reduced }));
vi.mock('$lib/motion/utils/ticker', () => ticker);

class IntersectionObserverStub {
	observe = vi.fn();
	disconnect = vi.fn();
	unobserve = vi.fn();
	takeRecords = vi.fn(() => []);
	root = null;
	rootMargin = '0px';
	thresholds = [0];
	constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
}

const resizeObservers: ResizeObserverStub[] = [];
class ResizeObserverStub {
	observe = vi.fn();
	disconnect = vi.fn();
	unobserve = vi.fn();
	constructor(private readonly callback: ResizeObserverCallback) {
		resizeObservers.push(this);
	}
	trigger(): void {
		this.callback([], this as unknown as ResizeObserver);
	}
}

const context = {
	clearRect: vi.fn(),
	beginPath: vi.fn(),
	arc: vi.fn(),
	fill: vi.fn(),
	moveTo: vi.fn(),
	lineTo: vi.fn(),
	stroke: vi.fn(),
	fillStyle: '',
	strokeStyle: '',
	lineWidth: 1,
} as unknown as CanvasRenderingContext2D;

function host(): HTMLDivElement {
	const node = document.createElement('div');
	node.getBoundingClientRect = () =>
		({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 320,
			bottom: 240,
			width: 320,
			height: 240,
			toJSON: () => ({}),
		}) as DOMRect;
	document.body.appendChild(node);
	return node;
}

describe('ManifestoCanvas — overlapping route instances', () => {
	beforeEach(() => {
		motion.reduced = false;
		ticker.subscribe.mockReset();
		ticker.unsubscribe.mockReset();
		resizeObservers.length = 0;
		vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
		vi.stubGlobal('ResizeObserver', ResizeObserverStub);
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		document.body.replaceChildren();
	});

	it('gives simultaneous canvases distinct ticker ids so old cleanup cannot remove the new callback', async () => {
		const first = render(ManifestoCanvas, { props: { containerEl: host() } });
		const second = render(ManifestoCanvas, { props: { containerEl: host() } });

		expect(ticker.subscribe).toHaveBeenCalledTimes(2);
		const firstId = ticker.subscribe.mock.calls[0][0] as string;
		const secondId = ticker.subscribe.mock.calls[1][0] as string;
		expect(firstId).not.toBe(secondId);

		await first.unmount();
		expect(ticker.unsubscribe).toHaveBeenCalledWith(firstId);
		expect(ticker.unsubscribe).not.toHaveBeenCalledWith(secondId);

		await second.unmount();
		expect(ticker.unsubscribe).toHaveBeenCalledWith(secondId);
	});

	it('resizes the animated bitmap when async header content changes its host geometry', async () => {
		const containerEl = host();
		const view = render(ManifestoCanvas, { props: { containerEl } });
		const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
		expect(canvas.width).toBe(320);
		expect(canvas.height).toBe(240);
		expect(resizeObservers).toHaveLength(1);

		containerEl.getBoundingClientRect = () =>
			({ width: 480, height: 360, left: 0, top: 0 }) as DOMRect;
		resizeObservers[0].trigger();
		expect(canvas.width).toBe(480);
		expect(canvas.height).toBe(360);

		await view.unmount();
		expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
	});

	it('keeps the static reduced-motion bitmap responsive without subscribing to the ticker', async () => {
		motion.reduced = true;
		const containerEl = host();
		const view = render(ManifestoCanvas, { props: { containerEl } });
		const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
		expect(resizeObservers).toHaveLength(1);
		expect(ticker.subscribe).not.toHaveBeenCalled();

		containerEl.getBoundingClientRect = () =>
			({ width: 390, height: 420, left: 0, top: 0 }) as DOMRect;
		resizeObservers[0].trigger();
		expect(canvas.width).toBe(390);
		expect(canvas.height).toBe(420);

		await view.unmount();
		expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
	});
});

import { tick, createRawSnippet } from 'svelte';
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import ScrollFrame from './ScrollFrame.svelte';

const snip = (html: string) => createRawSnippet(() => ({ render: () => html }));

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

describe('ScrollFrame', () => {
	beforeEach(() => {
		resizeObservers.length = 0;
		vi.stubGlobal('ResizeObserver', ResizeObserverStub);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders the frozen gutter without a fake keyboard affordance when it does not overflow', () => {
		const { container } = render(ScrollFrame, {
			props: {
				scrollLabel: 'Scroll to see all hours',
				gutter: snip('<div data-testid="g">axis</div>'),
				scroller: snip('<div data-testid="s">plot</div>'),
			},
		});
		expect(container.querySelector('[data-slot="scroll-frame"]')).not.toBeNull();
		const gutter = container.querySelector('[data-slot="scroll-frame-gutter"]');
		const scroller = container.querySelector('[data-slot="scroll-frame-scroller"]');
		expect(gutter?.querySelector('[data-testid="g"]')).not.toBeNull();
		expect(scroller?.querySelector('[data-testid="s"]')).not.toBeNull();
		// the gutter is a decorative pin of the row axis (the data lives in the plot + sr-table).
		expect(gutter?.getAttribute('aria-hidden')).toBe('true');
		expect(scroller).not.toHaveAttribute('role');
		expect(scroller).not.toHaveAttribute('tabindex');
		expect(scroller).not.toHaveAttribute('aria-label');
		expect(container.querySelector('[data-slot="scroll-frame"]')).toHaveAttribute(
			'data-card-interactive',
		);
	});

	it('becomes a labelled keyboard region only for real horizontal overflow', async () => {
		const { container } = render(ScrollFrame, {
			props: {
				scrollLabel: 'Scroll to see all hours',
				gutter: snip('<i>g</i>'),
				scroller: snip('<i>s</i>'),
			},
		});
		const frame = container.querySelector('[data-slot="scroll-frame"]');
		const scroller = container.querySelector<HTMLElement>('[data-slot="scroll-frame-scroller"]');
		let scrollLeft = 0;
		let clientWidth = 300;
		let scrollWidth = 600;
		Object.defineProperties(scroller!, {
			clientWidth: { configurable: true, get: () => clientWidth },
			scrollWidth: { configurable: true, get: () => scrollWidth },
			scrollLeft: {
				configurable: true,
				get: () => scrollLeft,
				set: (value: number) => {
					scrollLeft = value;
				},
			},
		});

		const observer = observerFor(scroller!);
		expect(observer).toBeDefined();
		observer?.trigger();
		await tick();
		expect(scroller).toHaveAttribute('role', 'region');
		expect(scroller).toHaveAttribute('tabindex', '0');
		expect(scroller).toHaveAttribute('aria-label', 'Scroll to see all hours');
		expect(frame).toHaveAttribute('data-more-end', 'true');

		scrollLeft = 300;
		await fireEvent.scroll(scroller!);
		expect(frame).toHaveAttribute('data-more-end', 'false');

		clientWidth = 600;
		scrollWidth = 600;
		observer?.trigger();
		await tick();
		expect(scroller).not.toHaveAttribute('role');
		expect(scroller).not.toHaveAttribute('tabindex');
		expect(scroller).not.toHaveAttribute('aria-label');
		expect(frame).toHaveAttribute('data-more-start', 'false');
		expect(frame).toHaveAttribute('data-more-end', 'false');
	});

	it('shows NO edge shadows when the content does not overflow (no fake affordance)', () => {
		// jsdom has no layout → scrollWidth == clientWidth == 0 → no overflow → both shadows off.
		const { container } = render(ScrollFrame, {
			props: {
				scrollLabel: 'Chart data',
				gutter: snip('<i>g</i>'),
				scroller: snip('<i>s</i>'),
			},
		});
		const frame = container.querySelector('[data-slot="scroll-frame"]');
		expect(frame?.getAttribute('data-more-start')).toBe('false');
		expect(frame?.getAttribute('data-more-end')).toBe('false');
	});

	it('applies the configurable gutter width as a CSS var', () => {
		const { container } = render(ScrollFrame, {
			props: {
				gutterWidth: '4rem',
				scrollLabel: 'Chart data',
				gutter: snip('<i>g</i>'),
				scroller: snip('<i>s</i>'),
			},
		});
		const frame = container.querySelector<HTMLElement>('[data-slot="scroll-frame"]');
		expect(frame?.style.getPropertyValue('--sf-gutter')).toBe('4rem');
	});
});

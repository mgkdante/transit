import { describe, it, expect } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from '@testing-library/svelte';
import ScrollFrame from './ScrollFrame.svelte';

const snip = (html: string) => createRawSnippet(() => ({ render: () => html }));

describe('ScrollFrame', () => {
	it('renders the frozen gutter + the scrollable region with the a11y contract', () => {
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
		// the scroll region is a keyboard-operable, labelled group (WCAG 2.1.1).
		expect(scroller?.getAttribute('role')).toBe('group');
		expect(scroller?.getAttribute('tabindex')).toBe('0');
		expect(scroller?.getAttribute('aria-label')).toBe('Scroll to see all hours');
	});

	it('shows NO edge shadows when the content does not overflow (no fake affordance)', () => {
		// jsdom has no layout → scrollWidth == clientWidth == 0 → no overflow → both shadows off.
		const { container } = render(ScrollFrame, {
			props: { gutter: snip('<i>g</i>'), scroller: snip('<i>s</i>') },
		});
		const frame = container.querySelector('[data-slot="scroll-frame"]');
		expect(frame?.getAttribute('data-more-start')).toBe('false');
		expect(frame?.getAttribute('data-more-end')).toBe('false');
	});

	it('applies the configurable gutter width as a CSS var', () => {
		const { container } = render(ScrollFrame, {
			props: { gutterWidth: '4rem', gutter: snip('<i>g</i>'), scroller: snip('<i>s</i>') },
		});
		const frame = container.querySelector<HTMLElement>('[data-slot="scroll-frame"]');
		expect(frame?.style.getPropertyValue('--sf-gutter')).toBe('4rem');
	});
});

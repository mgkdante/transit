import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import IconArray from './IconArray.svelte';

const fig = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="icon-array"]')!;

// delivered ≠ cancelled ≠ silent — three DISTINCT states, each its own glyph.
const segs = [
	{ count: 47, colorVar: 'var(--dataviz-status-on-time)', glyph: '●', label: 'delivered' },
	{ count: 3, colorVar: 'var(--dataviz-severity-critical)', glyph: '✕', label: 'cancelled' },
	{ count: 2, colorVar: 'var(--dataviz-status-unknown)', glyph: '◌', label: 'silent' },
];

describe('IconArray — waffle of discrete outcomes', () => {
	it('renders one cell per event, each with its category glyph (colour never sole channel)', () => {
		const { container } = render(IconArray, { props: { segments: segs } });
		const f = fig(container);
		expect(f.querySelectorAll('.dv-icon-array-cell').length).toBe(52);
		const text = f.textContent ?? '';
		expect(text).toContain('●');
		expect(text).toContain('✕');
		expect(text).toContain('◌');
	});

	it('the aria summary names each count — silent is distinct from cancelled', () => {
		const { container } = render(IconArray, { props: { segments: segs } });
		expect(fig(container).getAttribute('aria-label')).toBe('47 delivered, 3 cancelled, 2 silent');
	});

	it('honours a caller-supplied summary', () => {
		const { container } = render(IconArray, {
			props: { segments: segs, label: '47 of 52 trips ran' },
		});
		expect(fig(container).getAttribute('aria-label')).toBe('47 of 52 trips ran');
	});
});

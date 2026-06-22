import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DivergingBar from './DivergingBar.svelte';

const fig = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="diverging-bar"]')!;

describe('DivergingBar — signed bar from a zero center', () => {
	it('a positive value grows right: ▲, "more" colour, value in aria', () => {
		const { container } = render(DivergingBar, {
			props: { value: 1.8, display: '+1.8 min', label: 'vs normal' },
		});
		const f = fig(container);
		expect(f.querySelector('rect')?.getAttribute('fill')).toBe('var(--dataviz-status-late)');
		expect(f.querySelector('svg')?.getAttribute('aria-label')).toContain('+1.8 min');
		expect(f.querySelector('.dv-diverging-glyph')?.textContent).toContain('▲');
	});

	it('a negative value grows left: ▼, "better" colour', () => {
		const { container } = render(DivergingBar, { props: { value: -2 } });
		const f = fig(container);
		expect(f.querySelector('rect')?.getAttribute('fill')).toBe('var(--dataviz-status-on-time)');
		expect(f.querySelector('.dv-diverging-glyph')?.textContent).toContain('▼');
	});

	it('null is honest: no value bar, neutral ·, "no data" aria', () => {
		const { container } = render(DivergingBar, { props: { value: null, label: 'vs normal' } });
		const f = fig(container);
		expect(f.querySelectorAll('rect').length).toBe(0); // only the zero <line>
		expect(f.querySelector('svg')?.getAttribute('aria-label')).toContain('no data');
		expect(f.querySelector('.dv-diverging-glyph')?.textContent).toContain('·');
	});
});

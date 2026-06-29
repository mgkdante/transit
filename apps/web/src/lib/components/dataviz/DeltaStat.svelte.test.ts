import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DeltaStat from './DeltaStat.svelte';

const el = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-slot="delta-stat"]')!;

describe('DeltaStat — the delta doctrine (glyph + dataviz colour + aria)', () => {
	it('a regression (default higherIsBetter=false) is ▲ on the severity-critical token', () => {
		const { container } = render(DeltaStat, { props: { delta: 2.1 } });
		const s = el(container);
		expect(s.getAttribute('aria-label')).toBe('change +2.1');
		expect(s.textContent).toContain('▲');
		expect(s.getAttribute('style')).toContain('var(--dataviz-severity-critical)');
	});

	it('an improvement is ▼ on the on-time token', () => {
		const { container } = render(DeltaStat, { props: { delta: -1.5 } });
		const s = el(container);
		expect(s.textContent).toContain('▼');
		expect(s.getAttribute('style')).toContain('var(--dataviz-status-on-time)');
	});

	it('higherIsBetter flips the verdict (a rise is good)', () => {
		const { container } = render(DeltaStat, { props: { delta: 3, higherIsBetter: true } });
		expect(el(container).getAttribute('style')).toContain('var(--dataviz-status-on-time)');
	});

	it('a null delta is honest no-data: neutral · + "no change data", no fabricated number', () => {
		const { container } = render(DeltaStat, { props: { delta: null } });
		const s = el(container);
		expect(s.getAttribute('aria-label')).toBe('no change data');
		expect(s.textContent).toContain('·');
		expect(s.getAttribute('style')).toContain('var(--dataviz-status-unknown)');
		expect(s.textContent).not.toMatch(/\d/);
	});

	it('a null delta WITH context folds the localized reason into the aria (not "no change data")', () => {
		// the honest-state distinction (within-noise vs no-prior) must reach assistive tech, never
		// the bare "no change data" which misreads a measured-but-insignificant change as absent.
		const { container } = render(DeltaStat, {
			props: { delta: null, context: 'within noise', ariaNoun: 'AM peak on-time' },
		});
		const s = el(container);
		expect(s.getAttribute('aria-label')).toBe('AM peak on-time within noise');
		expect(s.getAttribute('aria-label')).not.toContain('no change data');
		expect(s.textContent).toContain('·');
	});

	it('uses the formatted display + trailing context (in text and aria)', () => {
		const { container } = render(DeltaStat, {
			props: { delta: 2, display: '+2.0 pts', context: 'vs 7d' },
		});
		const s = el(container);
		expect(s.textContent).toContain('+2.0 pts');
		expect(s.textContent).toContain('vs 7d');
		expect(s.getAttribute('aria-label')).toContain('vs 7d');
	});
});

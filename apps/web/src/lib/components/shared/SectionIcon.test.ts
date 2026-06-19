// SectionIcon.test.ts - the shared section/TOC icon registry, DOM gate.
//
// SectionIcon is a name -> single inline SVG lookup. Gates:
//   - each name renders its matching testid'd SVG (shape registry stays stable);
//   - the icon is decorative (aria-hidden) so the card/TOC carries the label;
//   - the class prop reaches the <svg> (consumers size + colour it).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SectionIcon, { type SectionIconName } from './SectionIcon.svelte';

const NAMES: SectionIconName[] = [
	'toc',
	'image',
	'eye',
	'layers',
	'chart',
	'grid',
	'list',
	'arrow',
	'briefcase',
	'github',
];

describe('SectionIcon', () => {
	it('renders the matching SVG for every registered name', () => {
		for (const name of NAMES) {
			const { container } = render(SectionIcon, { props: { name } });
			const svg = container.querySelector(`[data-testid="section-${name}-icon"]`);
			expect(svg, name).toBeTruthy();
			expect(svg?.tagName.toLowerCase()).toBe('svg');
		}
	});

	it('is decorative (aria-hidden) so the label lives on the card/TOC', () => {
		const { container } = render(SectionIcon, { props: { name: 'toc' } });
		expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('forwards the class prop to the svg', () => {
		const { container } = render(SectionIcon, {
			props: { name: 'chart', class: 'h-6 w-6 text-primary custom-mark' },
		});
		expect(container.querySelector('svg')?.getAttribute('class')).toContain('custom-mark');
	});
});

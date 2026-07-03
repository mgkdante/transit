// SectionHeading.test.ts — the canonical section/page title renderer (§C2.7).
//
// The LAW: SectionHeading ALWAYS renders a real <hN> (kills the flat-outline
// defect), supports a numbered chip (D4) + an (i) explainer slot, and stays a
// drop-in for BOTH the existing DISPLAY-title callers AND the old SectionLabel
// section-title span (OVERLINE mode).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import SectionHeading from './SectionHeading.svelte';

const wrap = (c: HTMLElement) => c.querySelector('[data-slot="section-heading"]') as HTMLElement;

// A trivial explainer snippet standing in for a MetricInfo (i) affordance.
const explainer = createRawSnippet(() => ({
	render: () => `<button data-testid="info">i</button>`,
}));

describe('SectionHeading — renders a REAL heading element', () => {
	it('defaults to an <h2> for sections', () => {
		const { container } = render(SectionHeading, { props: { heading: 'Reliability' } });
		const h = container.querySelector('h2');
		expect(h).not.toBeNull();
		expect(h?.textContent).toContain('Reliability');
	});

	it('renders the requested level (h1 page title, h3 subsection)', () => {
		const one = render(SectionHeading, { props: { heading: '161', level: 1 } });
		expect(one.container.querySelector('h1')).not.toBeNull();
		const three = render(SectionHeading, { props: { overline: 'WHEN TO RIDE', level: 3 } });
		expect(three.container.querySelector('h3')).not.toBeNull();
	});
});

describe('SectionHeading — DISPLAY mode (existing callers, unchanged)', () => {
	it('shows the display heading with the brand dot by default', () => {
		const { container } = render(SectionHeading, { props: { heading: 'Network' } });
		expect(wrap(container)).toHaveAttribute('data-mode', 'display');
		expect(container.querySelector('[data-slot="section-heading-dot"]')).not.toBeNull();
	});

	it('omits the dot when dot={false}', () => {
		const { container } = render(SectionHeading, { props: { heading: 'Network', dot: false } });
		expect(container.querySelector('[data-slot="section-heading-dot"]')).toBeNull();
	});

	it('renders the mono subheading below the display title', () => {
		const { container } = render(SectionHeading, {
			props: { heading: 'What', subheading: '// MEASURE' },
		});
		const sub = container.querySelector('[data-slot="section-heading-sub"]');
		expect(sub?.textContent).toBe('// MEASURE');
	});
});

describe('SectionHeading — OVERLINE mode (SectionLabel drop-in)', () => {
	it('renders the overline text inside a real heading in the station look', () => {
		const { container } = render(SectionHeading, { props: { overline: 'SOURCES', level: 2 } });
		expect(wrap(container)).toHaveAttribute('data-mode', 'overline');
		const h2 = container.querySelector('h2.section-heading-overline');
		expect(h2).not.toBeNull();
		expect(h2?.textContent).toContain('SOURCES');
	});

	it('carries NO brand dot in overline mode (it is a label, not a display title)', () => {
		const { container } = render(SectionHeading, { props: { overline: 'SOURCES' } });
		expect(container.querySelector('[data-slot="section-heading-dot"]')).toBeNull();
	});

	it('is a drop-in for `<SectionLabel id=… text=… />`: the id lands on the wrapper an aria-labelledby points to', () => {
		// Precedent: <section aria-labelledby="health-sources"> +
		//            <SectionLabel id="health-sources" text="SOURCES" />.
		const { container } = render(SectionHeading, {
			props: { overline: 'SOURCES', id: 'health-sources' },
		});
		const target = container.querySelector('#health-sources');
		expect(target).not.toBeNull();
		// The referenced element's text content is the section's accessible name.
		expect(target?.textContent).toContain('SOURCES');
	});
});

describe('SectionHeading — numbered chip (D4)', () => {
	it('renders a leading NumberedChip when `number` is set', () => {
		const { container } = render(SectionHeading, {
			props: { heading: 'Punctuality', number: 3 },
		});
		const chip = container.querySelector('[data-slot="numbered-chip"]');
		expect(chip?.textContent).toBe('03');
		// The chip is INSIDE the heading element (part of the outline label).
		expect(container.querySelector('h2')?.contains(chip as Node)).toBe(true);
	});

	it('passes the active tone through to the chip', () => {
		const { container } = render(SectionHeading, {
			props: { overline: 'PUNCTUALITY', number: 1, numberTone: 'active' },
		});
		expect(container.querySelector('[data-slot="numbered-chip"]')).toHaveAttribute(
			'data-tone',
			'active',
		);
	});

	it('renders no chip when `number` is absent', () => {
		const { container } = render(SectionHeading, { props: { heading: 'Punctuality' } });
		expect(container.querySelector('[data-slot="numbered-chip"]')).toBeNull();
	});
});

describe('SectionHeading — explainer slot (the optional (i))', () => {
	it('renders the explainer snippet inline inside the heading', () => {
		const { container, getByTestId } = render(SectionHeading, {
			props: { overline: 'CROWDING', explainer },
		});
		const info = getByTestId('info');
		expect(info).toBeInTheDocument();
		expect(container.querySelector('h2')?.contains(info)).toBe(true);
	});

	it('renders no explainer wrapper when the snippet is absent', () => {
		const { container } = render(SectionHeading, { props: { overline: 'CROWDING' } });
		expect(container.querySelector('.section-heading-explainer')).toBeNull();
	});
});

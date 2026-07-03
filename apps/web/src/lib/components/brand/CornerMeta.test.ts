// CornerMeta.test.ts — the four-corner hero readout (§C2.4), DOM gate.
//
// CornerMeta pins REAL-data readouts to the four corners of a relative host.
// Decorative by contract: aria-hidden + pointer-events:none, hidden < 768px,
// with an opt-in crosshair ornament. This gate locks:
//   - each of the four corner slots renders only when its snippet is passed;
//   - the host is aria-hidden (annotation, never the accessible name);
//   - the crosshair ornament is opt-in (absent by default, present when set).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import CornerMeta from './CornerMeta.svelte';

const root = (c: HTMLElement) => c.querySelector('[data-slot="corner-meta"]') as HTMLElement;
const textSnippet = (text: string) =>
	createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('CornerMeta — four corner slots', () => {
	it('renders all four corners when every slot is provided', () => {
		const { container, getByText } = render(CornerMeta, {
			props: {
				topLeft: textSnippet('STM'),
				topRight: textSnippet('2026-07-03'),
				bottomLeft: textSnippet('212 lines'),
				bottomRight: textSnippet('build 0078'),
			},
		});
		expect(container.querySelector('[data-slot="corner-tl"]')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="corner-tr"]')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="corner-bl"]')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="corner-br"]')).toBeInTheDocument();
		expect(getByText('STM')).toBeInTheDocument();
		expect(getByText('build 0078')).toBeInTheDocument();
	});

	it('renders only the corners whose slots are passed', () => {
		const { container } = render(CornerMeta, {
			props: { topLeft: textSnippet('STM'), bottomRight: textSnippet('build 0078') },
		});
		expect(container.querySelector('[data-slot="corner-tl"]')).toBeInTheDocument();
		expect(container.querySelector('[data-slot="corner-tr"]')).not.toBeInTheDocument();
		expect(container.querySelector('[data-slot="corner-bl"]')).not.toBeInTheDocument();
		expect(container.querySelector('[data-slot="corner-br"]')).toBeInTheDocument();
	});
});

describe('CornerMeta — decorative contract', () => {
	it('marks the host aria-hidden (annotation, never the accessible name)', () => {
		const { container } = render(CornerMeta, { props: { topLeft: textSnippet('STM') } });
		expect(root(container)).toHaveAttribute('aria-hidden', 'true');
	});

	it('is hidden < 768px by construction (display:none base, block at >=768)', () => {
		// jsdom does not evaluate @media, but the base rule is display:none — the
		// element only surfaces inside the >=768 query. Assert the styled root
		// exists and carries the data-slot so the CSS applies.
		const { container } = render(CornerMeta, { props: { topLeft: textSnippet('STM') } });
		expect(root(container)).toBeInTheDocument();
		expect(root(container)).toHaveClass('corner-meta');
	});
});

describe('CornerMeta — corner readouts stay in their quadrant', () => {
	it('renders both bottom corners independently so a long readout stays in its own corner', () => {
		// A long dataset-edition string in one corner must not swallow or displace the
		// opposite corner (the home hero DATASET·… overrunning VEHICLES·… regression;
		// the width-cap + ellipsis containment is CSS, verified geometrically). Lock
		// that each bottom corner is its own contained element carrying its own text.
		const { container, getByText } = render(CornerMeta, {
			props: {
				bottomLeft: textSnippet('DATASET · a-very-long-edition-filename-that-would-overrun'),
				bottomRight: textSnippet('VEHICLES · 804'),
			},
		});
		const bl = container.querySelector('[data-slot="corner-bl"]') as HTMLElement;
		const br = container.querySelector('[data-slot="corner-br"]') as HTMLElement;
		expect(bl).toBeInTheDocument();
		expect(br).toBeInTheDocument();
		expect(bl).not.toContainElement(br);
		expect(getByText('VEHICLES · 804')).toBeInTheDocument();
	});
});

describe('CornerMeta — crosshair ornament (opt-in)', () => {
	it('omits the crosshair by default', () => {
		const { container } = render(CornerMeta, { props: { topLeft: textSnippet('STM') } });
		expect(container.querySelector('[data-slot="corner-marks"]')).not.toBeInTheDocument();
	});

	it('renders the crosshair registration marks when crosshair is set', () => {
		const { container } = render(CornerMeta, {
			props: { topLeft: textSnippet('STM'), crosshair: true },
		});
		expect(container.querySelector('[data-slot="corner-marks"]')).toBeInTheDocument();
	});
});

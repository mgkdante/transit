import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import RailLayout from './RailLayout.svelte';

const railSnippet = createRawSnippet(() => ({
	render: () => `<nav data-testid="rail-content">Rail nav</nav>`,
}));

const contentSnippet = createRawSnippet(() => ({
	render: () => `<article data-testid="main-content">Body</article>`,
}));

describe('RailLayout', () => {
	it('renders both rail and content snippets', () => {
		const { getByTestId } = render(RailLayout, {
			props: { rail: railSnippet, content: contentSnippet },
		});
		expect(getByTestId('rail-content')).toBeTruthy();
		expect(getByTestId('main-content')).toBeTruthy();
	});

	it('places the rail in an <aside> and the content in its own region', () => {
		const { container } = render(RailLayout, {
			props: { rail: railSnippet, content: contentSnippet },
		});
		const rail = container.querySelector('[data-slot="rail-layout-rail"]');
		const content = container.querySelector('[data-slot="rail-layout-content"]');
		expect(rail?.tagName.toLowerCase()).toBe('aside');
		expect(rail?.querySelector('[data-testid="rail-content"]')).toBeTruthy();
		expect(content?.querySelector('[data-testid="main-content"]')).toBeTruthy();
	});

	it('renders the rail before the content in source order (mobile stack order)', () => {
		const { container } = render(RailLayout, {
			props: { rail: railSnippet, content: contentSnippet },
		});
		const grid = container.querySelector('[data-slot="rail-layout"]')!;
		const slots = Array.from(grid.children).map((el) => el.getAttribute('data-slot'));
		expect(slots).toEqual(['rail-layout-rail', 'rail-layout-content']);
	});

	it('names the rail landmark when railLabel is provided', () => {
		const { container } = render(RailLayout, {
			props: { rail: railSnippet, content: contentSnippet, railLabel: 'On this page' },
		});
		expect(
			container.querySelector('[data-slot="rail-layout-rail"]')?.getAttribute('aria-label'),
		).toBe('On this page');
	});

	it('leaves the rail landmark unnamed when no railLabel is given', () => {
		const { container } = render(RailLayout, {
			props: { rail: railSnippet, content: contentSnippet },
		});
		expect(
			container.querySelector('[data-slot="rail-layout-rail"]')?.hasAttribute('aria-label'),
		).toBe(false);
	});

	it('puts the sticky wrapper inside the rail aside (rail tracks scroll, not the column)', () => {
		const { container } = render(RailLayout, {
			props: { rail: railSnippet, content: contentSnippet },
		});
		const aside = container.querySelector('[data-slot="rail-layout-rail"]')!;
		const sticky = aside.querySelector('.rail-layout__rail-sticky');
		expect(sticky).toBeTruthy();
		expect(sticky?.querySelector('[data-testid="rail-content"]')).toBeTruthy();
	});

	it('forwards a custom class onto the grid root', () => {
		const { container } = render(RailLayout, {
			props: { rail: railSnippet, content: contentSnippet, class: 'metrics-body' },
		});
		expect(container.querySelector('[data-slot="rail-layout"]')?.classList).toContain(
			'metrics-body',
		);
	});

	it('parks the sticky rail off the single --chrome-offset knob (no literal)', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/RailLayout.svelte'),
			'utf-8',
		);
		expect(source).toMatch(/\.rail-layout__rail-sticky\s*\{[^}]*top:\s*var\(--chrome-offset\)/);
		expect(source).not.toMatch(/top:\s*5\.5rem/);
	});
});

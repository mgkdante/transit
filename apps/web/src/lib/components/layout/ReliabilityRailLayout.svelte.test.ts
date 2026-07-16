import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ReliabilityRailLayout from './ReliabilityRailLayout.svelte';

const componentPath = resolve(
	process.cwd(),
	'src/lib/components/layout/ReliabilityRailLayout.svelte',
);
const source = () => (existsSync(componentPath) ? readFileSync(componentPath, 'utf-8') : '');
const barrel = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/layout/index.ts'), 'utf-8');
const snippet = (text: string) =>
	createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

describe('ReliabilityRailLayout — shared detail geometry contract', () => {
	it('owns exactly one SurfaceRail and one content region', () => {
		const component = source();

		expect(component.match(/<SurfaceRail\b/g)).toHaveLength(1);
		expect(component).toContain('data-slot="reliability-rail-layout"');
		expect(component).toContain('data-slot="reliability-rail-content"');
	});

	it('uses the shared rail, center, and gap variables at the 1024px transition', () => {
		const component = source();

		expect(component).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
		expect(component).toMatch(/@media\s*\(min-width:\s*1024px\)/);
		expect(component).toMatch(
			/grid-template-columns:\s*var\(\s*--detail-rail-width,\s*var\(--layout-control-rail-width\)\s*\)\s*minmax\(0,\s*var\(--detail-center-max,\s*var\(--container-content\)\)\)/,
		);
		expect(component).toMatch(/gap:\s*var\(--detail-column-gap,\s*2rem\)/);
		expect(component).not.toMatch(/grid-template-columns:[^;]*16rem/);
	});

	it('places the same centered article summary at the top of content while the rail starts level', () => {
		const { container } = render(ReliabilityRailLayout, {
			props: {
				rail: snippet('Rail'),
				content: snippet('Content'),
				articleSummary: snippet('Reliability summary'),
				label: 'Reliability controls',
				openAria: 'Open controls',
				closeAria: 'Close controls',
			},
		});
		const layout = container.querySelector('[data-slot="reliability-rail-layout"]');
		const rail = container.querySelector('[data-slot="surface-rail"]');
		const content = container.querySelector('[data-slot="reliability-rail-content"]');
		const summary = container.querySelector('[data-slot="reliability-rail-summary"]');

		expect(rail?.parentElement).toBe(layout);
		expect(content?.parentElement).toBe(layout);
		expect(summary?.closest('[data-slot="reliability-rail-content"]')).toBe(content);
		expect(content?.firstElementChild).toBe(summary);
		expect(summary).toHaveTextContent('Reliability summary');
		expect(source()).toContain('<ArticleSummaryLane data-slot="reliability-rail-summary">');
	});

	it('is exported from the shared layout barrel', () => {
		expect(barrel()).toContain(
			"export { default as ReliabilityRailLayout } from './ReliabilityRailLayout.svelte';",
		);
	});
});

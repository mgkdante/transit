import { render, screen, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRawSnippet } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BlueprintListingHeader from './BlueprintListingHeader.svelte';

const scrub = vi.hoisted(() => ({ start: vi.fn(), destroy: vi.fn() }));
vi.mock('$lib/motion/scrubs/blueprint-scrub', () => ({
	startBlueprintScrub: scrub.start,
}));

const blueprint = createRawSnippet(() => ({
	render: () => `
		<div class="blueprint-bg" aria-hidden="true">
			<svg data-blueprint-layer="hero"></svg>
			<svg class="edge-detail"></svg>
			<svg class="edge-detail"></svg>
			<svg class="edge-detail"></svg>
			<svg class="edge-detail"></svg>
			<svg class="edge-detail"></svg>
		</div>`,
}));

const inventory = [
	{ label: 'Lines', value: '220' },
	{ label: 'Stops', value: '8,742' },
	{ label: 'Buses', value: null },
	{ label: 'Modes', value: '4' },
];

describe('BlueprintListingHeader', () => {
	beforeEach(() => {
		scrub.start.mockReset();
		scrub.destroy.mockReset();
		scrub.start.mockReturnValue(scrub.destroy);
	});

	it('uses a full-band layered SVG background with one overlaid page title', () => {
		const { container } = render(BlueprintListingHeader, {
			props: {
				heading: 'Lines',
				subtitle: 'LINES · NETWORK',
				blueprint,
			},
		});

		const header = container.querySelector('[data-slot="blueprint-listing-header"]');
		expect(header).not.toBeNull();
		expect(header?.querySelector('.blueprint-bg')).toHaveAttribute('aria-hidden', 'true');
		expect(header?.querySelectorAll('svg')).toHaveLength(6);
		expect(header?.querySelectorAll('.edge-detail')).toHaveLength(5);
		expect(header?.querySelector('picture')).toBeNull();
		expect(header?.querySelector('img')).toBeNull();
		expect(header?.querySelectorAll('h1')).toHaveLength(1);
		expect(screen.getByRole('heading', { level: 1, name: 'Lines' })).toBeInTheDocument();
		expect(screen.getByText('LINES · NETWORK')).toBeInTheDocument();
	});

	it('keeps the source listing-header geometry and hides only the visual desktop duplicate', () => {
		const { container } = render(BlueprintListingHeader, {
			props: { heading: 'Stops', subtitle: 'STOPS · CATALOGUE', blueprint },
		});

		expect(container.querySelector('.listing-blueprint-header')).not.toBeNull();
		expect(container.querySelector('.listing-header-text')).not.toBeNull();
		expect(container.querySelector('.listing-mobile-heading')).not.toBeNull();
		expect(container.querySelector('.listing-header-subtitle')).not.toBeNull();
	});

	it('places a labeled inventory beside the header copy without adding another heading or card', () => {
		const { container } = render(BlueprintListingHeader, {
			props: {
				heading: 'Stops',
				subtitle: 'STOPS · CATALOGUE',
				description: 'Search the complete network catalogue.',
				blueprint,
				statsLabel: 'Network inventory',
				stats: inventory,
			},
		});

		const header = container.querySelector('[data-slot="blueprint-listing-header"]');
		const content = header?.querySelector('[data-slot="blueprint-listing-content"]');
		const stats = content?.querySelector('[data-slot="listing-header-stats"]');

		expect(content).not.toBeNull();
		expect(stats).toHaveAttribute('aria-label', 'Network inventory');
		expect(screen.getByText('Search the complete network catalogue.')).toHaveClass(
			'listing-header-description',
		);
		expect(header?.querySelectorAll('h1')).toHaveLength(1);
		expect(header?.querySelector('[data-slot="card"]')).toBeNull();
	});

	it('uses a content-sized mobile stack and a two-column desktop header grid', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/BlueprintListingHeader.svelte'),
			'utf-8',
		);

		const headerRule = source.match(/\.listing-blueprint-header\s*\{([^}]*)\}/)?.[1] ?? '';
		expect(headerRule).not.toMatch(/(?:^|;)\s*height\s*:/);
		expect(headerRule).toMatch(/min-height\s*:/);
		expect(source).toMatch(/\.listing-header-content\s*\{[^}]*display:\s*grid/);
		expect(source).toMatch(
			/@media\s*\(min-width:\s*1024px\)[\s\S]*?\.listing-header-content\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(/,
		);
	});

	it('mounts the shared blueprint scrub once and cleans it up with the header', async () => {
		const view = render(BlueprintListingHeader, {
			props: { heading: 'Lines', subtitle: 'LINES · NETWORK', blueprint },
		});
		const header = view.container.querySelector('[data-slot="blueprint-listing-header"]');

		await waitFor(() => expect(scrub.start).toHaveBeenCalledOnce());
		expect(scrub.start).toHaveBeenCalledWith(header);
		view.unmount();
		expect(scrub.destroy).toHaveBeenCalledOnce();
	});
});

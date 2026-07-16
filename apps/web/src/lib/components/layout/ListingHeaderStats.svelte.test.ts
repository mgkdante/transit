import { render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ListingHeaderStats from './ListingHeaderStats.svelte';

const stats = [
	{ label: 'Lines', value: '220' },
	{ label: 'Stops', value: '8,742' },
	{ label: 'Buses', value: null },
	{ label: 'Modes', value: '0' },
];

describe('ListingHeaderStats', () => {
	it('renders the inventory as one labeled semantic description list', () => {
		const { container } = render(ListingHeaderStats, {
			props: { label: 'Network inventory', stats },
		});

		const list = container.querySelector('dl[data-slot="listing-header-stats"]');
		expect(list).toHaveAttribute('aria-label', 'Network inventory');
		expect(list?.querySelectorAll('dt')).toHaveLength(4);
		expect(list?.querySelectorAll('dd')).toHaveLength(4);
		expect(list?.querySelectorAll('[data-slot="listing-header-stat"]')).toHaveLength(4);
		expect(container.querySelector('[data-slot="card"]')).toBeNull();
	});

	it('shows an em dash only for unknown values and preserves a real zero', () => {
		const { container } = render(ListingHeaderStats, {
			props: { label: 'Network inventory', stats, unknownLabel: 'Not available' },
		});

		const definitions = Array.from(container.querySelectorAll('dd'));
		expect(definitions[0]).toHaveTextContent('220');
		expect(definitions[1]).toHaveTextContent('8,742');
		expect(definitions[3]).toHaveTextContent('0');
		expect(definitions[2]).toHaveAttribute('data-unknown', 'true');
		expect(definitions[2]?.querySelector('.sr-only')).toHaveTextContent('Not available');
		expect(definitions[2]?.querySelector('[aria-hidden="true"]')).toHaveTextContent('—');
		expect(definitions[3]).not.toHaveAttribute('data-unknown');
	});

	it('uses the codified stat-value type token', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/ListingHeaderStats.svelte'),
			'utf-8',
		);
		expect(source).toContain('font-size: var(--text-stat-value)');
		expect(source).toContain('repeat(auto-fit, minmax(min(8rem, 100%), 1fr))');
		expect(source).toContain('overflow-wrap: anywhere');
	});
});

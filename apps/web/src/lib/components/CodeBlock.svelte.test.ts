import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import CodeBlock from './CodeBlock.svelte';

describe('CodeBlock', () => {
	it('keeps embedded SQL keyboard-scrollable with syntax token spans', () => {
		const code = "SELECT COUNT(*) FROM vehicle_positions WHERE route_id = '55';";
		const { getByRole } = render(CodeBlock, {
			props: { code, ariaLabel: 'Vehicle positions query', embedded: true },
		});

		const region = getByRole('region', { name: 'Vehicle positions query' });
		expect(region).toHaveAttribute('tabindex', '0');
		expect(region.querySelector('.tok--keyword')).toHaveTextContent('SELECT');
		expect(region.querySelector('.tok--function')).toHaveTextContent('COUNT');
		expect(region.querySelector('.tok--string')).toHaveTextContent("'55'");
	});

	it('uses compact monospace typography for the SQL reading region', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/CodeBlock.svelte'),
			'utf-8',
		);
		const preRule = source.match(/\.codeblock__pre\s*\{([\s\S]*?)\}/)?.[1];

		expect(preRule).toMatch(/font-size:\s*var\(--text-mono\)/);
		expect(preRule).toMatch(/line-height:\s*1\.6/);
		expect(preRule).not.toMatch(/var\(--text-detail-body/);
		expect(source).not.toMatch(
			/@media\s*\(min-width:\s*1024px\)\s*\{[\s\S]*?\.codeblock__pre\s*\{/,
		);
	});
});

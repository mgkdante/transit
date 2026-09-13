import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { createServer } from 'vite';
import CodeBlock from './CodeBlock.svelte';

describe('CodeBlock', () => {
	const source = `SELECT '<script>bad()</script><img src=x onerror=bad()>' AS "étiquette";\r\n-- &lt;literal&gt; & "quoted"\n\tCOUNT(*) >= 2`;

	function expectVerbatim(region: Element | null, expected: string): void {
		expect(region).not.toBeNull();
		expect(region?.textContent).toBe(expected);
		expect(region?.querySelector('script, img, iframe, [onerror], [onclick]')).toBeNull();
		expect(region?.querySelector('.tok--keyword')).toHaveTextContent('SELECT');
	}

	it('renders code as verbatim text and safely replaces it when the value changes', async () => {
		const view = render(CodeBlock, { props: { code: source } });
		const region = view.getByRole('region', { name: 'SQL source' });
		expectVerbatim(region, source);
		const replacement = 'SELECT "<&>";\n-- </code><iframe src="javascript:bad()">';
		await view.rerender({ code: replacement });
		expectVerbatim(region, replacement);
		expect(region).toHaveAttribute('tabindex', '0');
	});

	it('includes complete escaped, highlighted SQL in server-rendered output', async () => {
		const server = await createServer({
			configFile: 'vite.config.ts',
			appType: 'custom',
			logLevel: 'silent',
			optimizeDeps: { noDiscovery: true },
			server: { middlewareMode: true },
		});
		try {
			const component = (await server.ssrLoadModule(
				'/src/lib/components/CodeBlock.svelte',
			)) as typeof import('./CodeBlock.svelte');
			const { render: renderSsr } = (await server.ssrLoadModule(
				'svelte/server',
			)) as typeof import('svelte/server');
			const template = document.createElement('template');
			template.innerHTML = renderSsr(component.default, { props: { code: source } }).body;
			expectVerbatim(template.content.querySelector('pre'), source);
		} finally {
			await server.close();
		}
	}, 20_000);

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

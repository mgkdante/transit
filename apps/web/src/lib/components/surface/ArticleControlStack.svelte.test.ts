import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import ArticleControlStackMultiRegionHarness from './__fixtures__/ArticleControlStackMultiRegionHarness.svelte';

const componentPath = resolve(
	process.cwd(),
	'src/lib/components/surface/ArticleControlStack.svelte',
);
const barrelPath = resolve(process.cwd(), 'src/lib/components/surface/index.ts');

const region = (name: string) =>
	createRawSnippet(() => ({
		render: () => `<span data-testid="${name}">${name}</span>`,
	}));

async function renderStack(props: Record<string, unknown>) {
	expect(existsSync(componentPath), 'ArticleControlStack must exist before it can render').toBe(
		true,
	);
	const { default: ArticleControlStack } = await import('./ArticleControlStack.svelte');
	return render(ArticleControlStack, { props });
}

function cssRule(source: string, selector: RegExp): string {
	return source.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, selector.flags))?.[1] ?? '';
}

describe('ArticleControlStack', () => {
	it('ships from the surface barrel as the canonical article control primitive', () => {
		expect(existsSync(componentPath)).toBe(true);
		expect(readFileSync(barrelPath, 'utf-8')).toContain(
			"export { default as ArticleControlStack } from './ArticleControlStack.svelte';",
		);
	});

	it('renders named regions in label, history, primary, secondary, caption order', async () => {
		const { container } = await renderStack({
			label: region('label'),
			history: region('history'),
			primary: region('primary'),
			secondary: region('secondary'),
			caption: region('caption'),
		});
		const stack = container.querySelector('[data-slot="article-control-stack"]');

		expect(Array.from(stack?.children ?? [], (child) => child.getAttribute('data-region'))).toEqual(
			['label', 'history', 'primary', 'secondary', 'caption'],
		);
	});

	it('omits empty optional regions so they cannot create phantom gaps', async () => {
		const { container, getByTestId } = await renderStack({ primary: region('primary') });
		const stack = container.querySelector('[data-slot="article-control-stack"]');

		expect(stack?.children).toHaveLength(1);
		expect(stack?.firstElementChild).toHaveAttribute('data-region', 'primary');
		expect(getByTestId('primary')).toBeInTheDocument();
	});

	it('hides a supplied region whose rendered snippet is empty', () => {
		const source = readFileSync(componentPath, 'utf-8');

		expect(source).toMatch(/\.article-control-stack__region:empty\s*\{[^}]*display:\s*none;/s);
	});

	it('owns the shared vertical geometry and full-width, min-width-zero regions', () => {
		expect(existsSync(componentPath)).toBe(true);
		const source = existsSync(componentPath) ? readFileSync(componentPath, 'utf-8') : '';
		const stackRule = cssRule(source, /\.article-control-stack/);
		const regionRule = cssRule(source, /\.article-control-stack__region/);

		expect(stackRule).toMatch(/display:\s*flex;/);
		expect(stackRule).toMatch(/flex-direction:\s*column;/);
		expect(stackRule).toMatch(/gap:\s*0\.75rem;/);
		expect(stackRule).toMatch(/width:\s*100%;/);
		expect(stackRule).toMatch(/min-width:\s*0;/);
		expect(regionRule).toMatch(/width:\s*100%;/);
		expect(regionRule).toMatch(/min-width:\s*0;/);
	});

	it('stacks multiple direct controls inside every named region with the canonical gap', () => {
		const { container, getByRole } = render(ArticleControlStackMultiRegionHarness);
		const source = readFileSync(componentPath, 'utf-8');
		const regionRule = cssRule(source, /\.article-control-stack__region/);
		const secondary = container.querySelector('[data-region="secondary"]');

		expect(secondary?.children).toHaveLength(2);
		expect(getByRole('button', { name: 'Window' })).toBeInTheDocument();
		expect(getByRole('button', { name: 'Delay channel' })).toBeInTheDocument();
		expect(regionRule).toMatch(/display:\s*(?:grid|flex);/);
		expect(regionRule).toMatch(/gap:\s*0\.75rem;/);
		if (/display:\s*flex;/.test(regionRule)) {
			expect(regionRule).toMatch(/flex-direction:\s*column;/);
		}
	});
});

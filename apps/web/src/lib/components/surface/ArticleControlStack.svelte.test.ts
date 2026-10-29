import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';

const componentPath = resolve(
	process.cwd(),
	'src/lib/components/surface/ArticleControlStack.svelte',
);

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

describe('ArticleControlStack', () => {
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
});

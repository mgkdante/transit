import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ArticleSectionStack from './ArticleSectionStack.svelte';
import ArticleSectionStackHarness from './__fixtures__/ArticleSectionStackHarness.svelte';

const componentPath = resolve(
	process.cwd(),
	'src/lib/components/layout/ArticleSectionStack.svelte',
);
const barrelPath = resolve(process.cwd(), 'src/lib/components/layout/index.ts');

const section = createRawSnippet(() => ({
	render: () =>
		'<div data-slot="card" class="section-card" data-testid="section-card">Section</div>',
}));

function cssRule(source: string, selector: RegExp): string {
	return source.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, selector.flags))?.[1] ?? '';
}

describe('ArticleSectionStack', () => {
	it('ships as a reusable layout primitive through the layout barrel', () => {
		expect(existsSync(componentPath)).toBe(true);
		expect(readFileSync(barrelPath, 'utf-8')).toMatch(
			/export \{ default as ArticleSectionStack \} from '\.\/ArticleSectionStack\.svelte';/,
		);
	});

	it('renders only the supplied section snippet and forwards a custom class', () => {
		const { container, getByTestId } = render(ArticleSectionStack, {
			props: { class: 'route-sections', children: section },
		});
		const stack = container.querySelector('[data-slot="article-section-stack"]');

		expect(stack).toHaveClass('article-section-stack', 'route-sections');
		expect(stack?.children).toHaveLength(1);
		expect(getByTestId('section-card')).toHaveTextContent('Section');
		expect(stack?.querySelector('[data-slot="separator"]')).toBeNull();
	});

	it('owns one shared independent-card spacing rhythm without changing card frames', () => {
		const source = readFileSync(componentPath, 'utf-8');
		const stackRule = cssRule(source, /\.article-section-stack/);

		expect(stackRule).toMatch(/display:\s*flex;/);
		expect(stackRule).toMatch(/flex-direction:\s*column;/);
		expect(stackRule).toMatch(/gap:\s*var\(--space-card-gap\);/);
		expect(stackRule).toMatch(/margin:\s*0;/);
		expect(source).not.toMatch(/border-radius:\s*0/);
		expect(source).not.toMatch(/border-block-start-width:\s*0/);
		expect(source).not.toMatch(/Separator|data-slot=["']separator["']/);
	});

	it('lays out direct cards and generic wrappers without inserting separators', () => {
		const { container, getByTestId } = render(ArticleSectionStackHarness);
		const stack = container.querySelector('[data-slot="article-section-stack"]');

		expect(stack).toHaveClass('fixture-stack');
		expect(stack?.children).toHaveLength(4);
		expect(getByTestId('section-wrapper').firstElementChild).toBe(getByTestId('section-card'));
		expect(getByTestId('anchor-wrapper').firstElementChild).toBe(getByTestId('anchor-card'));
		expect(getByTestId('component-root').firstElementChild).toBe(getByTestId('component-card'));
		expect(stack?.querySelector('[data-slot="separator"]')).toBeNull();
	});

	it('does not reach through wrappers to rewrite card borders or radii', () => {
		const source = readFileSync(componentPath, 'utf-8');

		expect(source).toMatch(/\.article-section-stack\s*>\s*:global\(\*\)\s*\{[^}]*margin:\s*0;/s);
		expect(source).not.toMatch(/\[data-slot='card'\]\.section-card/);
		expect(source).not.toMatch(/:first-child|:last-child|:not\(:first-child\)/);
	});
});

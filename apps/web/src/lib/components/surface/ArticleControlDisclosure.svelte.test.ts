import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import ArticleControlDisclosure from './ArticleControlDisclosure.svelte';

const componentPath = resolve(
	process.cwd(),
	'src/lib/components/surface/ArticleControlDisclosure.svelte',
);
const barrelPath = resolve(process.cwd(), 'src/lib/components/surface/index.ts');

const controls = createRawSnippet(() => ({
	render: () => '<button type="button" data-testid="control-action">Change view</button>',
}));

async function renderDisclosure(open = true) {
	expect(
		existsSync(componentPath),
		'ArticleControlDisclosure must exist before it can render',
	).toBe(true);
	return render(ArticleControlDisclosure, {
		props: { title: 'View', open, children: controls },
	});
}

describe('ArticleControlDisclosure', () => {
	it('ships component and props from the surface barrel', () => {
		expect(existsSync(componentPath)).toBe(true);
		const barrel = readFileSync(barrelPath, 'utf-8');

		expect(barrel).toContain(
			"export { default as ArticleControlDisclosure } from './ArticleControlDisclosure.svelte';",
		);
		expect(barrel).toContain(
			"export type { ArticleControlDisclosureProps } from './ArticleControlDisclosure.svelte';",
		);
	});

	it('is only a thin shared CollapsibleSection adapter and owns the controls-body seam', () => {
		expect(existsSync(componentPath)).toBe(true);
		const source = readFileSync(componentPath, 'utf-8');

		expect(source).toContain("import { CollapsibleSection } from '$lib/components/shared';");
		expect(source).toMatch(/<CollapsibleSection\s+\{title\}\s+bind:open>/);
		expect(source.match(/data-slot=["']controls-body["']/g)).toHaveLength(1);
		expect(source).not.toContain('<style>');
		expect(source).not.toContain('ChevronToggle');
	});

	it('toggles through the inherited disclosure while keeping closed controls mounted and inert', async () => {
		const { container } = await renderDisclosure(false);
		const trigger = screen.getByRole('button', { name: 'View' });
		const controlsBody = container.querySelector('[data-slot="controls-body"]') as HTMLElement;
		const content = controlsBody.closest('.collapsible-content') as HTMLElement;

		expect(screen.getByTestId('control-action')).toBeInTheDocument();
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
		expect(content).toHaveAttribute('data-state', 'closed');
		expect(content).toHaveAttribute('inert');
		expect(content).toHaveAttribute('aria-hidden', 'true');

		await fireEvent.click(trigger);
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
		expect(content).toHaveAttribute('data-state', 'open');
		expect(content).not.toHaveAttribute('inert');
		expect(content).not.toHaveAttribute('aria-hidden');
	});
});

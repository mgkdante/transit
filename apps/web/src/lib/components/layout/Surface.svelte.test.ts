// Surface.svelte.test.ts — DOM gate for the A1 full-bleed content shell.
//
// A1 dropped the boxed max-width variants (content|wide|bleed). Surface now
// ALWAYS fills its rail-inset <main> box edge-to-edge; content lanes come from
// the gutter (padding-inline: var(--space-page-x)), not a centred max-width cap.
// These tests guard: no --surface-maxw is emitted, the width prop is gone, the
// gutter is opt-outable, the polymorphic element + pad modifiers still work.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Surface from './Surface.svelte';

const body = createRawSnippet(() => ({
	render: () => `<p data-testid="surface-body">Body</p>`,
}));

describe('Surface (A1 full-bleed)', () => {
	it('renders its children inside the surface shell', () => {
		const { container } = render(Surface, { props: { children: body } });
		const shell = container.querySelector('[data-slot="surface"]')!;
		expect(shell.querySelector('[data-testid="surface-body"]')).toBeTruthy();
	});

	it('emits NO --surface-maxw and no inline width cap (full-bleed by construction)', () => {
		const { container } = render(Surface, { props: { children: body } });
		const shell = container.querySelector('[data-slot="surface"]') as HTMLElement;
		// The boxed max-width variant machinery is gone — no inline custom property.
		expect(shell.getAttribute('style') ?? '').not.toContain('--surface-maxw');
	});

	it('applies the gutter by default and drops it when gutter=false', () => {
		const { container: withGutter } = render(Surface, { props: { children: body } });
		expect(
			withGutter
				.querySelector('[data-slot="surface"]')
				?.classList.contains('surface-shell--gutter'),
		).toBe(true);

		const { container: noGutter } = render(Surface, {
			props: { children: body, gutter: false },
		});
		expect(
			noGutter.querySelector('[data-slot="surface"]')?.classList.contains('surface-shell--gutter'),
		).toBe(false);
	});

	it('is polymorphic (as) and carries the pad modifier', () => {
		const { container } = render(Surface, {
			props: { children: body, as: 'div', pad: 'hub' },
		});
		const shell = container.querySelector('[data-slot="surface"]')!;
		expect(shell.tagName.toLowerCase()).toBe('div');
		expect(shell.classList.contains('surface-shell--hub')).toBe(true);
	});

	it('drops the width prop and the max-width cap from source (A1)', () => {
		// Guard the A1 law at the source level: no `width?:` prop, no max-width on the
		// shell (the gutter forms content lanes; --container-content survives only for
		// the future ArticleShell prose lane, not on Surface).
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/Surface.svelte'),
			'utf-8',
		);
		expect(source).not.toMatch(/width\?:/);
		expect(source).not.toMatch(/max-width:\s*var\(--surface-maxw\)/);
	});
});

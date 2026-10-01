import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ControlsRail from './ControlsRail.svelte';

const controls = createRawSnippet(() => ({
	render: () => `<div>
		<button type="button" data-testid="grain-picker">Grain</button>
		<button type="button" data-testid="window-picker">Window</button>
	</div>`,
}));

describe('ControlsRail', () => {
	it('renders the caller-supplied controls in the body', () => {
		const { getByTestId, container } = render(ControlsRail, {
			props: { children: controls },
		});
		const body = container.querySelector('[data-slot="controls-rail-body"]')!;
		expect(body.querySelector('[data-testid="grain-picker"]')).toBeTruthy();
		expect(getByTestId('window-picker')).toBeTruthy();
	});

	it('renders the bilingual label as a mono overline and names the group', () => {
		const { container } = render(ControlsRail, {
			props: { label: 'CONTRÔLES', children: controls },
		});
		const label = container.querySelector('[data-slot="controls-rail-label"]');
		expect(label?.textContent).toBe('CONTRÔLES');
		expect(container.querySelector('[data-slot="controls-rail"]')?.getAttribute('aria-label')).toBe(
			'CONTRÔLES',
		);
	});

	it('omits the label element entirely when no label is given', () => {
		const { container } = render(ControlsRail, {
			props: { children: controls },
		});
		expect(container.querySelector('[data-slot="controls-rail-label"]')).toBeNull();
		expect(container.querySelector('[data-slot="controls-rail"]')?.hasAttribute('aria-label')).toBe(
			false,
		);
	});

	it('renders as a non-sticky panel by default', () => {
		const { container } = render(ControlsRail, {
			props: { children: controls },
		});
		expect(
			container
				.querySelector('[data-slot="controls-rail"]')
				?.classList.contains('controls-rail--sticky'),
		).toBe(false);
	});

	it('applies the sticky modifier when sticky is true', () => {
		const { container } = render(ControlsRail, {
			props: { children: controls, sticky: true },
		});
		expect(
			container
				.querySelector('[data-slot="controls-rail"]')
				?.classList.contains('controls-rail--sticky'),
		).toBe(true);
	});

	it('lifts the sticky rail above scrolling content with z-index (the sticky/z-index trap)', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/ControlsRail.svelte'),
			'utf-8',
		);
		expect(source).toMatch(/\.controls-rail--sticky\s*\{[^}]*z-index:\s*var\(--z-rail\)/);
	});

	it('parks the sticky rail off the single --chrome-offset knob (no literal, no --rail-sticky-top)', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/ControlsRail.svelte'),
			'utf-8',
		);
		expect(source).toMatch(/\.controls-rail--sticky\s*\{[^}]*top:\s*var\(--chrome-offset\)/);
		expect(source).not.toMatch(/top:\s*var\(--rail-sticky-top/);
		expect(source).not.toMatch(/top:\s*5\.5rem/);
	});

	it('flushes tight under the chrome when stuck (B2: hairline + backdrop, no dead band)', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/ControlsRail.svelte'),
			'utf-8',
		);
		expect(source).toMatch(/\.controls-rail--sticky\[data-stuck='true'\]/);
		expect(source).toMatch(/backdrop-filter:\s*blur\(16px\)/);
	});

	it('is a non-landmark group (not a <section>) and forwards a custom class', () => {
		const { container } = render(ControlsRail, {
			props: { label: 'CONTRÔLES', children: controls, class: 'surface-controls' },
		});
		const rail = container.querySelector('[data-slot="controls-rail"]')!;
		expect(rail.tagName.toLowerCase()).toBe('div');
		expect(rail.getAttribute('role')).toBe('group');
		expect(rail.classList).toContain('surface-controls');
	});

	it('exposes no role when unlabelled (a plain grouping div, never an unnamed group)', () => {
		const { container } = render(ControlsRail, {
			props: { children: controls },
		});
		const rail = container.querySelector('[data-slot="controls-rail"]')!;
		expect(rail.tagName.toLowerCase()).toBe('div');
		expect(rail.hasAttribute('role')).toBe(false);
	});
});

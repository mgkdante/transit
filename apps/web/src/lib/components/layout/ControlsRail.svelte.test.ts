// ControlsRail.svelte.test.ts — DOM gate for the surface control panel.
//
// Guards the contract: a bordered control panel (a non-landmark `role="group"`
// div, NOT a <section> region) that hosts the caller's controls via `children`,
// an optional bilingual mono group label that both renders and names the group,
// and an opt-in desktop-sticky modifier. The
// rail itself is quiet chrome — the test asserts the label is present, not that
// it carries any --primary cue (that belongs to the caller's active chips).

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
		// jsdom does not compute Svelte-scoped <style> z-index, so we assert the CSS
		// contract from source: the sticky rule must carry z-index: var(--z-rail) so
		// POSITIONED data-mark cards scrolling under the stuck rail can't paint over it.
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/ControlsRail.svelte'),
			'utf-8',
		);
		expect(source).toMatch(/\.controls-rail--sticky\s*\{[^}]*z-index:\s*var\(--z-rail\)/);
	});

	it('is a non-landmark group (not a <section>) and forwards a custom class', () => {
		const { container } = render(ControlsRail, {
			props: { label: 'CONTRÔLES', children: controls, class: 'surface-controls' },
		});
		const rail = container.querySelector('[data-slot="controls-rail"]')!;
		// A control cluster is a labelled group, NOT a top-level region landmark.
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

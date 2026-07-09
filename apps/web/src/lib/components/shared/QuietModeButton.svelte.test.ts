import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import QuietModeButton from './QuietModeButton.svelte';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

const localeContext = (locale: 'en' | 'fr') =>
	new Map([[Symbol.for('transit.i18n.locale'), () => locale]]);

function renderControls(locale: 'en' | 'fr' = 'en') {
	return render(QuietModeButton, { context: localeContext(locale) });
}

beforeEach(() => quietModeStore.resetForTest());
afterEach(() => {
	cleanup();
	quietModeStore.resetForTest();
});

describe('QuietModeButton source parity', () => {
	it('uses the exact English action labels and plain-button state hooks', async () => {
		renderControls('en');
		await tick();
		const collapse = screen.getByRole('button', { name: 'Collapse all' });
		expect(collapse).toHaveAttribute('data-collapsed', 'false');
		expect(collapse).not.toHaveAttribute('role', 'switch');
		expect(collapse).not.toHaveAttribute('aria-checked');
		expect(collapse).not.toHaveAttribute('aria-pressed');
		expect(collapse).toHaveAttribute('title', 'Collapse all sections on this page');

		await fireEvent.click(collapse);
		expect(screen.getByRole('button', { name: 'Expand all' })).toHaveAttribute(
			'data-collapsed',
			'true',
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Always start collapsed' }));
		expect(screen.getByRole('button', { name: "Don't start collapsed" })).toHaveAttribute(
			'data-remembered',
			'true',
		);
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');

		await fireEvent.click(screen.getByRole('button', { name: "Don't start collapsed" }));
		expect(screen.getByRole('button', { name: 'Always start collapsed' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();
		expect(localStorage.getItem('transit:quiet-mode')).toBeNull();
	});

	it('uses the exact French labels', async () => {
		renderControls('fr');
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Tout replier' }));
		expect(screen.getByRole('button', { name: 'Tout déplier' })).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Toujours replier' }));
		expect(screen.getByRole('button', { name: 'Ne plus replier' })).toBeInTheDocument();
	});

	it('resets unsaved collapsed mode when a new article control mounts', async () => {
		const first = renderControls('en');
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		expect(quietModeStore.enabled).toBe(true);
		first.unmount();
		renderControls('en');
		await tick();
		expect(quietModeStore.enabled).toBe(false);
		expect(screen.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
	});

	it('allows the two controls to wrap without shrinking their tap targets', () => {
		const source = readFileSync(
			`${process.cwd()}/src/lib/components/shared/QuietModeButton.svelte`,
			'utf8',
		);
		expect(source).toMatch(
			/@media\s*\(max-width:\s*480px\)[\s\S]*?\.quiet-mode-controls\s*\{[\s\S]*?flex-wrap:\s*wrap/,
		);
		expect(source).toMatch(/min-width:\s*44px[\s\S]*?min-height:\s*44px/);
	});
});

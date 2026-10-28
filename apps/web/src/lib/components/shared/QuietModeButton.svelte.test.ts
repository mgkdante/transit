import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import QuietModeButton from './QuietModeButton.svelte';
import { quietMode } from '@yesid/ui/state';

const localeContext = (locale: 'en' | 'fr') =>
	new Map([[Symbol.for('@yesid/ui/locale'), () => locale]]);

function renderControls(locale: 'en' | 'fr' = 'en') {
	return render(QuietModeButton, { context: localeContext(locale) });
}

beforeEach(() => quietMode.resetForTest());
afterEach(() => {
	cleanup();
	quietMode.resetForTest();
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
		expect(localStorage.getItem('quiet-mode')).toBe('true');

		await fireEvent.click(screen.getByRole('button', { name: "Don't start collapsed" }));
		expect(screen.getByRole('button', { name: 'Always start collapsed' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();
		expect(localStorage.getItem('quiet-mode')).toBeNull();
	});

	it('uses the exact French labels', async () => {
		renderControls('fr');
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: 'Tout replier' }));
		expect(screen.getByRole('button', { name: 'Tout déplier' })).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Toujours replier' }));
		expect(screen.getByRole('button', { name: 'Ne plus replier' })).toBeInTheDocument();
	});
});

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import MapLegendControl from './MapLegendControl.svelte';
import { copy } from './map.copy';

afterEach(() => localStorage.clear());
describe('MapLegendControl', () => {
	it.each(['en', 'fr'] as const)(
		'opens and closes the phone legend with focus restored (%s)',
		async (locale) => {
			(
				window as typeof window & { happyDOM: { setInnerWidth: (width: number) => void } }
			).happyDOM.setInnerWidth(390);
			render(MapLegendControl, { locale, presentation: 'phone' });
			const button = screen.getByRole('button', { name: copy[locale].legend.title });
			expect(button).toHaveAttribute('aria-expanded', 'false');
			await fireEvent.click(button);
			const dialog = screen.getByRole('dialog', { name: copy[locale].legend.title });
			expect(dialog).toHaveAttribute('tabindex', '0');
			await waitFor(() => expect(dialog).toHaveFocus());
			expect(button).toHaveAttribute('aria-expanded', 'true');
			expect(button).toHaveAttribute('aria-controls', dialog.id);
			expect(screen.getByText(copy[locale].headingLead)).toBeVisible();
			await fireEvent.keyDown(dialog, { key: 'Escape' });
			await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'));
			await waitFor(() => expect(button).toHaveFocus());
			await fireEvent.click(button);
			await fireEvent.click(button);
			expect(button).toHaveAttribute('aria-expanded', 'false');
		},
	);
	it('starts expanded on desktop and remembers collapse across mounts', async () => {
		const view = render(MapLegendControl, { locale: 'en', presentation: 'desktop' });
		const header = view.getByRole('button', { name: 'Legend' });
		const viewport = view.getByRole('region', { name: 'Legend' });
		expect(viewport).toHaveAttribute('tabindex', '0');
		viewport.focus();
		expect(viewport).toHaveFocus();
		expect(header).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(header);
		expect(header).toHaveAttribute('aria-expanded', 'false');
		expect(localStorage.getItem('transit:legend-collapsed')).toBe('true');
		view.unmount();
		const restored = render(MapLegendControl, { locale: 'en', presentation: 'desktop' });
		await waitFor(() =>
			expect(restored.getByRole('button', { name: 'Legend' })).toHaveAttribute(
				'aria-expanded',
				'false',
			),
		);
	});
});

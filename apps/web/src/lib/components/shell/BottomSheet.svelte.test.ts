import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import BottomSheet from './BottomSheet.svelte';

describe('BottomSheet', () => {
	it('shows a back action only when mobile detail history exists', async () => {
		const onback = vi.fn();
		const { rerender, getByRole, queryByRole } = render(BottomSheet, {
			props: {
				open: true,
				locale: 'en',
				title: 'Stop 52618',
				surfaceKey: 'stop:52618',
				canGoBack: false,
				onback,
			},
		});

		expect(queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

		await rerender({
			open: true,
			locale: 'en',
			title: 'Route 161',
			surfaceKey: 'route:161',
			canGoBack: true,
			onback,
		});
		await fireEvent.click(getByRole('button', { name: 'Back' }));

		expect(onback).toHaveBeenCalledOnce();
	});

	it.each([
		{ locale: 'en' as const, title: 'Details' },
		{ locale: 'fr' as const, title: 'Détails' },
	])(
		'uses the Sheet title as the sole $locale identity with a generic-title fallback',
		async ({ locale, title }) => {
			render(BottomSheet, { props: { open: true, locale } });

			const heading = await screen.findByRole('heading', { level: 2, name: title });
			const sheet = document.querySelector<HTMLElement>('[data-slot="bottom-sheet"]')!;

			expect(heading).toBeInTheDocument();
			expect(sheet).not.toHaveAttribute('aria-label');
			expect(screen.getAllByRole('heading')).toHaveLength(1);
		},
	);

	it('uses the supplied identity snippet as the Sheet title', async () => {
		const identity = createRawSnippet(() => ({ render: () => '<span>Route 161</span>' }));
		render(BottomSheet, { props: { open: true, locale: 'en', identity } });

		expect(await screen.findByRole('heading', { level: 2, name: 'Route 161' })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { level: 2, name: 'Details' })).not.toBeInTheDocument();
	});

	it.each([
		{ locale: 'en' as const, closeLabel: 'Close details' },
		{ locale: 'fr' as const, closeLabel: 'Fermer les détails' },
	])(
		'uses an app-side $locale close control beside the shared height handle',
		async ({ locale, closeLabel }) => {
			render(BottomSheet, { props: { open: true, locale, canGoBack: true } });

			const sheet = await waitFor(() => {
				const element = document.querySelector<HTMLElement>('[data-slot="bottom-sheet"]');
				expect(element).toBeInTheDocument();
				return element!;
			});
			expect(sheet.querySelector('[data-slot="bottom-sheet-grabber"]')).not.toBeInTheDocument();
			expect(sheet.querySelectorAll('[data-sheet-handle]')).toHaveLength(1);
			for (const button of sheet.querySelectorAll<HTMLButtonElement>(
				'button[data-slot^="bottom-sheet-"]',
			)) {
				expect(button).toHaveClass('size-11');
			}

			await fireEvent.click(screen.getByRole('button', { name: closeLabel }));
			await waitFor(() => {
				expect(document.querySelector('[data-slot="bottom-sheet"]')).not.toBeInTheDocument();
			});
		},
	);

	it.each([
		{
			locale: 'en' as const,
			name: 'Details height',
			values: ['Half height', 'Full height', 'Peek'],
		},
		{
			locale: 'fr' as const,
			name: 'Hauteur des détails',
			values: ['Mi-hauteur', 'Pleine hauteur', 'Aperçu'],
		},
	])(
		'opens at half height without blocking the map and cycles $locale heights from the handle',
		async ({ locale, name, values }) => {
			render(BottomSheet, { props: { open: true, locale } });

			const handle = await screen.findByRole('slider', { name });
			const sheet = document.querySelector<HTMLElement>('[data-slot="bottom-sheet"]')!;
			expect(sheet).toHaveAttribute('aria-modal', 'false');
			expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeInTheDocument();
			expect(sheet).toHaveAttribute('data-detent', 'half');
			expect(handle).toHaveAttribute('aria-valuetext', values[0]);

			await fireEvent.keyDown(handle, { key: 'ArrowUp' });
			expect(sheet).toHaveAttribute('data-detent', 'full');
			expect(handle).toHaveAttribute('aria-valuetext', values[1]);

			await fireEvent.keyDown(handle, { key: 'Home' });
			expect(sheet).toHaveAttribute('data-detent', 'peek');
			expect(handle).toHaveAttribute('aria-valuetext', values[2]);
		},
	);

	it('keeps the rider height when the sheet closes and reopens', async () => {
		const { rerender } = render(BottomSheet, { props: { open: true, locale: 'en' } });

		await fireEvent.keyDown(await screen.findByRole('slider', { name: 'Details height' }), {
			key: 'End',
		});
		await rerender({ open: false, locale: 'en' });
		await waitFor(() => {
			expect(document.querySelector('[data-slot="bottom-sheet"]')).not.toBeInTheDocument();
		});
		await rerender({ open: true, locale: 'en' });

		const sheet = await waitFor(() => {
			const element = document.querySelector<HTMLElement>('[data-slot="bottom-sheet"]');
			expect(element).toBeInTheDocument();
			return element!;
		});
		expect(sheet).toHaveAttribute('data-detent', 'full');
	});

	it('keeps every sheet clear of the mobile safe-area inset without requiring a footer', async () => {
		render(BottomSheet, { props: { open: true, locale: 'en' } });

		const safeArea = await waitFor(() => {
			const element = document.querySelector<HTMLElement>('[data-slot="bottom-sheet-safe-area"]');
			expect(element).toBeInTheDocument();
			return element!;
		});
		expect(safeArea.getAttribute('style')).toContain('env(safe-area-inset-bottom)');
		expect(document.querySelector('[data-slot="bottom-sheet-footer"]')).not.toBeInTheDocument();
	});

	it('hides footer chrome when an honest action snippet renders nothing', async () => {
		const footer = createRawSnippet(() => ({ render: () => '<span></span>' }));
		render(BottomSheet, { props: { open: true, locale: 'en', footer } });

		const footerElement = await waitFor(() => {
			const element = document.querySelector<HTMLElement>('[data-slot="bottom-sheet-footer"]');
			expect(element).toBeInTheDocument();
			return element!;
		});
		expect(footerElement).toHaveClass('empty:hidden');
	});
});

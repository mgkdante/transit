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
		'uses an app-side $locale close control and no false drag affordance',
		async ({ locale, closeLabel }) => {
			render(BottomSheet, { props: { open: true, locale, canGoBack: true } });

			const sheet = await waitFor(() => {
				const element = document.querySelector<HTMLElement>('[data-slot="bottom-sheet"]');
				expect(element).toBeInTheDocument();
				return element!;
			});
			expect(sheet.querySelector('[data-slot="bottom-sheet-grabber"]')).not.toBeInTheDocument();
			expect(
				Array.from(sheet.children).some((child) =>
					child.matches('[data-vaul-drawer-handle], [data-drawer-handle], [aria-hidden="true"]'),
				),
			).toBe(false);
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

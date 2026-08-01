import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import BottomSheet from './BottomSheet.svelte';

function cssBlock(source: string, marker: string): string {
	const markerIndex = source.indexOf(marker);
	if (markerIndex < 0) return '';
	const open = source.indexOf('{', markerIndex + marker.length);
	if (open < 0) return '';
	let depth = 1;
	let cursor = open + 1;
	while (depth > 0 && cursor < source.length) {
		if (source[cursor] === '{') depth += 1;
		if (source[cursor] === '}') depth -= 1;
		cursor += 1;
	}
	return source.slice(open + 1, cursor - 1);
}

function compactCss(value: string): string {
	return value
		.replace(/\/\*[^]*?\*\//g, '')
		.replace(/\s+/g, ' ')
		.replace(/\s*([{},:;])\s*/g, '$1')
		.trim();
}

function productionSvelteStyles(directory: string): string {
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) return productionSvelteStyles(path);
			if (!entry.name.endsWith('.svelte') || entry.name.endsWith('.test.svelte')) return [];
			return [...readFileSync(path, 'utf8').matchAll(/<style[^>]*>([^]*?)<\/style>/g)].map(
				(match) => match[1] ?? '',
			);
		})
		.join('\n');
}

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

	it('owns the keyed 300ms/200ms detail-sheet entrance and the mobile ladder container', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/BottomSheet.svelte'),
			'utf8',
		);

		const openSelector =
			":global([data-m6c2-detail-sheet][data-slot='bottom-sheet'][data-state='open'])";
		const closedSelector =
			":global([data-m6c2-detail-sheet][data-slot='bottom-sheet'][data-state='closed'])";
		const normalMotion = cssBlock(source, '@media (prefers-reduced-motion: no-preference)');

		expect(source).toContain('data-m6c2-detail-sheet=""');
		expect(compactCss(normalMotion)).toBe(
			`${openSelector}{animation:m6c2-detail-sheet-in var(--duration-slow) var(--ease-out) both;transition:none;}${closedSelector}{animation:m6c2-detail-sheet-out var(--duration-normal) var(--ease-out) both;transition:none;}`,
		);
		expect(compactCss(cssBlock(source, openSelector))).toBe(
			'animation:m6c2-detail-sheet-in var(--duration-slow) var(--ease-out) both;transition:none;',
		);
		expect(compactCss(cssBlock(source, closedSelector))).toBe(
			'animation:m6c2-detail-sheet-out var(--duration-normal) var(--ease-out) both;transition:none;',
		);
		expect(compactCss(cssBlock(source, '@keyframes m6c2-detail-sheet-in'))).toBe(
			'from{opacity:0;transform:translateY(0.75rem) scale(0.985);}to{opacity:1;transform:translateY(0) scale(1);}',
		);
		expect(compactCss(cssBlock(source, '@keyframes m6c2-detail-sheet-out'))).toBe(
			'from{opacity:1;transform:translateY(0) scale(1);}to{opacity:0;transform:translateY(0.5rem) scale(0.99);}',
		);
		expect(source).toMatch(/\.bottom-sheet-body\s*\{[^}]*container:\s*right-panel \/ inline-size/s);
		expect(source.slice(source.indexOf('<style>'))).not.toMatch(
			/:global\(\[data-slot='(?:sheet-content|bottom-sheet|sheet-overlay)'\]/,
		);
	});

	it('places the unlayered three-selector PRM kill immediately after tw-animate', () => {
		const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
		const importEnd =
			appCss.indexOf("@import 'tw-animate-css';") + "@import 'tw-animate-css';".length;
		const nextDirective = appCss.indexOf('@custom-variant', importEnd);
		const prmBlock = appCss.slice(importEnd, nextDirective);

		expect(compactCss(prmBlock)).toBe(
			"@media (prefers-reduced-motion:reduce){[data-slot='sheet-content'],[data-slot='bottom-sheet'],[data-slot='sheet-overlay']{animation:none;transition:none;}}",
		);

		const componentStyles = productionSvelteStyles(resolve(process.cwd(), 'src'))
			.replace(
				/\[data-m6c2-detail-sheet\]\[data-slot='bottom-sheet'\](?:\[data-state='(?:open|closed)'\])?/g,
				'',
			)
			.replace(
				/\[data-m6b-controls-drawer\]\[data-slot='sheet-content'\](?:\[data-state='(?:open|closed)'\])?/g,
				'',
			)
			.replace(
				/\[data-slot='sheet-overlay'\]\[data-state\]:has\(\+ \[data-m6b-controls-drawer\]\)/g,
				'',
			);
		expect(componentStyles).not.toMatch(
			/\[data-slot=['"](?:sheet-content|bottom-sheet|sheet-overlay)['"]\]/,
		);
	});
});

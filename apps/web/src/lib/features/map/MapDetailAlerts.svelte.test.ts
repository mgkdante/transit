import { render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import MapDetailAlerts from './MapDetailAlerts.svelte';
import { MAP_SELECTION_DETAIL_COPY } from './mapSelectionDetail.copy';
import type { Alert } from '$lib/v1/schemas';

describe('MapDetailAlerts', () => {
	function floorPx(value: string): number {
		if (value.endsWith('rem')) return Number.parseFloat(value) * 16;
		if (value.endsWith('px')) return Number.parseFloat(value);
		return 0;
	}

	function installComponentCss(): HTMLStyleElement {
		const path = 'src/lib/features/map/MapDetailAlerts.svelte';
		const style = document.createElement('style');
		style.textContent =
			compile(readFileSync(resolve(process.cwd(), path), 'utf8'), {
				filename: path,
				generate: 'client',
				css: 'external',
			}).css?.code ?? '';
		document.head.append(style);
		return style;
	}

	it('renders an empty alert list as the shared healthy-zero notice', () => {
		render(MapDetailAlerts, {
			props: { alerts: [], locale: 'en', t: MAP_SELECTION_DETAIL_COPY.en },
		});

		const notice = screen
			.getByText('No alerts attached')
			.closest('[data-component="state-notice"]');
		expect(notice).toHaveAttribute('data-presentation', 'silo');
		expect(notice).toHaveAttribute('data-tone', 'positive');
		expect(notice).not.toHaveAttribute('role', 'status');
		expect(notice).not.toHaveAttribute('aria-live');
	});

	it('renders unavailable alert data as a neutral notice, never a healthy zero', () => {
		render(MapDetailAlerts, {
			props: { alerts: null, locale: 'en', t: MAP_SELECTION_DETAIL_COPY.en },
		});

		const notice = screen
			.getByText('Alert data unavailable')
			.closest('[data-component="state-notice"]');
		expect(notice).toHaveAttribute('data-presentation', 'silo');
		expect(notice).toHaveAttribute('data-tone', 'neutral');
		expect(notice).not.toHaveAttribute('role', 'status');
		expect(notice).not.toHaveAttribute('aria-live');
		expect(screen.queryByText('No alerts attached')).not.toBeInTheDocument();
	});

	it('labels the action in UI language while language-tagging foreign provider text and its link', () => {
		const alert = {
			id: 'foreign',
			severity: 'high',
			header_key: 'Votre ligne',
			description: 'Détour français',
			description_en: null,
			url: 'https://example.test/fr/avis',
			url_en: null,
		} as Alert;
		render(MapDetailAlerts, {
			props: { alerts: [alert], locale: 'en', t: MAP_SELECTION_DETAIL_COPY.en },
		});
		const providerText = screen.getAllByText('Détour français')[0];
		expect(providerText).toHaveAttribute('lang', 'fr');
		expect(screen.getAllByText('(French only)').length).toBeGreaterThan(0);
		const button = screen.getByRole('button', {
			name: 'Select alert Détour français (French only)',
		});
		expect(button).toHaveAttribute('aria-labelledby');
		expect(button).not.toHaveAttribute('aria-label');
		const link = screen.getByRole('link', { name: 'Open alert details on example.test (new tab)' });
		expect(link).toHaveAttribute('hreflang', 'fr');
		expect(link).toHaveAttribute('href', 'https://example.test/fr/avis');
	});

	it('does not add a language marker to a header_key fallback', () => {
		render(MapDetailAlerts, {
			props: {
				alerts: [{ id: 'key', severity: 'watch', header_key: 'Réduction de service' } as Alert],
				locale: 'en',
				t: MAP_SELECTION_DETAIL_COPY.en,
			},
		});
		expect(screen.getAllByText('Réduction de service')[0]).not.toHaveAttribute('lang');
		expect(screen.queryByText('(French only)')).not.toBeInTheDocument();
	});

	it('keeps repeated-instance labels unique and scoped to each localized component', () => {
		const alert = {
			id: 'shared-alert',
			severity: 'high',
			header_key: 'Votre ligne',
			description: 'Détour français',
			description_en: null,
		} as Alert;
		const english = render(MapDetailAlerts, {
			props: { alerts: [alert], locale: 'en', t: MAP_SELECTION_DETAIL_COPY.en },
		});
		const french = render(MapDetailAlerts, {
			props: { alerts: [alert], locale: 'fr', t: MAP_SELECTION_DETAIL_COPY.fr },
		});

		const englishButton = within(english.container).getByRole('button', {
			name: 'Select alert Détour français (French only)',
		});
		const frenchButton = within(french.container).getByRole('button', {
			name: 'Sélectionner l’alerte Détour français',
		});
		const englishLabelId = englishButton.getAttribute('aria-labelledby');
		const frenchLabelId = frenchButton.getAttribute('aria-labelledby');

		expect(englishLabelId).not.toBe(frenchLabelId);
		expect(english.container.querySelector(`#${englishLabelId}`)).not.toBeNull();
		expect(english.container.querySelector(`#${frenchLabelId}`)).toBeNull();
		expect(french.container.querySelector(`#${frenchLabelId}`)).not.toBeNull();
		expect(french.container.querySelector(`#${englishLabelId}`)).toBeNull();
	});

	it.each(['en', 'fr'] as const)(
		'gives the %s alert selector and external link an explicit 44px floor',
		(locale) => {
			const style = installComponentCss();
			const alert = {
				id: `short-${locale}`,
				severity: 'watch',
				header_key: 'A',
				description: 'A',
				description_en: 'A',
				url: 'https://example.test/a',
				url_en: 'https://example.test/a',
			} as Alert;
			try {
				const { getByRole } = render(MapDetailAlerts, {
					props: { alerts: [alert], locale, t: MAP_SELECTION_DETAIL_COPY[locale] },
				});

				for (const target of [getByRole('button'), getByRole('link')]) {
					const computed = getComputedStyle(target);
					expect(Math.max(floorPx(computed.minBlockSize), floorPx(computed.minHeight))).toBe(44);
				}
			} finally {
				style.remove();
			}
		},
	);

	it('uses block-axis padding rather than the old zero-padding selector', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapDetailAlerts.svelte'),
			'utf8',
		);
		const buttonRule = source.match(/\.map-alert-button\s*\{[\s\S]*?\n\t\}/)?.[0] ?? '';
		const linkRule = source.match(/\.map-alert-link\s*\{[\s\S]*?\n\t\}/)?.[0] ?? '';

		expect(buttonRule).toContain('min-block-size: 2.75rem');
		expect(buttonRule).toContain('padding-block: 0.5rem');
		expect(buttonRule).not.toMatch(/padding:\s*0(?:;|\s)/);
		expect(linkRule).toContain('min-block-size: 2.75rem');
		expect(linkRule).toContain('padding-block: 0.5rem');
	});
});

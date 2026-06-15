// EdgeState.test.ts — the 6-variant edge-condition primitive, the DOM gate.
//
// Gates:
//   - ALL 6 VARIANTS RENDER in BOTH locales (FR + EN): skeleton + the five
//     message variants (stale-offline, no-results, empty, empty-avis, error-v1).
//     Each carries its data-variant attribute and (for message variants) its
//     localized title.
//   - a11y verdict surface: message variants expose a live region (role=status,
//     escalating to role=alert for error-v1); the skeleton announces aria-busy.
//   - DOCTRINE: the verdict glyph is aria-hidden (colour + glyph + text, never
//     colour alone — the visible text carries the meaning for AT).
//   - error-v1 shows the RETRY button only when an onRetry handler is supplied,
//     and clicking it fires the handler.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import EdgeState from './EdgeState.svelte';
import type { Locale } from '$lib/i18n';

const LOCALES: Locale[] = ['en', 'fr'];

// Localized titles per variant (mirrors the component's COPY object) — proves
// the right language slotted in, not just that *something* rendered.
const TITLES = {
	'stale-offline': { en: 'Data is behind', fr: 'Données en retard' },
	'no-results': { en: 'No results', fr: 'Aucun résultat' },
	empty: { en: 'Nothing to show', fr: 'Rien à afficher' },
	'empty-avis': { en: 'No alerts', fr: 'Aucun avis' },
	'error-v1': { en: '/v1 contract unreachable', fr: 'Contrat /v1 injoignable' }
} satisfies Record<string, Record<Locale, string>>;

const MESSAGE_VARIANTS = Object.keys(TITLES) as Array<keyof typeof TITLES>;

describe('EdgeState — all 6 variants render in FR + EN', () => {
	for (const lang of LOCALES) {
		it(`skeleton renders a busy loading region (${lang})`, () => {
			const { container } = render(EdgeState, { props: { variant: 'skeleton', lang } });
			const root = container.querySelector('[data-slot="edge-state"]');
			expect(root).not.toBeNull();
			expect(root).toHaveAttribute('data-variant', 'skeleton');
			expect(root).toHaveAttribute('aria-busy', 'true');
			// Loading label is announced to AT (sr-only), localized.
			expect(root!.textContent).toContain(lang === 'fr' ? 'Chargement' : 'Loading');
		});

		for (const variant of MESSAGE_VARIANTS) {
			it(`${variant} renders with its localized title (${lang})`, () => {
				const { container, getByText } = render(EdgeState, { props: { variant, lang } });
				const root = container.querySelector('[data-slot="edge-state"]');
				expect(root).toHaveAttribute('data-variant', variant);
				expect(getByText(TITLES[variant][lang])).toBeInTheDocument();
			});
		}
	}
});

describe('EdgeState — a11y verdict surface', () => {
	it('message variants are a polite live status region', () => {
		const { container } = render(EdgeState, { props: { variant: 'empty', lang: 'en' } });
		const root = container.querySelector('[data-slot="edge-state"]');
		expect(root).toHaveAttribute('role', 'status');
		expect(root).toHaveAttribute('aria-live', 'polite');
	});

	it('error-v1 escalates to an assertive alert region', () => {
		const { container } = render(EdgeState, { props: { variant: 'error-v1', lang: 'en' } });
		const root = container.querySelector('[data-slot="edge-state"]');
		expect(root).toHaveAttribute('role', 'alert');
		expect(root).toHaveAttribute('aria-live', 'assertive');
	});

	it('the verdict glyph is decorative (aria-hidden) — meaning carried by the text', () => {
		const { container } = render(EdgeState, { props: { variant: 'empty-avis', lang: 'fr' } });
		// The glyph span is aria-hidden; the title text is what AT announces.
		const glyph = container.querySelector('[aria-hidden="true"].font-mono');
		expect(glyph).not.toBeNull();
		expect(glyph!.textContent).toBe('●'); // empty-avis = the GOOD green dot
	});
});

describe('EdgeState — error-v1 retry affordance', () => {
	it('renders the retry button (FR) and fires onRetry on click', async () => {
		const onRetry = vi.fn();
		const { getByText } = render(EdgeState, {
			props: { variant: 'error-v1', lang: 'fr', onRetry },
		});
		const btn = getByText('Réessayer');
		expect(btn).toBeInTheDocument();
		await fireEvent.click(btn);
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it('renders the retry button (EN)', () => {
		const { getByText } = render(EdgeState, {
			props: { variant: 'error-v1', lang: 'en', onRetry: () => {} },
		});
		expect(getByText('Retry')).toBeInTheDocument();
	});

	it('omits the retry button when no onRetry handler is supplied', () => {
		const { queryByText } = render(EdgeState, { props: { variant: 'error-v1', lang: 'en' } });
		expect(queryByText('Retry')).toBeNull();
	});

	it('shows the localized last-MAJ delta on the stale variant when lastUpdated is given', () => {
		const recent = new Date(Date.now() - 4 * 60 * 1000).toISOString(); // 4 min ago
		const { container } = render(EdgeState, {
			props: { variant: 'stale-offline', lang: 'fr', lastUpdated: recent },
		});
		const delta = container.querySelector('[data-slot="edge-stale-delta"]');
		expect(delta).not.toBeNull();
		expect(delta!.textContent).toContain('MAJ');
	});
});

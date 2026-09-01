import { render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import LegalDocument from './LegalDocument.svelte';
import { LEGAL_EFFECTIVE_DATE, legalCopy, legalDocument } from './legal.copy';

const cases = [
	{ locale: 'fr' as const, kind: 'privacy' as const, title: 'Politique de confidentialité' },
	{ locale: 'fr' as const, kind: 'terms' as const, title: 'Conditions d’utilisation' },
	{ locale: 'en' as const, kind: 'privacy' as const, title: 'Privacy Policy' },
	{ locale: 'en' as const, kind: 'terms' as const, title: 'Terms of Use' },
] as const;

describe('LegalDocument', () => {
	it('exports factual bilingual footer attribution', () => {
		expect(legalCopy.en.footerAttribution).toContain('NOTICE');
		expect(legalCopy.fr.footerAttribution).toContain('NOTICE');
		expect(legalCopy.en.footerAttribution).not.toContain('review');
		expect(legalCopy.fr.footerAttribution).not.toContain('révision');
	});

	it.each(cases)(
		'renders the complete static $locale $kind document',
		({ locale, kind, title }) => {
			const { getByTestId } = render(LegalDocument, { props: { locale, kind } });
			const page = getByTestId('legal-document');
			const copy = legalDocument(locale, kind);

			expect(within(page).getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
			expect(within(page).getAllByRole('heading', { level: 2 })).toHaveLength(copy.sections.length);
			expect(within(page).getByText(copy.effectiveDate)).toHaveAttribute(
				'datetime',
				LEGAL_EFFECTIVE_DATE,
			);
			expect(within(page).queryByRole('button')).not.toBeInTheDocument();
		},
	);

	it('keeps the privacy and licensing claims concrete in both languages', () => {
		for (const locale of ['en', 'fr'] as const) {
			const privacy = JSON.stringify(legalDocument(locale, 'privacy'));
			const terms = JSON.stringify(legalDocument(locale, 'terms'));

			expect(privacy).toContain('Cloudflare');
			expect(privacy).toContain('Geo.ca');
			expect(privacy).toContain('contact@yesid.dev');
			expect(terms).toContain('MIT');
			expect(terms).toContain('NOTICE');
			expect(terms).toContain('ODbL');
			expect(terms).toContain('City of Ottawa');
			expect(`${privacy}${terms}`.toLowerCase()).not.toContain('placeholder');
		}
		expect(JSON.stringify(legalDocument('en', 'privacy'))).toMatch(
			/URL.*withdraw.*outside Quebec.*30 days/su,
		);
		expect(JSON.stringify(legalDocument('fr', 'privacy'))).toMatch(
			/URL.*retirer.*extérieur du Québec.*30 jours/su,
		);
	});

	it.each(['privacy', 'terms'] as const)('keeps EN/FR %s sections aligned', (kind) => {
		const en = legalDocument('en', kind);
		const fr = legalDocument('fr', kind);

		expect(fr.sections.map(({ id }) => id)).toEqual(en.sections.map(({ id }) => id));
		for (const document of [en, fr]) {
			expect(document.sections.length).toBeGreaterThanOrEqual(7);
			expect(
				document.sections.every(({ title, paragraphs }) => title && paragraphs.length > 0),
			).toBe(true);
		}
	});
});

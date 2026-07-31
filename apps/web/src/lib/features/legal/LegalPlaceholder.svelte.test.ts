import { render, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import LegalPlaceholder from './LegalPlaceholder.svelte';
import { legalCopy } from './legal.copy';

const cases = [
	{
		locale: 'fr' as const,
		kind: 'privacy' as const,
		title: 'Confidentialité',
		notice: 'Cette page est en cours de révision juridique.',
	},
	{
		locale: 'fr' as const,
		kind: 'terms' as const,
		title: 'Conditions d’utilisation',
		notice: 'Cette page est en cours de révision juridique.',
	},
	{
		locale: 'en' as const,
		kind: 'privacy' as const,
		title: 'Privacy',
		notice: 'This page is under legal review.',
	},
	{
		locale: 'en' as const,
		kind: 'terms' as const,
		title: 'Terms',
		notice: 'This page is under legal review.',
	},
] as const;

describe('LegalPlaceholder', () => {
	it('exports static bilingual footer attribution for outage-safe layout use', () => {
		expect(legalCopy.fr.footerAttribution).toBe(
			'Mentions de licence et d’attribution en cours de révision juridique.',
		);
		expect(legalCopy.en.footerAttribution).toBe(
			'Licensing and attribution notices are under legal review.',
		);
	});

	it.each(cases)(
		'renders the static $locale $kind page without data-dependent controls',
		({ locale, kind, title, notice }) => {
			const { getByTestId } = render(LegalPlaceholder, {
				props: { locale, kind },
			});
			const page = getByTestId('legal-placeholder');

			expect(within(page).getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
			expect(within(page).getByText(notice)).toBeInTheDocument();
			expect(within(page).queryByRole('button')).not.toBeInTheDocument();
		},
	);
});

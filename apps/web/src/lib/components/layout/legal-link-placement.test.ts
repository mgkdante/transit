import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Footer from './Footer.svelte';
import NavPill from '$lib/components/shell/NavPill.svelte';

afterEach(cleanup);

describe('legal-link placement', () => {
	it.each([
		{
			locale: 'en' as const,
			url: new URL('https://transit.local/map'),
			openMenu: 'Open menu',
			legalLabel: 'Legal',
			links: [
				['Privacy', '/privacy'],
				['Terms', '/terms'],
			] as const,
		},
		{
			locale: 'fr' as const,
			url: new URL('https://transit.local/fr/map'),
			openMenu: 'Ouvrir le menu',
			legalLabel: 'Juridique',
			links: [
				['Confidentialité', '/fr/privacy'],
				['Conditions d’utilisation', '/fr/terms'],
			] as const,
		},
	])(
		'keeps $locale legal destinations out of every nav/header surface and in the footer',
		async ({ locale, url, openMenu, legalLabel, links }) => {
			const nav = render(NavPill, { props: { locale, url } });
			await fireEvent.click(nav.getByRole('button', { name: openMenu }));
			expect(nav.getByTestId('nav-menu')).toBeInTheDocument();

			const footer = render(Footer, { props: { locale } });
			const navHeaderSurfaces = Array.from(
				document.querySelectorAll<HTMLElement>('header, nav'),
			).filter((surface) => !surface.closest('footer'));
			expect(navHeaderSurfaces.length).toBeGreaterThan(0);

			for (const [, href] of links) {
				for (const surface of navHeaderSurfaces) {
					expect(surface.querySelector(`a[href="${href}"]`)).toBeNull();
				}
			}

			const legal = footer.getByRole('navigation', { name: legalLabel });
			for (const [label, href] of links) {
				expect(within(legal).getByRole('link', { name: label })).toHaveAttribute('href', href);
			}
		},
	);
});

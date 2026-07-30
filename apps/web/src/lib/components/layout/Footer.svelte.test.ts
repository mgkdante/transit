import { render, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Footer from './Footer.svelte';

const PROVIDER_NAME = 'Société de transport de Montréal';
const MANIFEST_ATTRIBUTION = '© Agence exemple | Licence ouverte 2.0';

const localeCases = [
	{
		locale: 'fr' as const,
		navLabel: 'Pied de page',
		exploreLabel: 'Explorer',
		auditLabel: 'Vérification',
		homeHref: '/fr',
		tagline: `Analytique citoyenne pour ${PROVIDER_NAME}`,
		disclaimer: `Site non officiel, sans affiliation avec ${PROVIDER_NAME}.`,
		liveLabel: 'En direct',
		statusPrefix: 'SYSTÈME',
		links: [
			['Carte', '/fr/map'],
			['Lignes', '/fr/lines'],
			['Arrêts', '/fr/stops'],
			['Réseau', '/fr/network'],
			['Comment on mesure', '/fr/metrics'],
			['Santé des données', '/fr/status'],
			['Points chauds', '/fr/hotspots'],
			['Reçu quotidien', '/fr/receipt'],
			['Récidivistes', '/fr/repeat-offenders'],
			['Avis', '/fr/alerts'],
		],
	},
	{
		locale: 'en' as const,
		navLabel: 'Footer',
		exploreLabel: 'Explore',
		auditLabel: 'Audit',
		homeHref: '/',
		tagline: `Citizen analytics for ${PROVIDER_NAME}`,
		disclaimer: `Unofficial website, not affiliated with ${PROVIDER_NAME}.`,
		liveLabel: 'Live',
		statusPrefix: 'SYSTEM',
		links: [
			['Map', '/map'],
			['Lines', '/lines'],
			['Stops', '/stops'],
			['Network', '/network'],
			['How we measure', '/metrics'],
			['Data health', '/status'],
			['Hotspots', '/hotspots'],
			['Daily receipt', '/receipt'],
			['Repeat offenders', '/repeat-offenders'],
			['Alerts', '/alerts'],
		],
	},
] as const;

afterEach(() => vi.useRealTimers());

describe('Footer', () => {
	it.each(localeCases)(
		'renders the brand and two localized navigation groups in canonical order',
		({ locale, navLabel, exploreLabel, auditLabel, homeHref, tagline, links }) => {
			const { getByTestId, getByRole, getByText } = render(Footer, {
				props: {
					locale,
					attribution: MANIFEST_ATTRIBUTION,
					providerName: PROVIDER_NAME,
				},
			});

			const footer = getByTestId('footer');
			const parentBrand = footer.querySelector('[data-slot="brand-wordmark"]');
			expect(parentBrand).toHaveTextContent('yesid.');
			expect(parentBrand).toHaveAttribute('href', 'https://yesid.dev');
			expect(within(footer).getByRole('link', { name: 'transit' })).toHaveAttribute(
				'href',
				homeHref,
			);
			expect(getByText(tagline)).toBeInTheDocument();

			const nav = getByRole('navigation', { name: navLabel });
			expect(within(footer).getAllByRole('navigation')).toHaveLength(1);
			const explore = within(nav).getByRole('group', { name: exploreLabel });
			const audit = within(nav).getByRole('group', { name: auditLabel });
			expect(nav.querySelectorAll('[role="group"]')).toHaveLength(2);
			expect(explore).not.toBe(audit);
			expect(
				Array.from(explore.querySelectorAll('a'), (link) => [
					link.textContent?.trim(),
					link.getAttribute('href'),
				]),
			).toEqual(links.slice(0, 4));
			expect(
				Array.from(audit.querySelectorAll('a'), (link) => [
					link.textContent?.trim(),
					link.getAttribute('href'),
				]),
			).toEqual(links.slice(4));

			// The house link belongs to BrandCluster, not a third CONNECT group.
			const houseLinks = footer.querySelectorAll('a[href="https://yesid.dev"]');
			expect(houseLinks).toHaveLength(1);
			expect(houseLinks[0]).toHaveAttribute('target', '_blank');
			expect(houseLinks[0]).toHaveAttribute('rel', 'noopener noreferrer');
		},
	);

	it.each(localeCases)(
		'renders the verbatim attribution, $locale disclaimer, StatusDot, and system date',
		({ locale, disclaimer, liveLabel, statusPrefix }) => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date(2026, 6, 30, 12, 0, 0));

			const { getByTestId } = render(Footer, {
				props: {
					locale,
					attribution: MANIFEST_ATTRIBUTION,
					providerName: PROVIDER_NAME,
				},
			});

			const footer = getByTestId('footer');
			const attribution = footer.querySelector('.footer-honesty > span:first-child');
			expect(attribution?.textContent).toBe(MANIFEST_ATTRIBUTION);
			expect(footer.querySelector('.footer-disclaimer')?.textContent).toBe(disclaimer);

			const statusDot = footer.querySelector('[data-slot="status-dot"]');
			expect(statusDot).toBeInTheDocument();
			expect(statusDot).toHaveClass('led-pulse');
			expect(statusDot?.querySelector('.sr-only')).toHaveTextContent(liveLabel);
			expect(statusDot?.parentElement).toHaveTextContent(`${statusPrefix} 2026.07.30`);
		},
	);

	it('keeps the status border on --border-strong and the footer on the safe-area inset', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/Footer.svelte'),
			'utf-8',
		);
		const statusRule = source.match(/\.footer-status-border\s*\{([^}]*)\}/)?.[1] ?? '';

		expect(source).toMatch(/class="footer-status-border [^"]+"/);
		expect(statusRule).toContain('border-top: 2px solid var(--border-strong);');
		expect(statusRule).not.toContain('--border-rule-accent');
		expect(source).toMatch(
			/footer\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\);/,
		);
	});
});

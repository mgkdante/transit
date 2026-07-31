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
		exploreLabel: 'Explorer',
		auditLabel: 'Vérification',
		legalLabel: 'Juridique',
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
			['Confidentialité', '/fr/privacy'],
			['Conditions d’utilisation', '/fr/terms'],
		],
	},
	{
		locale: 'en' as const,
		exploreLabel: 'Explore',
		auditLabel: 'Audit',
		legalLabel: 'Legal',
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
			['Privacy', '/privacy'],
			['Terms', '/terms'],
		],
	},
] as const;

function resolveCssColor(value: string): string {
	const probe = document.createElement('span');
	probe.style.color = value;
	document.body.append(probe);
	const resolvedColor = getComputedStyle(probe).color;
	probe.remove();
	return resolvedColor;
}

afterEach(() => {
	vi.useRealTimers();
	document.documentElement.removeAttribute('data-theme');
	document.documentElement.style.removeProperty('--line-amber');
	document.documentElement.style.removeProperty('--border-rule-accent');
	document.documentElement.style.removeProperty('--border-strong');
});

describe('Footer', () => {
	it.each(localeCases)(
		'renders the brand and three localized navigation landmarks in canonical order',
		({ locale, exploreLabel, auditLabel, legalLabel, homeHref, tagline, links }) => {
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
			const wordmark = getByTestId('footer-wordmark');
			expect(wordmark).toHaveTextContent('transit');
			expect(wordmark).toHaveAttribute('href', homeHref);
			expect(wordmark).toHaveClass('text-2xl');
			expect(getByText(tagline)).toHaveClass('mt-2', 'text-xs');

			const explore = getByRole('navigation', { name: exploreLabel });
			const audit = getByRole('navigation', { name: auditLabel });
			const legal = getByRole('navigation', { name: legalLabel });
			expect(within(footer).getAllByRole('navigation')).toEqual([explore, audit, legal]);
			expect(explore).not.toBe(audit);
			expect(legal).not.toBe(audit);
			expect(legal).toHaveAttribute('data-testid', 'footer-legal');
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
			).toEqual(links.slice(4, 10));
			expect(
				Array.from(legal.querySelectorAll('a'), (link) => [
					link.textContent?.trim(),
					link.getAttribute('href'),
				]),
			).toEqual(links.slice(10));

			for (const nav of [explore, audit, legal]) {
				const group = nav.querySelector<HTMLElement>('[data-slot="footer-group"]');
				expect(group).not.toBeNull();
				expect(group?.style.getPropertyValue('--size-tap-min')).toBe('0px');
			}

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

	it('uses the yesid.dev full-bleed grid and responsive row padding', () => {
		const { getByTestId } = render(Footer, {
			props: {
				locale: 'fr',
				attribution: MANIFEST_ATTRIBUTION,
				providerName: PROVIDER_NAME,
			},
		});

		const footer = getByTestId('footer');
		const grid = footer.querySelector<HTMLElement>(':scope > .grid');
		expect(grid).not.toBeNull();
		expect(grid).toHaveClass(
			'grid',
			'w-full',
			'grid-cols-1',
			'gap-10',
			'px-6',
			'pb-8',
			'pt-10',
			'sm:grid-cols-2',
			'sm:px-10',
			'sm:pt-12',
			'lg:grid-cols-[1.5fr_1fr_1fr_1fr]',
			'lg:gap-8',
			'lg:px-16',
			'lg:pt-14',
		);
		expect(grid).not.toHaveClass('mx-auto', 'max-w-5xl');

		const status = footer.querySelector<HTMLElement>('.footer-status-border');
		expect(status).not.toBeNull();
		expect(status).toHaveClass('w-full', 'px-6', 'sm:px-10', 'lg:px-16');
		expect(status).not.toHaveClass('mx-auto', 'max-w-5xl');
	});

	it.each([
		{ theme: 'dark', lineAmber: '#FFB627', borderStrong: '#4A4A4A' },
		{ theme: 'light', lineAmber: '#B57F00', borderStrong: '#1C1814' },
	] as const)(
		'resolves the $theme status divider to the theme --line-amber value',
		({ theme, lineAmber: expectedLineAmber, borderStrong }) => {
			document.documentElement.dataset.theme = theme;
			document.documentElement.style.setProperty('--line-amber', expectedLineAmber);
			document.documentElement.style.setProperty('--border-rule-accent', 'var(--line-amber)');
			document.documentElement.style.setProperty('--border-strong', borderStrong);
			const source = readFileSync(
				resolve(process.cwd(), 'src/lib/components/layout/Footer.svelte'),
				'utf-8',
			);
			const statusRule = source.match(/\.footer-status-border\s*\{([^}]*)\}/)?.[1] ?? '';
			const componentStyle = document.createElement('style');
			componentStyle.textContent = `.footer-status-border { ${statusRule} }`;
			document.head.append(componentStyle);

			try {
				const { getByTestId } = render(Footer, {
					props: {
						locale: 'fr',
						attribution: MANIFEST_ATTRIBUTION,
						providerName: PROVIDER_NAME,
					},
				});

				const status = getByTestId('footer').querySelector<HTMLElement>('.footer-status-border');
				expect(status).not.toBeNull();

				const rootStyle = getComputedStyle(document.documentElement);
				const lineAmber = rootStyle.getPropertyValue('--line-amber').trim();
				expect(lineAmber).not.toBe('');

				// Owner directive: "EXACTLY like yesid.dev full bleed. same divider color same layout etc".
				const statusStyle = getComputedStyle(status!);
				expect(statusStyle.borderTopWidth).toBe('2px');
				expect(resolveCssColor(statusStyle.borderTopColor)).toBe(resolveCssColor(lineAmber));
			} finally {
				componentStyle.remove();
			}
		},
	);

	it('keeps the safe-area inset and Transit reduced-motion guard', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/layout/Footer.svelte'),
			'utf-8',
		);

		expect(source).toMatch(
			/footer\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\);/,
		);
		expect(source).toMatch(
			/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*:global\(\[data-slot='footer-link'\]\)\s*\{[^}]*transition:\s*none;/,
		);
	});
});

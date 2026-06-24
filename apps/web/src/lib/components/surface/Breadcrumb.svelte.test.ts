import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Breadcrumb from './Breadcrumb.svelte';
import type { BreadcrumbTrailItem } from '$lib/seo/routeSeo';

// A representative /lines/161 trail (delocalized paths — the contract of
// resolveBreadcrumbTrail; the component localizes each href).
const trail: BreadcrumbTrailItem[] = [
	{ name: 'Home', path: '/' },
	{ name: 'Lines', path: '/lines' },
	{ name: '161', path: '/lines/161' },
];

describe('Breadcrumb', () => {
	it('renders a labelled nav with every crumb', () => {
		render(Breadcrumb, { props: { trail, locale: 'en' } });
		const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
		expect(nav).toBeInTheDocument();
		expect(screen.getByText('Home')).toBeInTheDocument();
		expect(screen.getByText('Lines')).toBeInTheDocument();
		expect(screen.getByText('161')).toBeInTheDocument();
	});

	it('renders the LAST crumb as plain text with aria-current="page" (not a link)', () => {
		render(Breadcrumb, { props: { trail, locale: 'en' } });
		const leaf = screen.getByText('161');
		expect(leaf).toHaveAttribute('aria-current', 'page');
		// The leaf is NOT a link.
		expect(screen.queryByRole('link', { name: '161' })).toBeNull();
	});

	it('links the intermediate crumbs with localized EN hrefs (no prefix)', () => {
		render(Breadcrumb, { props: { trail, locale: 'en' } });
		expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
		expect(screen.getByRole('link', { name: 'Lines' })).toHaveAttribute('href', '/lines');
	});

	it('localizes hrefs with the /fr prefix in French', () => {
		render(Breadcrumb, { props: { trail, locale: 'fr' } });
		const nav = screen.getByRole('navigation', { name: "Fil d'Ariane" });
		expect(nav).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/fr');
		expect(screen.getByRole('link', { name: 'Lines' })).toHaveAttribute('href', '/fr/lines');
	});

	it('renders nothing when the trail has one crumb or fewer (no orphan breadcrumb)', () => {
		const { container } = render(Breadcrumb, {
			props: { trail: [{ name: 'Home', path: '/' }], locale: 'en' },
		});
		expect(container.querySelector('[data-slot="breadcrumb"]')).toBeNull();
	});
});

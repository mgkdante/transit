import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import TopBar from './TopBar.svelte';

describe('TopBar search results', () => {
	it('renders selectable grouped chrome search results', async () => {
		const onresultselect = vi.fn();
		const { getByRole } = render(TopBar, {
			props: {
				locale: 'en',
				search: '161',
				searchResults: [
					{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 },
					{ kind: 'vehicle', id: '40061', label: '40061', meta: 'Route 161', priority: 20 },
					{
						kind: 'address',
						id: '45.525686,-73.594764',
						label: '5333 Avenue Casgrain, Montréal, Quebec',
						meta: 'Address',
						priority: 30,
						lat: 45.5256864,
						lon: -73.5947644,
					},
				],
				onresultselect,
			},
		});

		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toHaveTextContent('Route');
		expect(getByRole('button', { name: 'Bus 40061 Route 161' })).toHaveTextContent('Bus');
		expect(
			getByRole('button', {
				name: 'Address 5333 Avenue Casgrain, Montréal, Quebec Address',
			}),
		).toHaveTextContent('Address');

		await fireEvent.click(getByRole('button', { name: 'Route 161 Van Horne' }));

		expect(onresultselect).toHaveBeenCalledWith({
			kind: 'route',
			id: '161',
			label: '161 Van Horne',
			priority: 0,
		});
	});

	it('lets browser address autofill assist the chrome search inputs', async () => {
		const { container, getByRole } = render(TopBar, {
			props: { locale: 'en' },
		});

		expect(getByRole('searchbox', { name: 'Search the network' })).toHaveAttribute(
			'autocomplete',
			'street-address',
		);

		await fireEvent.click(getByRole('button', { name: 'Open search' }));

		const mobileSearch = within(container).getByTestId('topbar-mobile-search');
		expect(within(mobileSearch).getByRole('searchbox', { name: 'Search the network' })).toHaveAttribute(
			'autocomplete',
			'street-address',
		);
	});

	it('opens a focused mobile search surface from the search icon', async () => {
		const { container, getByRole, queryByTestId } = render(TopBar, {
			props: { locale: 'en' },
		});

		expect(queryByTestId('topbar-mobile-search')).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Open search' }));

		const mobileSearch = within(container).getByTestId('topbar-mobile-search');
		const input = mobileSearch.querySelector<HTMLInputElement>(
			'[data-slot="topbar-mobile-search-input"]',
		);

		expect(input).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(input));
	});

	it('closes the mobile search surface after selecting a result', async () => {
		const onresultselect = vi.fn();
		const { getByRole, queryByTestId } = render(TopBar, {
			props: {
				locale: 'en',
				search: '161',
				searchResults: [{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 }],
				onresultselect,
			},
		});

		await fireEvent.click(getByRole('button', { name: 'Open search' }));

		const mobileSearch = within(queryByTestId('topbar-mobile-search') as HTMLElement);
		await fireEvent.click(mobileSearch.getByRole('button', { name: 'Route 161 Van Horne' }));

		expect(onresultselect).toHaveBeenCalledWith({
			kind: 'route',
			id: '161',
			label: '161 Van Horne',
			priority: 0,
		});
		expect(queryByTestId('topbar-mobile-search')).not.toBeInTheDocument();
	});

	it('closes desktop search suggestions when the user clicks outside', async () => {
		const { getByRole, queryByRole } = render(TopBar, {
			props: {
				locale: 'en',
				search: 'casgrain',
				searchResults: [
					{
						kind: 'address',
						id: 'google:casgrain',
						label: '5333 Avenue Casgrain, Montréal, Quebec',
						meta: 'Address',
						priority: 30,
					},
				],
			},
		});

		expect(getByRole('button', { name: 'Address 5333 Avenue Casgrain, Montréal, Quebec Address' })).toBeInTheDocument();

		await fireEvent.pointerDown(document.body);

		expect(queryByRole('button', { name: 'Address 5333 Avenue Casgrain, Montréal, Quebec Address' })).not.toBeInTheDocument();
	});

	it('gives long address search suggestions room to wrap', () => {
		const source = readSource();

		expect(source).toContain('let searchResultsOpen = $state(true)');
		expect(source).toContain('<svelte:window onkeydown={onKeydown} onpointerdown={onWindowPointerDown} />');
		expect(source).toMatch(/\.topbar-search-results\s*\{[\s\S]*width:\s*min\(max\(100%, 38rem\)/);
		expect(source).toMatch(/\.topbar-search-label\s*\{[\s\S]*white-space:\s*normal/);
		expect(source).toMatch(/\.topbar-search-result\s*\{[\s\S]*align-items:\s*flex-start/);
	});

	it('opens a future mobile navigation menu with the yesid house link externalized', async () => {
		const { getByRole, queryByTestId } = render(TopBar, {
			props: { locale: 'en' },
		});

		expect(queryByTestId('topbar-mobile-menu')).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Open menu' }));

		const menu = queryByTestId('topbar-mobile-menu') as HTMLElement;
		expect(menu).toBeInTheDocument();
		const yesid = within(menu).getByRole('link', { name: 'yesid.' });
		expect(yesid).toHaveAttribute('href', 'https://yesid.dev');
		expect(yesid).toHaveAttribute('target', '_blank');
		expect(yesid).toHaveAttribute('rel', 'noopener noreferrer');

		await fireEvent.click(getByRole('button', { name: 'Close menu' }));
		expect(queryByTestId('topbar-mobile-menu')).not.toBeInTheDocument();
	});

	it('uses a mobile-only compact navigation menu without duplicating the desktop rail', () => {
		const source = readSource();

		expect(source).toContain('class="topbar-brand-mark"');
		expect(source).toMatch(/class="tap-press topbar-menu-toggle md:hidden"/);
		expect(source).toMatch(/\.topbar-mobile-menu\s*\{[\s\S]*position:\s*absolute/);
		expect(source).toMatch(/\.topbar-mobile-menu\s*\{[\s\S]*right:\s*0\.75rem/);
		expect(source).toMatch(/\.topbar-mobile-menu\s*\{[\s\S]*width:\s*min\(19rem, calc\(100vw - 1\.5rem\)\)/);
		expect(source).not.toContain('class="topbar-mobile-menu-content"');
		expect(source).not.toContain('class="topbar-mobile-menu-stop');
		expect(source).not.toContain('class="topbar-mobile-menu-line');
		expect(source).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.topbar-brand-mark\s*\{[\s\S]*display:\s*none/);
		expect(source).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.topbar-divider\s*\{[\s\S]*display:\s*none/);
		expect(source).not.toMatch(/\.topbar-mobile-menu\s*\{[\s\S]*position:\s*fixed[\s\S]*inset:\s*0/);
		expect(source).toMatch(/\.topbar-mobile-house-wordmark\s*\{[\s\S]*display:\s*inline-flex[\s\S]*white-space:\s*nowrap/);
		expect(source).not.toMatch(/@media \(max-width:\s*400px\)[\s\S]*\.topbar-product\s*\{[\s\S]*display:\s*none/);
		expect(source).toContain('data-slot="topbar-mobile-menu-toggle"');
	});
});

function readSource(): string {
	return readFileSync(resolve(process.cwd(), 'src/lib/components/shell/TopBar.svelte'), 'utf-8');
}

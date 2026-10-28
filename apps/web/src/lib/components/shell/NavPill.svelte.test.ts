import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromeSearchResults } from '$lib/search/chromeSearch';
import { TRANSIT_MODE_FILTERS, type TransitModeKey } from '$lib/search/stopMode';
import type { RouteIndexEntry } from '$lib/v1/schemas';
import NavPill from './NavPill.svelte';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/navigation', () => ({
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn(),
	afterNavigate: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

describe('NavPill — search', () => {
	it.each([
		['en', 'Your searches are sent to our server and the Government of Canada Geo.ca service.'],
		[
			'fr',
			'Vos recherches sont envoyées à notre serveur et au service Géo.ca du gouvernement du Canada.',
		],
	] as const)(
		'renders the %s chrome collection notice beside the search input',
		(locale, notice) => {
			const { getByRole } = render(NavPill, { props: { locale } });
			const search = getByRole('search');
			const nodes = within(search).getAllByText(notice);
			expect(nodes).toHaveLength(2);
			const target = nodes.find((n) => n.id === 'nav-search-notice');
			expect(target).toHaveClass('sr-only');
			expect(nodes.find((n) => n !== target)).toHaveAttribute('aria-hidden', 'true');
			expect(within(search).getByRole('searchbox')).toBeInTheDocument();
		},
	);

	it('renders selectable grouped chrome search results and fires select', async () => {
		const onresultselect = vi.fn();
		const { getByRole } = render(NavPill, {
			props: {
				locale: 'en',
				search: '161',
				searchResults: [
					{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 },
					{ kind: 'vehicle', id: '40061', label: '40061', meta: 'Route 161', priority: 20 },
				],
				onresultselect,
			},
		});

		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toHaveTextContent('Route');
		await fireEvent.click(getByRole('button', { name: 'Route 161 Van Horne' }));
		expect(onresultselect).toHaveBeenCalledWith({
			kind: 'route',
			id: '161',
			label: '161 Van Horne',
			priority: 0,
		});
	});

	it('turns browser autofill off on the in-pill search box', () => {
		const { getByRole } = render(NavPill, { props: { locale: 'en' } });
		const searchbox = getByRole('searchbox', { name: 'Search the network' });
		expect(searchbox).toHaveAttribute('autocomplete', 'off');
		expect(searchbox).toHaveAttribute('name', 'network-search');
	});

	it('scopes the search placeholder + aria-label to the line catalogue', () => {
		const { getByRole } = render(NavPill, { props: { locale: 'en', searchScope: 'route' } });
		expect(getByRole('searchbox', { name: 'Search a line' })).toHaveAttribute(
			'placeholder',
			'Search a line…',
		);
	});

	it('shows the collection notice only where searches actually transmit (S5-377 B3)', () => {
		for (const searchScope of ['map', 'all'] as const) {
			const { getAllByText, getByRole, unmount } = render(NavPill, {
				props: { locale: 'en', searchScope },
			});
			const notices = getAllByText(
				'Your searches are sent to our server and the Government of Canada Geo.ca service.',
			);
			expect(notices).toHaveLength(2);
			const target = notices.find((n) => n.id === 'nav-search-notice');
			expect(target).toBeDefined();
			expect(target).toHaveClass('sr-only');
			expect(notices.find((n) => n !== target)).toHaveAttribute('aria-hidden', 'true');
			expect(getByRole('searchbox', { name: 'Search the network' })).toHaveAttribute(
				'aria-describedby',
				'nav-search-notice',
			);
			unmount();
		}
		for (const searchScope of ['route', 'stop'] as const) {
			const { queryByText, getByRole, unmount } = render(NavPill, {
				props: { locale: 'en', searchScope },
			});
			expect(queryByText(/searches are sent/i)).toBeNull();
			expect(getByRole('searchbox')).not.toHaveAttribute('aria-describedby');
			unmount();
		}
	});

	it('closes desktop search suggestions when the user clicks outside', async () => {
		const { getByRole, queryByRole } = render(NavPill, {
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

		expect(
			getByRole('button', { name: 'Address 5333 Avenue Casgrain, Montréal, Quebec Address' }),
		).toBeInTheDocument();

		await fireEvent.pointerDown(document.body);

		await waitFor(() =>
			expect(
				queryByRole('button', {
					name: 'Address 5333 Avenue Casgrain, Montréal, Quebec Address',
				}),
			).not.toBeInTheDocument(),
		);
	});
});
const NOTICE_EN =
	'Your searches are sent to our server and the Government of Canada Geo.ca service.';

function renderWithResults() {
	return render(NavPill, {
		props: {
			locale: 'en',
			search: '161',
			searchScope: 'all',
			searchResults: [{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 }],
		},
	});
}

describe('NavPill — the focus dropdown that houses the disclosure (M6i F25/F26)', () => {
	it('parks the visible disclosure inside that dropdown, ahead of the results', () => {
		const { getByRole } = renderWithResults();
		const form = getByRole('search');
		const panel = form.querySelector<HTMLElement>('[data-slot="nav-search-panel"]');
		expect(panel).not.toBeNull();

		const notice = within(panel!).getByText(NOTICE_EN);
		expect(notice).toHaveAttribute('aria-hidden', 'true');
		const results = panel!.querySelector('.nav-search-results');
		expect(results).not.toBeNull();
		expect(
			notice.compareDocumentPosition(results!) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		expect(document.querySelectorAll('#nav-search-notice')).toHaveLength(1);
		expect(panel!.querySelector('#nav-search-notice')).toBeNull();
	});

	it('carries the search page scope + mode filters in the dropdown (F26)', () => {
		const { getByRole } = renderWithResults();
		const panel = getByRole('search').querySelector<HTMLElement>('[data-slot="nav-search-panel"]');
		expect(panel).not.toBeNull();
		expect(within(panel!).getByRole('radiogroup', { name: 'Show' })).toBeInTheDocument();
		for (const mode of ['Métro', 'Tram', 'Bus', 'Train', 'Ferry']) {
			expect(within(panel!).getByRole('button', { name: mode })).toBeInTheDocument();
		}
		expect(document.querySelectorAll('form[role="search"]')).toHaveLength(1);
	});

	it('narrows the visible results when a dropdown scope segment is picked', async () => {
		const { getByRole, queryByRole } = render(NavPill, {
			props: {
				locale: 'en',
				search: 'van horne',
				searchScope: 'all',
				searchResults: [
					{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 },
					{ kind: 'stop', id: '57191', label: 'Van Horne / Rockland', meta: '57191', priority: 4 },
				],
			},
		});
		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toBeInTheDocument();
		expect(getByRole('button', { name: /Stop Van Horne \/ Rockland/ })).toBeInTheDocument();

		await fireEvent.click(getByRole('radio', { name: /Lines \(1\)/ }));

		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toBeInTheDocument();
		expect(queryByRole('button', { name: /Stop Van Horne \/ Rockland/ })).toBeNull();
	});

	it('drops the family narrowing when navigation leaves the mixed blend (REGATE-m6i §5b)', async () => {
		const route161 = { kind: 'route', id: '161', label: '161 Van Horne', priority: 0 } as const;
		const stop57191 = {
			kind: 'stop',
			id: '57191',
			label: 'Van Horne / Rockland',
			meta: '57191',
			priority: 4,
		} as const;
		const { getByRole, queryByRole, rerender, container } = render(NavPill, {
			props: {
				locale: 'en',
				search: 'van horne',
				searchScope: 'all',
				searchResults: [route161, stop57191],
			},
		});
		await fireEvent.click(getByRole('radio', { name: /Stops \(1\)/ }));
		expect(getByRole('button', { name: /Stop Van Horne \/ Rockland/ })).toBeInTheDocument();
		expect(queryByRole('button', { name: 'Route 161 Van Horne' })).toBeNull();

		await rerender({
			locale: 'en',
			search: 'van horne',
			searchScope: 'route',
			searchResults: [route161],
		});

		expect(container.querySelector('[data-slot="search-controls"]')).toBeNull();
		expect(queryByRole('radiogroup', { name: 'Show' })).toBeNull();
		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toBeInTheDocument();

		await rerender({
			locale: 'en',
			search: 'van horne',
			searchScope: 'all',
			searchResults: [route161, stop57191],
		});
		expect(getByRole('radio', { name: 'All' })).toBeChecked();
		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toBeInTheDocument();
		expect(getByRole('button', { name: /Stop Van Horne \/ Rockland/ })).toBeInTheDocument();
	});

	it('clears the mode set the moment its chips have no surface — no control, no narrowing (REGATE-m6i §5c)', async () => {
		const modes = new SvelteSet<TransitModeKey>(['metro']);
		const routes: RouteIndexEntry[] = [{ id: '161', short: '161', long: 'Van Horne', type: 3 }];
		expect(chromeSearchResults('161', { routes }, { scope: 'route', modes })).toEqual([]);

		const { container } = render(NavPill, {
			props: {
				locale: 'en',
				search: '161',
				searchScope: 'route',
				searchResults: [],
				searchModes: modes,
			},
		});
		await tick();

		expect(container.querySelector('[data-slot="search-controls"]')).toBeNull();
		for (const chip of TRANSIT_MODE_FILTERS) {
			expect(
				within(container).queryByRole('button', { name: chip.tag, pressed: false }),
			).toBeNull();
		}
		expect(modes.size).toBe(0);
		expect(
			chromeSearchResults('161', { routes }, { scope: 'route', modes }).map((r) => r.id),
		).toEqual(['161']);
	});

	it('keeps a picked mode while its chips are on screen (mixed scope)', async () => {
		const modes = new SvelteSet<TransitModeKey>();
		const { getByRole } = render(NavPill, {
			props: {
				locale: 'en',
				search: '161',
				searchScope: 'all',
				searchResults: [{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 }],
				searchModes: modes,
			},
		});
		await fireEvent.click(getByRole('button', { name: 'Métro' }));
		expect(modes.size).toBe(1);
	});

	it('omits the filter row where the blend is already one family (honesty)', () => {
		const { getByRole } = render(NavPill, {
			props: {
				locale: 'en',
				searchScope: 'route',
				search: '161',
				searchResults: [{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 }],
			},
		});
		const panel = getByRole('search').querySelector<HTMLElement>('[data-slot="nav-search-panel"]');
		expect(panel).not.toBeNull();
		expect(within(panel!).queryByRole('radiogroup', { name: 'Show' })).toBeNull();
		expect(within(panel!).queryByRole('button', { name: 'Métro' })).toBeNull();
		expect(panel!.querySelector('[data-slot="search-controls"]')).toBeNull();
	});
});

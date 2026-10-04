import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';
import Page from './+page.svelte';

const { state, createLiveStoreSpy } = vi.hoisted(() => ({
	state: { locale: 'en' as 'en' | 'fr', desktop: true, city: 'Montréal' },
	createLiveStoreSpy: vi.fn(),
}));
vi.mock('$lib/i18n', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/i18n')>()),
	getLocale: () => state.locale,
}));
vi.mock('$lib/nav', async () => {
	const { routeFor } =
		await vi.importActual<typeof import('$lib/nav/intent.svelte')>('$lib/nav/intent.svelte');
	return { routeFor };
});
vi.mock('$lib/nav/layout.svelte', () => ({
	layout: {
		get isDesktop() {
			return state.desktop;
		},
	},
}));
vi.mock('$lib/v1/live/store.svelte', () => ({ createLiveStore: createLiveStoreSpy }));

function pageData() {
	const label = { city: state.city, operator: 'Fixture Transit' };
	return {
		provider: { id: 'fixture', labels: { en: label, fr: label }, inputs: {}, alert_links: {} },
		v1: null,
	};
}

function renderHome() {
	return render(Page, { props: { data: pageData() } });
}

const destinations = [
	['/network', 'Network health', 'Santé du réseau'],
	['/map', 'Network map', 'Carte du réseau'],
	['/stops', 'Stops', 'Arrêts'],
	['/search', 'Search', 'Rechercher'],
	['/lines', 'Lines', 'Lignes'],
	['/hotspots', 'Hotspots', 'Points chauds'],
	['/receipt', 'Daily receipt', 'Reçu quotidien'],
	['/repeat-offenders', 'Repeat offenders', 'Récidivistes'],
	['/alerts', 'Alerts', 'Avis'],
	['/metrics', 'How we measure', 'Comment on mesure'],
	['/status', 'Data health', 'Santé des données'],
] as const;
const nav = () =>
	screen.getByRole('navigation', {
		name: state.locale === 'fr' ? 'Tout explorer' : 'Explore everything',
	});

afterEach(() => {
	state.locale = 'en';
	state.desktop = true;
	state.city = 'Montréal';
	createLiveStoreSpy.mockClear();
});

describe('Home civic overview and directory', () => {
	it.each(['en', 'fr'] as const)(
		'uses the selected city in the %s heading and kicker',
		(locale) => {
			state.locale = locale;
			state.city = 'Ottawa';
			const { container } = renderHome();
			expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ottawa');
			expect(container.querySelector('.home-kicker')).toHaveTextContent('Ottawa');
			expect(container).not.toHaveTextContent('Montréal');
		},
	);
	it.each(['en', 'fr'] as const)(
		'preserves every destination once as a native localized link in %s',
		(locale) => {
			state.locale = locale;
			renderHome();
			const links = within(nav()).getAllByRole('link');
			expect(links).toHaveLength(11);
			for (const [path, en, fr] of destinations) {
				const href = locale === 'fr' ? `/fr${path}` : path;
				const link = links.find((candidate) => candidate.getAttribute('href') === href);
				expect(link, href).toHaveTextContent(locale === 'fr' ? fr : en);
				expect(link).not.toHaveAttribute('tabindex', '-1');
			}
			expect(new Set(links.map((link) => link.getAttribute('href'))).size).toBe(11);
		},
	);

	it('introduces the civic purpose, then the network overview and map, without fetching live data', () => {
		const { container } = renderHome();
		expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
			'How Montréal’s transit holds up.',
		);
		expect(container.querySelector('[data-slot="home-audit-brief"]')).toHaveTextContent(
			'the limits of public data',
		);
		const primary = container.querySelector('[data-slot="home-primary"]') as HTMLElement;
		expect(
			within(primary)
				.getAllByRole('link')
				.map((link) => link.getAttribute('href')),
		).toEqual(['/network', '/map']);
		expect(nav().firstElementChild).toBe(primary);
		expect(createLiveStoreSpy).not.toHaveBeenCalled();
	});

	it('retains all four question groups while making the remaining directory compact', () => {
		renderHome();
		for (const name of [
			'How is the network running?',
			'Which line can I trust?',
			'Did they keep their promise?',
			'Behind the numbers',
		]) {
			expect(within(nav()).getByRole('heading', { name })).toBeInTheDocument();
		}
	});

	it('filters all destinations by question, including the featured network overview', async () => {
		const { container } = renderHome();
		await fireEvent.click(screen.getByRole('radio', { name: 'Which line can I trust?' }));
		expect(
			within(nav())
				.getAllByRole('link')
				.map((link) => link.getAttribute('href')),
		).toEqual(['/lines', '/network', '/hotspots']);
		expect(container.querySelector('[data-slot="home-primary"]')).toBeNull();
		expect(screen.getAllByText('3 destinations').length).toBeGreaterThan(0);
	});

	it('keeps answer-kind filtering and restores the full composition on clear', async () => {
		renderHome();
		await fireEvent.click(screen.getByRole('radio', { name: 'The record' }));
		expect(
			within(nav())
				.getAllByRole('link')
				.map((link) => link.getAttribute('href')),
		).toEqual(['/lines', '/hotspots', '/receipt', '/repeat-offenders']);
		await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
		expect(within(nav()).getAllByRole('link')).toHaveLength(11);
	});

	it('keeps the exact question and kind intersection for a single result', async () => {
		renderHome();
		await fireEvent.click(screen.getByRole('radio', { name: 'Which line can I trust?' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Live now' }));
		expect(within(nav()).getAllByRole('link')).toHaveLength(1);
		expect(within(nav()).getByRole('link')).toHaveAttribute('href', '/network');
	});

	it.each(['en', 'fr'] as const)(
		'announces an empty intersection with direct recovery in %s',
		async (locale) => {
			state.locale = locale;
			renderHome();
			await fireEvent.click(
				screen.getByRole('radio', {
					name: locale === 'fr' ? 'Comment va le réseau ?' : 'How is the network running?',
				}),
			);
			await fireEvent.click(
				screen.getByRole('radio', { name: locale === 'fr' ? 'Le bilan' : 'The record' }),
			);
			const status = screen.getByRole('status');
			expect(status).toHaveAttribute('aria-live', 'polite');
			expect(within(nav()).queryAllByRole('link')).toHaveLength(0);
			await fireEvent.click(
				within(status).getByRole('button', {
					name: locale === 'fr' ? 'Effacer les filtres' : 'Clear filters',
				}),
			);
			expect(within(nav()).getAllByRole('link')).toHaveLength(11);
		},
	);

	it('keeps the same native disclosure available on desktop', async () => {
		const { container } = renderHome();
		const details = container.querySelector('details') as HTMLDetailsElement;
		await vi.waitFor(() => expect(details.open).toBe(true));
		details.open = false;
		await fireEvent(details, new Event('toggle'));
		expect(details.open).toBe(false);
		expect(details.querySelector('summary')).toHaveTextContent('Filters');
	});

	it('preserves arrow-key movement in the question filter', async () => {
		renderHome();
		const all = within(screen.getByRole('group', { name: 'By question' })).getByRole('radio', {
			name: 'All',
		});
		await fireEvent.keyDown(all, { key: 'ArrowDown' });
		expect(screen.getByRole('radio', { name: 'How is the network running?' })).toHaveFocus();
	});

	it('keeps one inline mobile filter tree and restores its disclosure focus on Escape', async () => {
		state.desktop = false;
		const { container } = renderHome();
		const details = container.querySelector('details') as HTMLDetailsElement;
		const summary = details.querySelector('summary') as HTMLElement;
		expect(details.open).toBe(false);
		details.open = true;
		await fireEvent(details, new Event('toggle'));
		screen.getByRole('radio', { name: 'The record' }).focus();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(details.open).toBe(false);
		expect(summary).toHaveFocus();
		expect(container.querySelectorAll('.explore-filters')).toHaveLength(1);
		expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();
	});

	it('server-renders every navigation href and the civic heading without hydration', async () => {
		const server = await createServer({
			configFile: 'vite.config.ts',
			appType: 'custom',
			logLevel: 'silent',
			optimizeDeps: { noDiscovery: true },
			server: { middlewareMode: true },
		});
		try {
			const module = await server.ssrLoadModule('/src/routes/[[lang=locale]]/+page.svelte');
			const { render: renderSsr } = (await server.ssrLoadModule(
				'svelte/server',
			)) as typeof import('svelte/server');
			const context = new Map<unknown, unknown>([
				[Symbol.for('transit.i18n.locale'), () => 'en' as const],
			]);
			const { body } = renderSsr(module.default, { context, props: { data: pageData() } });
			expect(body).toContain('How Montréal’s');
			expect(body).toContain('the limits of public data');
			for (const [href] of destinations) expect(body).toContain(`href="${href}"`);
		} finally {
			await server.close();
		}
	}, 20_000);
});

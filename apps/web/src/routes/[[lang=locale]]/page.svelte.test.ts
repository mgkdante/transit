import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, type AST } from 'svelte/compiler';
import { createServer } from 'vite';
import Page from './+page.svelte';

const { state, createLiveStoreSpy } = vi.hoisted(() => ({
	state: { locale: 'en' as 'en' | 'fr' },
	createLiveStoreSpy: vi.fn(),
}));

let homeIntersectionCallback: IntersectionObserverCallback | undefined;

class HomeIntersectionObserverStub {
	readonly root = null;
	readonly rootMargin = '0px';
	readonly thresholds = [0];
	constructor(next: IntersectionObserverCallback) {
		homeIntersectionCallback = next;
	}
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

vi.mock('$lib/i18n', async () => ({
	getLocale: () => state.locale,
	localizeHref: (path: string, locale: 'en' | 'fr') =>
		locale === 'fr' ? `/fr${path === '/' ? '' : path}` : path,
}));

vi.mock('$lib/nav', async () => {
	const { routeFor } =
		await vi.importActual<typeof import('$lib/nav/intent.svelte')>('$lib/nav/intent.svelte');
	return { routeFor };
});

vi.mock('$lib/v1/live/store.svelte', () => ({ createLiveStore: createLiveStoreSpy }));

const routePath = resolve(process.cwd(), 'src/routes/[[lang=locale]]/+page.svelte');
const explorePath = resolve(process.cwd(), 'src/lib/features/home/HomeExplore.svelte');

function declarationsFor(source: string, wantedSelector: string): ReadonlyMap<string, string> {
	const css = parse(source, { modern: true }).css;
	if (css == null) return new Map();
	let match = new Map<string, string>();

	function visit(nodes: readonly (AST.CSS.Atrule | AST.CSS.Rule | AST.CSS.Declaration)[]): void {
		for (const node of nodes) {
			if (node.type === 'Atrule') {
				visit(node.block?.children ?? []);
				continue;
			}
			if (node.type !== 'Rule') continue;
			const selectors = node.prelude.children.map((selector) =>
				source.slice(selector.start, selector.end).replace(/\s+/g, ' ').trim(),
			);
			if (!selectors.includes(wantedSelector)) continue;
			match = new Map(
				node.block.children
					.filter((child): child is AST.CSS.Declaration => child.type === 'Declaration')
					.map((child) => [child.property, child.value]),
			);
		}
	}

	visit(css.children);
	return match;
}

afterEach(() => {
	state.locale = 'en';
	createLiveStoreSpy.mockClear();
	homeIntersectionCallback = undefined;
	vi.unstubAllGlobals();
});

describe('Home hub — explore-first contract', () => {
	it('opens on the filterable destination board without a hero or live-store side effect', () => {
		const { container } = render(Page);
		const surface = container.querySelector('[data-slot="surface"]');

		expect(surface).toHaveClass('surface-shell--surface');
		expect(surface?.firstElementChild).toHaveAttribute('data-slot', 'home-explore');
		expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Explore everything');
		expect(container.querySelector('[data-slot="home-hero-intro"]')).toBeNull();
		expect(container.querySelector('[data-slot="home-control-room"]')).toBeNull();
		expect(screen.queryByRole('region', { name: /what this is/i })).toBeNull();
		expect(createLiveStoreSpy).not.toHaveBeenCalled();
	});

	it('keeps the Explore start in normal flow under the shell-owned mobile clearance', () => {
		const routeSource = readFileSync(routePath, 'utf8');
		const rootDeclarations = declarationsFor(readFileSync(explorePath, 'utf8'), '.home-explore');
		const rootValues = [...rootDeclarations.values()].join(' ');

		expect(routeSource).toMatch(/<Surface>\s*<HomeExplore/);
		expect(routeSource).not.toMatch(/surface-bleed|chrome-offset|margin-top/);
		expect(rootDeclarations.get('display')).toBe('flex');
		expect(rootDeclarations.has('position')).toBe(false);
		expect(rootDeclarations.has('top')).toBe(false);
		expect(rootDeclarations.has('margin-top')).toBe(false);
		expect(rootValues).not.toContain('--chrome-offset');
	});
});

describe('Home hub — destination board', () => {
	it('renders every rider-question group and all eleven destinations as native links', () => {
		render(Page);
		const nav = screen.getByRole('navigation', { name: 'Explore everything' });

		for (const heading of [
			'Where’s my bus?',
			'Which line can I trust?',
			'Did they keep their promise?',
			'Behind the numbers',
		]) {
			expect(within(nav).getByRole('heading', { name: heading })).toBeInTheDocument();
		}
		const links = within(nav)
			.getAllByRole('link')
			.filter((link) => link.classList.contains('hub-tile'));
		expect(links).toHaveLength(11);
		expect(
			within(nav)
				.queryAllByRole('button')
				.filter((button) => button.classList.contains('hub-tile')),
		).toHaveLength(0);
	});

	it('keeps the destination links localized and usable without hydration', () => {
		render(Page);
		const nav = screen.getByRole('navigation', { name: 'Explore everything' });
		const linksByHref = new Map(
			within(nav)
				.getAllByRole('link')
				.map((link) => [link.getAttribute('href'), link]),
		);
		const expectedLinks = [
			['Live map', '/map'],
			['Lines', '/lines'],
			['Stops', '/stops'],
			['Network health', '/network'],
			['Search', '/search'],
			['Hotspots', '/hotspots'],
			['Daily receipt', '/receipt'],
			['Repeat offenders', '/repeat-offenders'],
			['Alerts', '/alerts'],
			['How we measure', '/metrics'],
			['Data health', '/status'],
		] as const;

		for (const [name, href] of expectedLinks) {
			const link = linksByHref.get(href);
			expect(link, href).toBeDefined();
			expect(link).toHaveTextContent(name);
		}
	});

	it('filters by rider question', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('radio', { name: 'Which line can I trust?' }));
		const nav = screen.getByRole('navigation', { name: 'Explore everything' });

		expect(within(nav).getAllByRole('link')).toHaveLength(3);
		expect(
			within(nav).getByRole('heading', { name: 'Which line can I trust?' }),
		).toBeInTheDocument();
		expect(within(nav).queryByRole('heading', { name: 'Where’s my bus?' })).toBeNull();
		expect(screen.getAllByText('3 destinations').length).toBeGreaterThanOrEqual(1);
	});

	it('filters by answer kind and clears back to the complete board', async () => {
		render(Page);
		const nav = screen.getByRole('navigation', { name: 'Explore everything' });

		await fireEvent.click(screen.getByRole('radio', { name: 'The record' }));
		expect(within(nav).queryByRole('link', { name: /Live map/i })).toBeNull();
		expect(within(nav).getByRole('link', { name: /Repeat offenders/i })).toBeInTheDocument();
		expect(within(nav).queryByRole('heading', { name: 'Behind the numbers' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
		expect(within(nav).getAllByRole('link')).toHaveLength(11);
		expect(within(nav).getByRole('heading', { name: 'Behind the numbers' })).toBeInTheDocument();
	});

	it('announces an honest empty intersection', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('radio', { name: 'Where’s my bus?' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'The record' }));

		const status = screen.getByRole('status');
		expect(status).toHaveTextContent('Nothing matches these filters');
		expect(status).toHaveAttribute('aria-live', 'polite');
	});

	it('supports keyboard filtering and labels every card with its answer kind', async () => {
		render(Page);
		expect(screen.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
		const questionGroup = screen.getByRole('group', { name: 'By question' });
		expect(screen.getByRole('group', { name: 'By kind' })).toBeInTheDocument();
		const mapTile = screen.getByRole('link', { name: /Live map/i });
		expect(within(mapTile).getByText('Live now')).toBeInTheDocument();
		const receiptTile = screen.getByRole('link', { name: /Daily receipt/i });
		expect(within(receiptTile).getByText('The record')).toBeInTheDocument();
		const allQuestions = within(questionGroup).getByRole('radio', { name: 'All' });
		await fireEvent.keyDown(allQuestions, { key: 'ArrowDown' });
		expect(screen.getByRole('radio', { name: 'Where’s my bus?' })).toHaveFocus();
		expect(screen.getByRole('navigation', { name: 'Explore everything' })).toHaveTextContent(
			'Where’s my bus?',
		);
	});

	it('shows the mobile filter control only while Explore is visible', async () => {
		vi.stubGlobal('IntersectionObserver', HomeIntersectionObserverStub);
		const { container } = render(Page);
		const explore = container.querySelector('[data-slot="home-explore"]') as HTMLElement;

		expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();
		homeIntersectionCallback?.(
			[{ target: explore, isIntersecting: true } as unknown as IntersectionObserverEntry],
			{} as IntersectionObserver,
		);
		await vi.waitFor(() =>
			expect(container.querySelector('[data-slot="surface-rail-mobile"]')).not.toBeNull(),
		);
		expect(screen.getByRole('button', { name: /filters 11 destinations/i })).toBeInTheDocument();

		homeIntersectionCallback?.(
			[{ target: explore, isIntersecting: false } as unknown as IntersectionObserverEntry],
			{} as IntersectionObserver,
		);
		await vi.waitFor(() =>
			expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull(),
		);
	});
});

describe('Home hub — French and SSR', () => {
	it('renders the French heading, filters, groups, and localized links', () => {
		state.locale = 'fr';
		render(Page);

		expect(screen.getByRole('heading', { level: 1, name: 'Tout explorer' })).toBeInTheDocument();
		expect(screen.getByRole('group', { name: 'Par question' })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: 'Le bilan' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Où est mon bus ?' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Ont-ils tenu parole ?' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Santé des données/i })).toHaveAttribute(
			'href',
			'/fr/status',
		);
	});

	it('renders the Explore board through the server compiler without hero data work', async () => {
		const server = await createServer({
			configFile: 'vite.config.ts',
			appType: 'custom',
			logLevel: 'silent',
			optimizeDeps: { noDiscovery: true },
			server: { middlewareMode: true },
		});
		try {
			const pageModule = (await server.ssrLoadModule(
				'/src/routes/[[lang=locale]]/+page.svelte',
			)) as { default: typeof Page };
			const { render: renderSsr } = (await server.ssrLoadModule(
				'svelte/server',
			)) as typeof import('svelte/server');
			const context = new Map<unknown, unknown>();
			context.set(Symbol.for('transit.i18n.locale'), () => 'en' as const);
			const { body } = renderSsr(pageModule.default, { context });

			expect(body).toContain('Explore everything');
			expect(body).toContain('Where’s my bus?');
			expect(body).not.toContain('home-hero-intro');
			expect(body).not.toContain('home-control-room');
		} finally {
			await server.close();
		}
	}, 20_000);
});

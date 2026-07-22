// Home hub page — control-room hero + what-this-is + grouped surface board.
//
// Covers the load-bearing behaviors the redesign introduced:
//   · identity render (display_name from the booted manifest)
//   · the LIVE PULSE honesty contract — stands down to the localized "no data"
//     glyph when the live store is null (SSR / before the first tick / absent
//     live tier), and reads real headline numbers when network.json reports
//   · EXPLORE EVERYTHING wayfinding — all three groups + every surface entry,
//     every destination exposed as a native localized <a> link
//   · bilingual copy (EN + FR) off the same component
//
// The hub reads getV1Context().manifest + createLiveStore + getLocale; we mock
// the exact boot/live leaves (a controllable live network) and $lib/i18n (the
// locale under test) the same way the NetworkHealth surface test does, and
// $lib/nav for routeFor.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, type AST } from 'svelte/compiler';
import { createServer } from 'vite';
import type { NetworkFile } from '$lib/v1';
import type { IsoUtc } from '$lib/v1/schemas';
import Page from './+page.svelte';

const { state } = vi.hoisted(() => ({
	// A mutable harness: `locale` drives the i18n mock, `network` is the live
	// store payload (null = stood-down live tier). Tests flip these per case.
	state: {
		locale: 'en' as 'en' | 'fr',
		network: null as NetworkFile | null,
	},
}));
const createLiveStoreSpy = vi.hoisted(() => vi.fn());
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

const manifest = {
	provider: 'demo',
	display_name: 'Demo Transit',
	short_name: 'Demo',
	city: 'Testville',
	dataset_version: 'v-test',
	files: {
		live: { generated_utc: '2026-06-20T12:00:00Z', ttl_s: 30 },
		static: { generated_utc: '2026-06-20T06:00:00Z' },
	},
};

vi.mock('$lib/i18n', async () => {
	return {
		getLocale: () => state.locale,
		// The hub builds reference-surface hrefs with localizeHref; mirror the real
		// '/fr' prefix convention so the FR link-href assertions are honest.
		localizeHref: (path: string, locale: 'en' | 'fr') =>
			locale === 'fr' ? `/fr${path === '/' ? '' : path}` : path,
	};
});

vi.mock('$lib/nav', async () => {
	const { routeFor } =
		await vi.importActual<typeof import('$lib/nav/intent.svelte')>('$lib/nav/intent.svelte');
	return { routeFor };
});

vi.mock('$lib/v1/boot', () => ({
	getV1Context: () => ({ manifest, labels: {}, lang: state.locale }),
}));

vi.mock('$lib/v1/live/store.svelte', async () => {
	// The hero's routes-live tile iterates a REAL LiveIndex (vehiclesByRoute Map),
	// so the mocked store carries the real empty index, not a bare {}.
	const { emptyLiveIndex } =
		await vi.importActual<typeof import('$lib/v1/live/index')>('$lib/v1/live/index');
	return {
		createLiveStore: (actualManifest: unknown, options?: unknown) => {
			createLiveStoreSpy(actualManifest, options);
			return {
				vehicles: null,
				trips: null,
				departures: null,
				alerts: null,
				network: state.network,
				index: emptyLiveIndex(),
				generatedUtc: state.network?.generated_utc ?? null,
				ageSeconds: state.network ? 12 : null,
				isStale: false,
				loading: false,
				error: null,
				start: vi.fn(),
				stop: vi.fn(),
				refresh: vi.fn(),
			};
		},
	};
});

const liveNetwork: NetworkFile = {
	generated_utc: '2026-06-20T12:00:00Z' as IsoUtc,
	vehicles_in_service: 412,
	on_time_pct: 83,
	status_dist: { early: 0, on_time: 8, late: 2, severe: 0, unknown: 0 },
	delay_p50_min: 1,
	delay_p90_min: 6,
	non_responding: 7,
	feed_freshness_s: 20,
	coverage_pct: 94,
	occupancy_mix: { empty: 0.1, many_seats: 0.65, few_seats: 0.17, standing: 0.08, full: 0 },
};

const routePath = resolve(process.cwd(), 'src/routes/[[lang=locale]]/+page.svelte');
const homeFeaturePath = resolve(process.cwd(), 'src/lib/features/home');

function fingerprint(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function canonicalMarkup(markup: string): string {
	const template = document.createElement('template');
	template.innerHTML = markup;
	function serialize(node: Node): string {
		if (node.nodeType === Node.TEXT_NODE)
			return node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
		if (!(node instanceof Element)) return '';
		const attributes = [...node.attributes]
			.map(({ name, value }) => {
				if (name !== 'class') return [name, value] as const;
				return [
					name,
					value
						.split(/\s+/)
						.filter((token) => token && !/^(?:svelte-|s-)[\w-]+$/.test(token))
						.sort()
						.join(' '),
				] as const;
			})
			.filter(([, value]) => value !== '')
			.sort(([left], [right]) => left.localeCompare(right));
		return `<${node.tagName.toLowerCase()}${attributes
			.map(([name, value]) => ` ${name}=${JSON.stringify(value)}`)
			.join('')}>${[...node.childNodes].map(serialize).join('')}</${node.tagName.toLowerCase()}>`;
	}
	return [...template.content.childNodes].map(serialize).join('');
}

function cssRecords(source: string): string[] {
	const css = parse(source, { modern: true }).css;
	if (css == null) return [];
	const records: string[] = [];
	function visit(
		nodes: readonly (AST.CSS.Atrule | AST.CSS.Rule | AST.CSS.Declaration)[],
		context: readonly string[] = [],
	): void {
		for (const node of nodes) {
			if (node.type === 'Atrule') {
				visit(node.block?.children ?? [], [...context, `@${node.name} ${node.prelude}`]);
				continue;
			}
			if (node.type !== 'Rule') continue;
			const declarations = node.block.children
				.filter((child): child is AST.CSS.Declaration => child.type === 'Declaration')
				.map((child) => `${child.property}:${child.value}`)
				.join(';');
			for (const selector of node.prelude.children) {
				const text = source.slice(selector.start, selector.end).replace(/\s+/g, ' ').trim();
				records.push(`${context.join(' > ')}|${text}|${declarations}`);
			}
		}
	}
	visit(css.children);
	return records;
}

function homeCssFingerprint(): string {
	const owners = ['HomeHero.svelte', 'HomeWhat.svelte', 'HomeExplore.svelte'].map((owner) =>
		resolve(homeFeaturePath, owner),
	);
	const sources = owners.every(existsSync)
		? owners.map((owner) => readFileSync(owner, 'utf8'))
		: [readFileSync(routePath, 'utf8')];
	return fingerprint(JSON.stringify(sources.flatMap(cssRecords).sort()));
}

afterEach(() => {
	state.locale = 'en';
	state.network = null;
	createLiveStoreSpy.mockClear();
	homeIntersectionCallback = undefined;
	vi.unstubAllGlobals();
});

describe('Home hub — identity + what-this-is', () => {
	it('requests only the live families this surface reads', () => {
		render(Page);

		expect(createLiveStoreSpy).toHaveBeenCalledWith(manifest, {
			families: ['vehicles', 'network'],
		});
	});

	it('keeps the mobile intro in the first viewport and seats the control room after its divider', () => {
		const { container } = render(Page);
		const intro = container.querySelector('[data-slot="home-hero-intro"]') as HTMLElement;
		const divider = container.querySelector(
			'[data-slot="home-mobile-hero-divider"]',
		) as HTMLElement;
		const controlRoom = container.querySelector('[data-slot="home-control-room"]') as HTMLElement;

		expect(intro).not.toBeNull();
		expect(divider).not.toBeNull();
		expect(controlRoom).not.toBeNull();
		expect(intro.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(
			divider.compareDocumentPosition(controlRoom) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		const source = readFileSync(resolve(homeFeaturePath, 'HomeHero.svelte'), 'utf8');
		expect(source).toMatch(
			/\.hero-left\s*\{[\s\S]*?min-height:\s*calc\(100svh - var\(--chrome-offset\)\)/,
		);
		expect(source).toMatch(
			/\.hero-spine\s*\{[\s\S]*?height:\s*1px[\s\S]*?linear-gradient\(\s*90deg/,
		);
		expect(source).toMatch(
			/@media \(min-width: 1024px\)[\s\S]*?\.hero-spine\s*\{[\s\S]*?width:\s*1px[\s\S]*?linear-gradient\(\s*180deg/,
		);
	});

	it('renders the two-line THESIS as the page heading, with the identity in the kicker', () => {
		render(Page);
		// P5-R R1: the h1 is the thesis (line 2 is the --primary accent), not the
		// agency name — identity demotes to the station-voice kicker + CornerMeta.
		const h1 = screen.getByRole('heading', { level: 1 });
		expect(h1.textContent?.replace(/\s+/g, ' ')).toMatch(/THE NETWORK, ?MEASURED HONESTLY/i);
		expect(screen.getByText(/CITIZEN DASHBOARD · DEMO · TESTVILLE/i)).toBeInTheDocument();
	});

	it('templates the what-this-is copy on the manifest short_name + city (provider-agnostic)', () => {
		render(Page);
		// Identity tokens template into the copy (tagline + body both carry them),
		// never a hardcoded agency.
		expect(screen.getAllByText(/Demo network across Testville/i).length).toBeGreaterThanOrEqual(1);
		// The honesty contract line is unique to the what-this-is body.
		expect(screen.getByText(/Never a fabricated zero\./i)).toBeInTheDocument();
		expect(
			screen.getByText(/what we measured ourselves, not an official statistic/i),
		).toBeInTheDocument();
		// The "How we measure" deep links (the prose link + the trust tile) point at
		// /metrics.
		const measureLinks = screen.getAllByRole('link', { name: /How we measure/i });
		expect(measureLinks.length).toBeGreaterThanOrEqual(1);
		for (const link of measureLinks) expect(link).toHaveAttribute('href', '/metrics');
	});
});

describe('Home hub — live pulse honesty', () => {
	it('stands the pulse down to "no data" (never a fabricated 0) when the live store is null', () => {
		state.network = null;
		render(Page);
		const board = screen.getByRole('list', { name: /the network, right now/i });
		// Every headline stands down to the STYLED honest-absence chip (§C5.1 upgrade:
		// the flagship page speaks the site's own absence language), never a fabricated
		// 0 / 0%. The 'not-reported' reason reads "not reported in the live feed".
		expect(board.querySelectorAll('[data-slot="absent-value"]')).toHaveLength(4);
		expect(within(board).getAllByText(/not reported in the live feed/i).length).toBe(4);
		expect(within(board).queryByText('0%')).toBeNull();
		expect(within(board).queryByText('0')).toBeNull();
		// The pulse verdict reads STANDBY when the live tier is absent (the terminal
		// tag + the dot's sr-only label both carry it).
		expect(screen.getAllByText('STANDBY').length).toBeGreaterThanOrEqual(1);
		// The freshness chip stands its age down to "unknown" with no live build.
		expect(screen.getByText('unknown')).toBeInTheDocument();
	});

	it('reads real headline numbers when the live tier reports', () => {
		state.network = liveNetwork;
		render(Page);
		// ONE numbers voice (operator variation): the terminal board carries the
		// glance — on-time leads with its verdict word, then coverage / median
		// delay / not reporting; the fleet-status ledger carries the distribution.
		const board = screen.getByRole('list', { name: /the network, right now/i });
		expect(within(board).getByText('83%')).toBeInTheDocument(); // on-time
		expect(within(board).getByText('94%')).toBeInTheDocument(); // coverage
		expect(within(board).getByText('1 min')).toBeInTheDocument(); // median delay
		expect(within(board).getByText('7')).toBeInTheDocument(); // not reporting
		const dist = screen.getByRole('group', { name: /fleet status/i });
		expect(within(dist).getByText('8')).toBeInTheDocument(); // on-time vehicles (fixture)
		// The crowding grid renders the occupancy shares as whole percents…
		const crowd = screen.getByRole('group', { name: /crowding/i });
		expect(within(crowd).getByText('65%')).toBeInTheDocument(); // many seats
		// …and busiest-lines hides honestly while the live index is empty (the
		// mocked store carries emptyLiveIndex): no fabricated route rows.
		expect(screen.queryByRole('group', { name: /busiest lines/i })).toBeNull();
		// The pulse verdict flips to LIVE when the tier reports (no STANDBY anywhere).
		expect(screen.getAllByText('LIVE').length).toBeGreaterThanOrEqual(1);
		expect(screen.queryByText('STANDBY')).toBeNull();
	});

	it('announces live pulse updates to AT (aria-live="polite" on the pulse grid)', () => {
		state.network = liveNetwork;
		render(Page);
		const board = screen.getByRole('list', { name: /the network, right now/i });
		expect(board).toHaveAttribute('aria-live', 'polite');
	});

	it('wires an (i) metric explainer onto every pulse tile', () => {
		state.network = liveNetwork;
		render(Page);
		const board = screen.getByRole('list', { name: /the network, right now/i });
		// One (i) explainer trigger per tile — each pulse number carries its honest
		// definition + a deep link, the same affordance the /network KPIs use.
		const triggers = within(board)
			.getAllByRole('button')
			.filter((b) => b.classList.contains('metric-info__trigger'));
		expect(triggers).toHaveLength(4);
		expect(within(board).getByRole('button', { name: /About On-time/i })).toBeInTheDocument();
		expect(within(board).getByRole('button', { name: /About Coverage/i })).toBeInTheDocument();
		expect(within(board).getByRole('button', { name: /About Median delay/i })).toBeInTheDocument();
		expect(within(board).getByRole('button', { name: /About Not reporting/i })).toBeInTheDocument();
	});

	it('renders the styled honest-absence chip on each pulse tile when a metric is null', () => {
		state.network = null;
		render(Page);
		const board = screen.getByRole('list', { name: /the network, right now/i });
		// §C5.1 upgrade: a null value reads the styled AbsentValue chip (calm "Unknown"
		// tone + the WHY), never the amber value voice, a fabricated 0, or a bare glyph.
		const empties = board.querySelectorAll('[data-slot="absent-value"]');
		expect(empties).toHaveLength(4);
		for (const el of empties) expect(el.textContent).toMatch(/not reported in the live feed/i);
	});
});

describe('Home hub — explore everything wayfinding', () => {
	it('renders the four rider-question groups (task-led IA, never taxonomy labels)', () => {
		render(Page);
		const nav = screen.getByRole('navigation', { name: /explore everything/i });
		expect(within(nav).getByRole('heading', { name: 'Where’s my bus?' })).toBeInTheDocument();
		expect(
			within(nav).getByRole('heading', { name: 'Which line can I trust?' }),
		).toBeInTheDocument();
		expect(
			within(nav).getByRole('heading', { name: 'Did they keep their promise?' }),
		).toBeInTheDocument();
		expect(within(nav).getByRole('heading', { name: 'Behind the numbers' })).toBeInTheDocument();
		// Every group heading carries a plain scope sentence (what's behind the click).
		expect(within(nav).getByText(/See it moving, know when it comes/i)).toBeInTheDocument();
	});

	it('renders primary surfaces as native localized links', () => {
		render(Page);
		const nav = screen.getByRole('navigation', { name: /explore everything/i });
		expect(within(nav).getByRole('link', { name: /Live map/i })).toHaveAttribute('href', '/map');
		expect(within(nav).getByRole('link', { name: /The record Lines/i })).toHaveAttribute(
			'href',
			'/lines',
		);
		expect(within(nav).getByRole('link', { name: /Live now Stops/i })).toHaveAttribute(
			'href',
			'/stops',
		);
		expect(within(nav).getByRole('link', { name: /Live now Network health/i })).toHaveAttribute(
			'href',
			'/network',
		);
		expect(within(nav).getByRole('link', { name: /Live now Search/i })).toHaveAttribute(
			'href',
			'/search',
		);
	});

	it('renders reference surfaces as localized <a> links (accountability + trust)', () => {
		render(Page);
		expect(screen.getByRole('link', { name: /Hotspots/i })).toHaveAttribute('href', '/hotspots');
		expect(screen.getByRole('link', { name: /Daily receipt/i })).toHaveAttribute(
			'href',
			'/receipt',
		);
		expect(screen.getByRole('link', { name: /Repeat offenders/i })).toHaveAttribute(
			'href',
			'/repeat-offenders',
		);
		expect(screen.getByRole('link', { name: /Alerts/i })).toHaveAttribute('href', '/alerts');
		expect(screen.getByRole('link', { name: /Data health/i })).toHaveAttribute('href', '/status');
	});

	it('exposes every surface so the hub no longer hides the audit pages', () => {
		render(Page);
		// All 11 destinations are native links, including the five primary surfaces.
		// This preserves navigation before hydration, crawler discovery, and open-in-new-tab.
		const buttons = screen.getAllByRole('button').filter((b) => b.classList.contains('hub-tile'));
		const links = screen.getAllByRole('link').filter((a) => a.classList.contains('hub-tile'));
		expect(buttons).toHaveLength(0);
		expect(links).toHaveLength(11);
	});
});

describe('Home hub — wayfinding v2 (informational pillars + filter rail)', () => {
	it('shows the mobile filters only while the stable Explore region is in view', async () => {
		vi.stubGlobal('IntersectionObserver', HomeIntersectionObserverStub);
		const { container } = render(Page);
		const explore = container.querySelector('[data-slot="home-explore"]') as HTMLElement;

		expect(explore).not.toBeNull();
		expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();

		homeIntersectionCallback?.(
			[{ target: explore, isIntersecting: true } as unknown as IntersectionObserverEntry],
			{} as IntersectionObserver,
		);
		await vi.waitFor(() =>
			expect(container.querySelector('[data-slot="surface-rail-mobile"]')).not.toBeNull(),
		);
		expect(screen.getByText('11 destinations')).toBeInTheDocument();

		homeIntersectionCallback?.(
			[{ target: explore, isIntersecting: false } as unknown as IntersectionObserverEntry],
			{} as IntersectionObserver,
		);
		await vi.waitFor(() =>
			expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull(),
		);
		expect(screen.queryByText('11 destinations')).toBeNull();
	});

	it('keeps the home paragraphs calm while retaining spacious filters and the 19rem rail', () => {
		const { container } = render(Page);
		const question = screen.getByRole('radio', { name: 'Where’s my bus?' });
		const kind = screen.getByRole('radio', { name: 'The record' });
		for (const button of [question, kind]) expect(button).toHaveClass('px-3', 'text-base');

		const heroSource = readFileSync(resolve(homeFeaturePath, 'HomeHero.svelte'), 'utf8');
		const whatSource = readFileSync(resolve(homeFeaturePath, 'HomeWhat.svelte'), 'utf8');
		const exploreSource = readFileSync(resolve(homeFeaturePath, 'HomeExplore.svelte'), 'utf8');
		expect(exploreSource.match(/density="spacious"/g)).toHaveLength(2);
		expect(exploreSource).toMatch(/grid-template-columns:\s*19rem\s+minmax\(0,\s*1fr\)/);
		expect(whatSource).toMatch(
			/\.what-body\s*\{[\s\S]*?font-size:\s*var\(--text-body\)[\s\S]*?line-height:\s*1\.65/,
		);
		expect(heroSource).toMatch(
			/\.hero-lede\s*\{[\s\S]*?font-size:\s*var\(--text-body\)[\s\S]*?line-height:\s*1\.65/,
		);
		expect(container.querySelector('.what-body')).toHaveClass('what-body');
	});

	it('renders the ground rules as informational, never clickable', () => {
		render(Page);
		// The what-this-is section holds ONE link (the measure deep-link) and no
		// buttons: the pillars are a legend, not cards — nothing about them is
		// interactive (informational vs clickable = different species).
		const what = screen.getByRole('region', { name: /what this is/i });
		expect(within(what).getAllByRole('link')).toHaveLength(1);
		expect(within(what).queryAllByRole('button')).toHaveLength(0);
		for (const title of ['Live', 'Honest', 'Accountable']) {
			expect(within(what).getByText(title).closest('a, button')).toBeNull();
		}
	});

	it('reserves the filter rail: both facets render before the mobile pill becomes relevant', () => {
		render(Page);
		// The two facet radiogroups are present in the default (unfiltered) view —
		// the rail space is reserved, not conjured on demand.
		expect(screen.getByRole('radio', { name: 'Where’s my bus?' })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: 'The record' })).toBeInTheDocument();
		// The pill itself is intentionally absent until Explore enters the viewport.
		expect(screen.queryByText('11 destinations')).toBeNull();
	});

	it('filters to ONE group when a rider question is picked', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('radio', { name: 'Which line can I trust?' }));
		const nav = screen.getByRole('navigation', { name: /explore everything/i });
		expect(
			within(nav).getByRole('heading', { name: 'Which line can I trust?' }),
		).toBeInTheDocument();
		expect(within(nav).queryByRole('heading', { name: 'Where’s my bus?' })).toBeNull();
		expect(within(nav).queryByRole('heading', { name: 'Behind the numbers' })).toBeNull();
		// The match summary counts the one group's three destinations.
		expect(screen.getAllByText('3 destinations').length).toBeGreaterThanOrEqual(1);
	});

	it('filters across groups by KIND, hides emptied groups, and clears back to all', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('radio', { name: 'The record' }));
		const nav = screen.getByRole('navigation', { name: /explore everything/i });
		// Live-only surfaces drop out, record surfaces stay, and the all-method
		// group hides whole rather than standing as an empty heading.
		expect(within(nav).queryByRole('link', { name: /Live map/i })).toBeNull();
		expect(within(nav).getByRole('link', { name: /Repeat offenders/i })).toBeInTheDocument();
		expect(within(nav).queryByRole('heading', { name: 'Behind the numbers' })).toBeNull();
		// Clear restores the four-group default view.
		await fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
		expect(within(nav).getByRole('heading', { name: 'Behind the numbers' })).toBeInTheDocument();
		expect(within(nav).getByRole('link', { name: /Live map/i })).toBeInTheDocument();
	});

	it('shows an honest empty state when the two facets intersect to nothing', async () => {
		render(Page);
		await fireEvent.click(screen.getByRole('radio', { name: 'Where’s my bus?' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'The record' }));
		const message = screen.getByText(/nothing matches these filters/i);
		expect(message).toBeInTheDocument();
		expect(message.closest('[data-component="state-notice"]')).toHaveAttribute(
			'data-presentation',
			'silo',
		);
	});

	it('tags every card with its KIND in the same words as the rail facet', () => {
		render(Page);
		const nav = screen.getByRole('navigation', { name: /explore everything/i });
		const mapTile = within(nav).getByRole('link', { name: /Live map/i });
		expect(within(mapTile).getByText('Live now')).toBeInTheDocument();
		const receiptTile = screen.getByRole('link', { name: /Daily receipt/i });
		expect(within(receiptTile).getByText('The record')).toBeInTheDocument();
	});
});

describe('Home hub — bilingual', () => {
	beforeEach(() => {
		state.locale = 'fr';
	});

	it('renders the FR filter rail (facet labels + kind chips)', () => {
		render(Page);
		expect(screen.getByText('Par question')).toBeInTheDocument();
		expect(screen.getByText('Par genre')).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: 'Le bilan' })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: 'Où est mon bus ?' })).toBeInTheDocument();
	});

	it('renders the FR copy + FR-prefixed reference hrefs', () => {
		render(Page);
		expect(screen.getAllByText(/Le réseau Demo de Testville/i).length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText(/Jamais de zéro inventé\./i)).toBeInTheDocument();
		// FR group labels.
		const nav = screen.getByRole('navigation', { name: /tout explorer/i });
		expect(within(nav).getByRole('heading', { name: 'Où est mon bus ?' })).toBeInTheDocument();
		expect(within(nav).getByRole('heading', { name: 'Ont-ils tenu parole ?' })).toBeInTheDocument();
		// Reference links carry the /fr prefix.
		const mesureLinks = screen.getAllByRole('link', { name: /Comment on mesure/i });
		expect(mesureLinks.length).toBeGreaterThanOrEqual(1);
		for (const link of mesureLinks) expect(link).toHaveAttribute('href', '/fr/metrics');
		expect(screen.getByRole('link', { name: /Santé des données/i })).toHaveAttribute(
			'href',
			'/fr/status',
		);
	});
});

describe('Home hub — movement boundary preservation', () => {
	it('owns copy and each movement under the home feature domain', () => {
		for (const owner of [
			'home.copy.ts',
			'HomeHero.svelte',
			'HomeWhat.svelte',
			'HomeExplore.svelte',
		]) {
			expect(existsSync(resolve(homeFeaturePath, owner)), owner).toBe(true);
		}

		const route = readFileSync(routePath, 'utf8');
		const positions = ['<HomeHero', '<HomeWhat', '<HomeExplore'].map((component) =>
			route.indexOf(component),
		);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((left, right) => left - right));
	});

	it('locks the authored CSS output rule-by-rule while ownership moves', () => {
		expect(homeCssFingerprint()).toBe(
			'1f5126537ec32357aec52d7bc90677f0c991a0650245df7cf2d5453db21daffc',
		);
	});

	it('locks canonical hydrated DOM in both locale/live states', () => {
		state.locale = 'en';
		state.network = null;
		const enDom = render(Page);
		const enDomHash = fingerprint(canonicalMarkup(enDom.container.innerHTML));
		enDom.unmount();

		state.locale = 'fr';
		state.network = liveNetwork;
		const frDom = render(Page);
		const frDomHash = fingerprint(canonicalMarkup(frDom.container.innerHTML));
		frDom.unmount();

		expect({ enDomHash, frDomHash }).toEqual({
			enDomHash: '51e7e368c2ca662a2d8bfb7a5b1056a965d3bbf3e71a608016dee83392ba72d3',
			frDomHash: '7f4d93b4c49d49057078d76ee3c589cedf73c8544ca3c80b103ca708045d54b2',
		});
	});

	it('locks canonical SSR output through the server compiler', async () => {
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
			context.set(Symbol.for('transit.v1.context'), () => ({
				manifest,
				labels: {},
				lang: 'en' as const,
			}));
			context.set(Symbol.for('transit.i18n.locale'), () => 'en' as const);
			const { body } = renderSsr(pageModule.default, { context });

			expect(fingerprint(canonicalMarkup(body))).toBe(
				'11a12c4d77ba5c6c034384b3e3c2c6cc2361be3b302c3e06e445981f929bea2e',
			);
		} finally {
			await server.close();
		}
	}, 20_000);
});

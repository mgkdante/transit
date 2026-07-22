import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { compile } from 'svelte/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertArchiveEntry, AlertArchiveIndex, AlertHistory } from '$lib/v1/schemas';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import { alertHistoryCopy } from './alerts.copy';
import AlertHistoryScreen from './AlertHistory.svelte';

const copyEn = alertHistoryCopy.en;

// One mutable AlertHistory fixture, read by reference inside the createResource mock
// so a test can splice its `alerts` / `breakdown` / window envelope in place before
// render. Modeled on the published alert_history.json (free-string severity, generic
// FR/EN headers → the shared "Service alert" fallback, an "unknown" breakdown bucket).
const { fixture } = vi.hoisted(() => ({
	fixture: {
		generated_utc: '2026-06-20T00:00:00Z',
		alerts: [
			{
				id: 'a-1',
				severity: 'watch',
				header_text: 'Votre arrêt',
				header_text_en: 'Your stop',
				routes: ['24'],
				stops: ['52458', '52487'],
				start_utc: '2026-06-20T11:00:00Z',
				end_utc: '2026-06-21T21:00:00Z',
				duration_min: 2040,
				impact_passages: 1234,
				cause: 'CONSTRUCTION',
				effect: 'DETOUR',
			},
			{
				id: 'a-2',
				severity: 'watch',
				header_text: 'Votre ligne',
				header_text_en: 'Your line',
				routes: ['99'],
				stops: [],
				start_utc: '2026-06-20T15:00:00Z',
				end_utc: '2026-06-20T18:30:00Z',
				duration_min: 210,
				impact_passages: null,
				cause: 'ACCIDENT',
				effect: '',
			},
		],
		breakdown: {
			by_cause: [{ key: 'CONSTRUCTION', count: 7, median_duration_min: 300 }],
			by_effect: [{ key: 'unknown', count: 9, median_duration_min: 120 }],
			by_severity: [{ key: 'watch', count: 9, median_duration_min: 240 }],
		},
	} as AlertHistory,
}));

const ports = vi.hoisted(() => ({
	getAlertHistory: vi.fn(),
	getAlertArchiveIndex: vi.fn(),
	getAlertArchiveRange: vi.fn(),
}));
const archiveState = vi.hoisted(() => ({
	index: null as AlertArchiveIndex | null,
	entries: [] as AlertArchiveEntry[],
}));

vi.mock('$lib/v1', () => ({
	getAlertHistory: ports.getAlertHistory,
	getAlertArchiveIndex: ports.getAlertArchiveIndex,
	getAlertArchiveRange: ports.getAlertArchiveRange,
}));
vi.mock('$lib/v1/repositories/historic', () => ({
	getAlertHistory: ports.getAlertHistory,
	getAlertArchiveIndex: ports.getAlertArchiveIndex,
	getAlertArchiveRange: ports.getAlertArchiveRange,
}));

// The SvelteKit page URL (mutable) + a replaceState that UPDATES it, so the codec
// seed AND the round-trip mirror are testable. Hoisted so the mock factories can see it.
const nav = vi.hoisted(() => ({ url: new URL('http://localhost/alerts') }));
const replaceState = vi.hoisted(() =>
	vi.fn((u: string | URL) => {
		nav.url = new URL(u, 'http://localhost');
	}),
);
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return nav.url;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({ replaceState }));

const currentLocale = vi.hoisted(() => ({ value: 'en' as 'en' | 'fr' }));
vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => currentLocale.value };
});

function setUrl(path: string): void {
	nav.url = new URL(path, 'http://localhost');
}

// Synchronous resource seam for the broad rendering suite. The async resource
// contract (abort, stale-response suppression, retry) is covered with the real
// createResource in AlertHistory.async.svelte.test.ts.
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: <T>(fetcher: (signal: AbortSignal) => Promise<T> | T) => {
		const signal = new AbortController().signal;
		let data: T | null = null;
		let error: Error | null = null;
		let rangeFetcher = false;

		const pump = () => {
			try {
				const value = fetcher(signal);
				rangeFetcher ||= value != null && typeof (value as Promise<T>).then === 'function';
				if (rangeFetcher) {
					const call = ports.getAlertArchiveRange.mock.calls.at(-1);
					data = (
						call == null
							? null
							: {
									window: { ...(call[1] as object) },
									entries: [...archiveState.entries],
								}
					) as T | null;
					return;
				}
				if (value != null && typeof (value as Promise<T>).then === 'function') return;
				data = value as T;
				error = null;
			} catch (cause) {
				error = cause instanceof Error ? cause : new Error(String(cause));
				data = null;
			}
		};

		pump();
		return {
			get data() {
				if (rangeFetcher) pump();
				return data;
			},
			get error() {
				return error;
			},
			loading: false,
			settled: true,
			reload: vi.fn(pump),
		};
	},
}));

const ORIGINAL_ALERTS = JSON.parse(JSON.stringify(fixture.alerts));
const ORIGINAL_BREAKDOWN = JSON.parse(JSON.stringify(fixture.breakdown));

function card(container: HTMLElement, id: string): HTMLElement {
	return container.querySelector(`[data-toc="${id}"]`) as HTMLElement;
}

function cardTrigger(container: HTMLElement, id: string): HTMLButtonElement {
	return card(container, id).querySelector(
		'h2.section-heading > button.section-header',
	) as HTMLButtonElement;
}

function resetArticleState(): void {
	for (const key of [
		'alerts-card-window',
		'alerts-card-breakdown',
		'alerts-card-log',
		'alerts-filters',
		'alerts-toc',
	]) {
		sessionStorage.removeItem(`transit.persisted:${key}`);
	}
	quietModeStore.resetForTest();
}

function seedAnalyticalFilterFixture(): void {
	fixture.alerts = [
		{
			id: 'L1',
			severity: 'critical',
			header_text_en: 'Line closed',
			routes: ['10'],
			stops: [],
			start_utc: '2026-06-20T09:00:00Z',
			end_utc: '2026-06-20T10:00:00Z',
			duration_min: 60,
			cause: 'ACCIDENT',
			effect: 'NO_SERVICE',
		},
		{
			id: 'S1',
			severity: 'high',
			header_text_en: 'Stop moved',
			routes: [],
			stops: ['52458'],
			start_utc: '2026-06-21T11:00:00Z',
			end_utc: '2026-06-21T13:00:00Z',
			duration_min: 120,
			cause: 'CONSTRUCTION',
			effect: 'DETOUR',
		},
		{
			id: 'B1',
			severity: 'watch',
			header_text_en: 'Detour',
			routes: ['24'],
			stops: ['99999'],
			start_utc: '2026-06-22T13:00:00Z',
			end_utc: '2026-06-22T16:00:00Z',
			duration_min: 180,
			cause: 'CONSTRUCTION',
			effect: 'DETOUR',
		},
	] as unknown as AlertHistory['alerts'];
	fixture.breakdown = {
		by_cause: [{ key: 'SERVER_ONLY', count: 99, median_duration_min: 999 }],
		by_effect: [],
		by_severity: [],
	};
	(fixture as AlertHistory).window_start = '2026-06-20';
	(fixture as AlertHistory).window_end = '2026-06-22';
}

function makeArchiveIndex(first = '2026-01-01', last = '2026-07-13'): AlertArchiveIndex {
	return {
		generated_utc: '2026-07-13T12:00:00Z' as AlertArchiveIndex['generated_utc'],
		collection_generation_id: 'alerts-2026-07-13',
		first_available_date: first,
		last_available_date: last,
		total_alerts: 42,
		months: [],
	};
}

function makeArchiveEntry(
	id: string,
	header: string,
	from: string,
	to: string,
	overrides: Partial<AlertArchiveEntry> = {},
): AlertArchiveEntry {
	return {
		id,
		header_text_en: header,
		severity: 'watch',
		routes: ['24'],
		stops: [],
		start_utc: `${from}T09:00:00Z` as AlertArchiveEntry['start_utc'],
		end_utc: `${to}T10:00:00Z` as AlertArchiveEntry['end_utc'],
		first_seen_utc: `${from}T08:00:00Z` as AlertArchiveEntry['first_seen_utc'],
		last_seen_utc: `${to}T11:00:00Z` as AlertArchiveEntry['last_seen_utc'],
		duration_min: 60,
		cause: 'CONSTRUCTION',
		effect: 'DETOUR',
		...overrides,
	};
}

beforeEach(() => {
	currentLocale.value = 'en';
	resetArticleState();
	Element.prototype.scrollIntoView = vi.fn();
	archiveState.index = null;
	archiveState.entries = [];
	ports.getAlertHistory.mockReset();
	ports.getAlertArchiveIndex.mockReset();
	ports.getAlertArchiveRange.mockReset();
	ports.getAlertHistory.mockImplementation(() => fixture as never);
	ports.getAlertArchiveIndex.mockImplementation(() => archiveState.index as never);
	ports.getAlertArchiveRange.mockImplementation(() => archiveState.entries as never);
});

afterEach(() => {
	currentLocale.value = 'en';
	fixture.alerts = JSON.parse(JSON.stringify(ORIGINAL_ALERTS));
	fixture.breakdown = JSON.parse(JSON.stringify(ORIGINAL_BREAKDOWN));
	delete (fixture as AlertHistory).window_start;
	delete (fixture as AlertHistory).window_end;
	delete (fixture as AlertHistory).total_in_window;
	delete (fixture as AlertHistory).truncated;
	setUrl('http://localhost/alerts');
	replaceState.mockClear();
	resetArticleState();
});

describe('AlertHistory article shell', () => {
	it('renders one article heading, exact metadata copy, and only the two shared reading controls', () => {
		const { container } = render(AlertHistoryScreen);

		expect(screen.getAllByRole('heading', { level: 1, name: 'Alerts' })).toHaveLength(1);
		expect(container.querySelector('[data-slot="detail-shell"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="article-header"]')).not.toBeNull();
		expect(screen.getByRole('link', { name: '← Back to the dashboard' })).toHaveAttribute(
			'href',
			'/',
		);
		expect(
			within(screen.getByRole('list', { name: 'Page keywords' })).getAllByRole('listitem'),
		).toHaveLength(4);
		expect(screen.getByText('AS OF')).toBeInTheDocument();
		expect(screen.getByText('2 matches')).toBeInTheDocument();
		expect(screen.getByText('3 sections')).toBeInTheDocument();

		const controls = screen.getByTestId('quiet-mode-controls');
		expect(within(controls).getAllByRole('button')).toHaveLength(2);
		expect(within(controls).getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();
		expect(
			within(controls).getByRole('button', { name: 'Always start collapsed' }),
		).toBeInTheDocument();
	});

	it('keeps the exact bilingual article, rail, and card copy', () => {
		expect(copyEn.article).toEqual({
			watermark: 'Alerts',
			back: '← Back to the dashboard',
			tagsAria: 'Page keywords',
			tags: ['alerts', 'archive', 'duration', 'reach'],
			sections: expect.any(Function),
			matches: expect.any(Function),
		});
		expect(copyEn.article.matches(1)).toBe('1 match');
		expect(copyEn.article.matches(2)).toBe('2 matches');
		expect(copyEn.rail).toEqual({
			label: 'Filters & contents',
			open: 'Open filters and contents',
			close: 'Close filters and contents',
			toc: 'On this page',
			counterPrefix: 'SEC',
		});
		expect(copyEn.cards).toEqual({
			window: {
				title: 'Alerts in window',
				subtitle: 'Matching alerts and their median resolved duration',
			},
			breakdown: {
				title: 'Breakdown',
				subtitle: 'Cause, effect, and severity across the matching alerts',
			},
			log: {
				title: 'Past alerts',
				subtitle: 'The matching alert archive, newest first',
			},
		});

		const copyFr = alertHistoryCopy.fr;
		expect(copyFr.article).toEqual({
			watermark: 'Avis',
			back: '← Retour au tableau de bord',
			tagsAria: 'Mots-clés de la page',
			tags: ['avis', 'archive', 'durée', 'portée'],
			sections: expect.any(Function),
			matches: expect.any(Function),
		});
		expect(copyFr.article.matches(1)).toBe('1 résultat');
		expect(copyFr.article.matches(2)).toBe('2 résultats');
		expect(copyFr.rail).toEqual({
			label: 'Filtres et sommaire',
			open: 'Ouvrir les filtres et le sommaire',
			close: 'Fermer les filtres et le sommaire',
			toc: 'Sur cette page',
			counterPrefix: 'SEC',
		});
		expect(copyFr.cards).toEqual({
			window: {
				title: 'Avis dans la fenêtre',
				subtitle: 'Les avis correspondants et leur durée médiane de résolution',
			},
			breakdown: {
				title: 'Répartition',
				subtitle: 'Les causes, effets et gravités des avis correspondants',
			},
			log: {
				title: 'Avis passés',
				subtitle: 'L’archive des avis correspondants, du plus récent au plus ancien',
			},
		});
	});

	it('renders the stable three-card registry and matching numbered TOC when breakdown is published', () => {
		const { container } = render(AlertHistoryScreen);
		const ids = ['alerts-window', 'alerts-breakdown', 'alerts-log'];

		expect(ids.map((id) => card(container, id).getAttribute('data-header-variant'))).toEqual([
			'article-summary',
			'article-summary',
			'article-summary',
		]);
		expect(
			ids.map((id) =>
				card(container, id).querySelector('[data-slot="badge"]')?.textContent?.trim(),
			),
		).toEqual(['01', '02', '03']);
		expect(
			within(card(container, 'alerts-breakdown')).getAllByRole('heading', { level: 2 }),
		).toHaveLength(1);

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		for (const title of ['Alerts in window', 'Breakdown', 'Past alerts']) {
			expect(within(rail).getByRole('button', { name: title })).toBeInTheDocument();
		}
	});

	it.each([
		{ state: 'null', breakdown: null },
		{ state: 'empty', breakdown: { by_cause: [], by_effect: [], by_severity: [] } },
	])('stands the breakdown card and TOC entry down for a $state breakdown', ({ breakdown }) => {
		fixture.breakdown = breakdown;
		const { container } = render(AlertHistoryScreen);
		expect(container.querySelector('[data-toc="alerts-breakdown"]')).toBeNull();
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).queryByRole('button', { name: 'Breakdown' })).toBeNull();
		expect(card(container, 'alerts-log').querySelector('[data-slot="badge"]')).toHaveTextContent(
			'03',
		);
	});

	it('opens one mobile sheet containing all filters followed by the TOC without a TocPill', async () => {
		const { container } = render(AlertHistoryScreen);
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = within(mobile).getByRole('button', { name: /Open filters and contents/ });
		await fireEvent.click(pill);

		const sheet = screen.getByRole('dialog', { name: 'Filters & contents' });
		expect(sheet.querySelector('[data-slot="surface-rail"]')).toBe(rail);
		const filters = sheet.querySelector('[data-slot="alert-filters"]') as HTMLElement;
		const toc = sheet.querySelector('[data-slot="section-toc"]') as HTMLElement;
		expect(filters).not.toBeNull();
		expect(toc).not.toBeNull();
		expect(filters.compareDocumentPosition(toc) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
		expect(within(filters).getByText('Affects')).toBeInTheDocument();
		expect(within(filters).getByText('Severity')).toBeInTheDocument();
		expect(within(filters).getByRole('radio', { name: 'Lines' })).toBeInTheDocument();
		expect(within(filters).getByRole('radio', { name: 'Critical' })).toBeInTheDocument();
		expect(within(filters).getByRole('combobox', { name: 'Line' })).toBeInTheDocument();
		expect(within(filters).getByRole('combobox', { name: 'Stop' })).toBeInTheDocument();
		expect(filters.querySelectorAll('input[type="date"]')).toHaveLength(2);
		expect(within(sheet).getByRole('button', { name: 'On this page' })).toBeInTheDocument();
		expect(container.querySelector('[data-slot="toc-pill"]')).toBeNull();

		await fireEvent.click(within(filters).getByRole('radio', { name: 'Lines' }));
		expect(screen.getByRole('dialog', { name: 'Filters & contents' })).toBeInTheDocument();
		await fireEvent.click(within(sheet).getByRole('button', { name: 'Past alerts' }));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(container.querySelector('[data-slot="surface-rail"]')).toBe(rail);
	});
});

describe('AlertHistory log', () => {
	it('renders past alerts newest-first using the shared fallback when messages are absent', () => {
		render(AlertHistoryScreen);
		const list = screen.getByRole('list', { name: /past service alerts, newest first/i });
		const titles = within(list).getAllByText('Service alert');
		expect(titles).toHaveLength(2);
		const rows = within(list).getAllByRole('listitem');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toHaveTextContent('210 min');
		expect(rows[1]).toHaveTextContent('2040 min');
	});

	it.each([
		{
			locale: 'en' as const,
			expected: 'Planned work. Stop moved to Ontario Street.',
			otherLocale: 'Travaux planifiés. Arrêt déplacé sur la rue Ontario.',
		},
		{
			locale: 'fr' as const,
			expected: 'Travaux planifiés. Arrêt déplacé sur la rue Ontario.',
			otherLocale: 'Planned work. Stop moved to Ontario Street.',
		},
	])('selects and strips the $locale source description', ({ locale, expected, otherLocale }) => {
		currentLocale.value = locale;
		fixture.alerts = [
			{
				id: 'message',
				severity: 'watch',
				header_text: 'Votre ligne',
				header_text_en: 'Your line',
				description: '<p>Travaux planifiés. <strong>Arrêt déplacé</strong> sur la rue Ontario.</p>',
				description_en: '<p>Planned work. <strong>Stop moved</strong> to Ontario Street.</p>',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-20T11:00:00Z',
				end_utc: '2026-06-20T12:00:00Z',
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;

		const { container } = render(AlertHistoryScreen);

		expect(screen.getByText(expected)).toBeInTheDocument();
		expect(screen.queryByText(otherLocale)).toBeNull();
		expect(container.querySelector('[data-slot="alert-log"] strong')).toBeNull();
	});

	it('omits absent fields and never fabricates a 0 (no impact line when impact_passages is null)', () => {
		render(AlertHistoryScreen);
		const list = screen.getByRole('list', { name: /past service alerts, newest first/i });
		const rows = within(list).getAllByRole('listitem');
		const withImpact = rows.find((r) => within(r).queryByText(/passages affected/i));
		expect(withImpact).toBeDefined();
		expect(within(withImpact as HTMLElement).getByText('1,234 passages')).toBeInTheDocument();
		expect(within(list).queryByText('0 passages')).toBeNull();
	});

	it('renders the resolved duration in minutes', () => {
		render(AlertHistoryScreen);
		expect(screen.getByText('2040 min')).toBeInTheDocument();
		expect(screen.getByText('210 min')).toBeInTheDocument();
	});

	it('renders the archive generation timestamp as semantic article metadata', () => {
		render(AlertHistoryScreen);
		const generated = document.querySelector(
			'time[datetime="2026-06-20T00:00:00Z"]',
		) as HTMLTimeElement;
		expect(generated).not.toBeNull();
		expect(generated).toHaveTextContent('Jun 19, 2026, 8:00 p.m.');
		expect(document.querySelector('[data-slot="freshness-stamp"]')).toBeNull();
	});

	it('lists ALL active windows when an alert carries more than one (D1)', () => {
		fixture.alerts = [
			{
				id: 'multi',
				severity: 'high',
				header_text_en: 'Weekend closure',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-06T09:00:00Z',
				end_utc: '2026-06-07T21:00:00Z',
				active_periods: [
					{ start_utc: '2026-06-06T09:00:00Z', end_utc: '2026-06-07T21:00:00Z' },
					{ start_utc: '2026-06-13T09:00:00Z', end_utc: '2026-06-14T21:00:00Z' },
				],
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
		render(AlertHistoryScreen);
		const windows = document.querySelector('[data-slot="alert-windows"]');
		expect(windows).not.toBeNull();
		expect(windows).toHaveTextContent(copyEn.meta.windowsCount(2));
	});

	it('renders a present url as a SAFE external link with its host', () => {
		fixture.alerts = [
			{
				id: 'linked',
				severity: 'watch',
				header_text_en: 'Detour',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-20T11:00:00Z',
				end_utc: '2026-06-20T12:00:00Z',
				url: 'https://stm.info/en/info/service-updates/x',
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
		render(AlertHistoryScreen);
		const link = document.querySelector('[data-slot="alert-link"]') as HTMLAnchorElement;
		expect(link).not.toBeNull();
		expect(link.getAttribute('href')).toBe('https://stm.info/en/info/service-updates/x');
		expect(link.getAttribute('rel')).toContain('noopener');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link).toHaveTextContent('stm.info');
	});

	it('shows the honest cap note when the served window was truncated', () => {
		(fixture as AlertHistory).truncated = true;
		(fixture as AlertHistory).total_in_window = 512;
		render(AlertHistoryScreen);
		const note = document.querySelector('[data-slot="alert-truncated"]');
		expect(note).not.toBeNull();
		expect(note).toHaveTextContent(copyEn.truncatedNote(2, 512));
	});

	it('cap note keeps the SERVED count under an active client filter (never the filtered subset)', () => {
		// The server cap clipped the SERVED payload newest-first; a client-side
		// severity filter narrows the visible list but must not shrink the "shown"
		// number, or the note misreads as "the N most recent" (S15 review F1).
		(fixture as AlertHistory).truncated = true;
		(fixture as AlertHistory).total_in_window = 512;
		setUrl('http://localhost/alerts?severity=critical');
		render(AlertHistoryScreen);
		const note = document.querySelector('[data-slot="alert-truncated"]');
		expect(note).not.toBeNull();
		expect(note).toHaveTextContent(copyEn.truncatedNote(2, 512));
	});
});

describe('AlertHistory headline', () => {
	it('shows the in-window alert count + median duration sublabel', () => {
		render(AlertHistoryScreen);
		const card = document.querySelector('[data-slot="alert-headline"]');
		expect(card).not.toBeNull();
		// Two alerts in window; median of [2040, 210] = 1125.
		expect(card).toHaveTextContent('2');
		expect(card).toHaveTextContent(copyEn.headline.median(1125));
	});
});

describe('AlertHistory breakdown', () => {
	it('derives published cause/effect/severity rows from the matching entries, not server aggregates', () => {
		render(AlertHistoryScreen);
		const causeList = screen.getByRole('list', { name: /distribution by cause/i });
		expect(within(causeList).getByText('Construction')).toBeInTheDocument();
		expect(within(causeList).getByText('Accident')).toBeInTheDocument();
		expect(within(causeList).queryByText('7 alerts')).toBeNull();
		const effectList = screen.getByRole('list', { name: /distribution by effect/i });
		expect(within(effectList).getByText('Unspecified')).toBeInTheDocument();
		expect(within(effectList).queryByText('unknown')).toBeNull();
	});

	it('keeps its DashboardGrid to one column below 1024px', () => {
		function compiledCss(relativePath: string): string {
			const filename = resolve(process.cwd(), relativePath);
			const source = readFileSync(filename, 'utf8');
			return compile(source, { filename, generate: 'client', css: 'external' }).css?.code ?? '';
		}
		function ruleWith(css: string, declaration: RegExp): { selector: string; index: number } {
			const match = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).find((candidate) =>
				declaration.test(candidate[2] ?? ''),
			);
			if (!match || match.index == null) throw new Error(`Missing compiled rule: ${declaration}`);
			return { selector: (match[1] ?? '').trim(), index: match.index };
		}
		function classSpecificity(selector: string): number {
			return selector.match(/\.[a-z0-9_-]+/gi)?.length ?? 0;
		}

		const breakdownCss = compiledCss('src/lib/features/alerts/sections/AlertBreakdown.svelte');
		const dashboardCss = compiledCss('src/lib/components/layout/DashboardGrid.svelte');
		const mobileRule = ruleWith(breakdownCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
		const dashboardDefault = ruleWith(dashboardCss, /grid-template-columns:\s*repeat\(auto-fit/);
		const desktopStart = breakdownCss.indexOf('@media (min-width: 1024px)');

		expect(mobileRule.selector).toMatch(
			/^\.alert-history-block\.svelte-[a-z0-9]+\s+\.alert-breakdown-grid$/,
		);
		expect(classSpecificity(mobileRule.selector)).toBeGreaterThan(
			classSpecificity(dashboardDefault.selector),
		);
		expect(desktopStart).toBeGreaterThan(mobileRule.index);
		expect(breakdownCss.slice(0, desktopStart)).not.toMatch(/repeat\(auto-fit/);
		expect(breakdownCss.slice(desktopStart)).toMatch(
			/\.alert-history-block\.svelte-[a-z0-9]+\s+\.alert-breakdown-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit/,
		);
	});
});

describe('AlertHistory analytical filter coherence', () => {
	it.each([
		{
			axis: 'severity',
			query: '?severity=critical',
			count: 1,
			shown: ['Line closed'],
			causes: ['Accident'],
			absentCauses: ['Construction'],
		},
		{
			axis: 'affects',
			query: '?affects=lines',
			count: 2,
			shown: ['Line closed', 'Detour'],
			causes: ['Accident', 'Construction'],
			absentCauses: [],
		},
		{
			axis: 'line',
			query: '?route=24',
			count: 1,
			shown: ['Detour'],
			causes: ['Construction'],
			absentCauses: ['Accident'],
		},
		{
			axis: 'stop',
			query: '?stop=52458',
			count: 1,
			shown: ['Stop moved'],
			causes: ['Construction'],
			absentCauses: ['Accident'],
		},
		{
			axis: 'date',
			query: '?from=2026-06-21&to=2026-06-21',
			count: 1,
			shown: ['Stop moved'],
			causes: ['Construction'],
			absentCauses: ['Accident'],
		},
	])(
		'$axis filtering drives the headline, derived breakdown, article metadata, and log together',
		({ query, count, shown, causes, absentCauses }) => {
			seedAnalyticalFilterFixture();
			setUrl(`http://localhost/alerts${query}`);
			const { container } = render(AlertHistoryScreen);

			expect(within(card(container, 'alerts-window')).getByText(String(count))).toBeInTheDocument();
			expect(screen.getByText(count === 1 ? '1 match' : `${count} matches`)).toBeInTheDocument();

			const causeList = within(card(container, 'alerts-breakdown')).getByRole('list', {
				name: /distribution by cause/i,
			});
			for (const cause of causes) expect(within(causeList).getByText(cause)).toBeInTheDocument();
			for (const cause of absentCauses) expect(within(causeList).queryByText(cause)).toBeNull();
			expect(within(causeList).queryByText('SERVER_ONLY')).toBeNull();

			const log = within(card(container, 'alerts-log')).getByRole('list', {
				name: /past service alerts, newest first/i,
			});
			expect(within(log).getAllByRole('listitem')).toHaveLength(count);
			for (const headline of shown) expect(within(log).getByText(headline)).toBeInTheDocument();
		},
	);

	it('keeps a published Breakdown card with honest absence when active filters match zero', async () => {
		seedAnalyticalFilterFixture();
		const { container } = render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.severity.critical }));
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.filters.entity.stops }));

		expect(within(card(container, 'alerts-window')).getByText('0')).toBeInTheDocument();
		expect(screen.getByText('0 matches')).toBeInTheDocument();
		const breakdown = card(container, 'alerts-breakdown');
		expect(breakdown).not.toBeNull();
		expect(breakdown.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(breakdown.querySelector('[role="list"]')).toBeNull();
		expect(
			card(container, 'alerts-log').querySelector('[data-slot="alert-no-match"]'),
		).toHaveTextContent(copyEn.filters.noMatch);
	});

	it('preserves affects, severity, route, stop, from, and to in the one batched URL mirror', async () => {
		seedAnalyticalFilterFixture();
		setUrl(
			'http://localhost/alerts?affects=stops&severity=watch&route=24&stop=99999&from=2026-06-22&to=2026-06-22',
		);
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('radio', { name: 'High' }));

		await waitFor(() => {
			expect(Object.fromEntries(nav.url.searchParams)).toMatchObject({
				affects: 'stops',
				severity: 'high',
				route: '24',
				stop: '99999',
				from: '2026-06-22',
				to: '2026-06-22',
			});
		});
		const mirrored = new URL(String(replaceState.mock.calls.at(-1)?.[0]), 'http://localhost');
		expect(Object.fromEntries(mirrored.searchParams)).toMatchObject({
			affects: 'stops',
			severity: 'high',
			route: '24',
			stop: '99999',
			from: '2026-06-22',
			to: '2026-06-22',
		});
	});
});

describe('AlertHistory filters — entity-type + severity radiogroups (codec-backed)', () => {
	function seedFilterFixture(): void {
		fixture.alerts = [
			{
				id: 'L1',
				severity: 'critical',
				header_text: 'Ligne fermée',
				header_text_en: 'Line closed',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-20T09:00:00Z',
				end_utc: '2026-06-20T10:00:00Z',
				duration_min: 60,
				impact_passages: 100,
			},
			{
				id: 'S1',
				severity: 'high',
				header_text: 'Arrêt déplacé',
				header_text_en: 'Stop moved',
				routes: [],
				stops: ['52458'],
				start_utc: '2026-06-20T11:00:00Z',
				end_utc: '2026-06-20T12:00:00Z',
				duration_min: 60,
				impact_passages: 50,
			},
			{
				id: 'B1',
				severity: 'watch',
				header_text: 'Détour',
				header_text_en: 'Detour',
				routes: ['24'],
				stops: ['99999'],
				start_utc: '2026-06-20T13:00:00Z',
				end_utc: '2026-06-20T14:00:00Z',
				duration_min: 60,
				impact_passages: 25,
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
	}

	function logRows(): HTMLElement[] {
		const list = screen.queryByRole('list', { name: /past service alerts, newest first/i });
		return list ? within(list).getAllByRole('listitem') : [];
	}

	it('filters by entity type — "affects lines" excludes the stops-only alert AND mirrors ?affects', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		expect(logRows()).toHaveLength(3);

		const linesChip = screen.getByRole('radio', { name: copyEn.filters.entity.lines });
		await fireEvent.click(linesChip);

		expect(logRows()).toHaveLength(2);
		expect(screen.getByText('Line closed')).toBeInTheDocument();
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.queryByText('Stop moved')).toBeNull();
		// The pick mirrored to the codec ?affects key (round-trip persistence).
		expect(nav.url.searchParams.get('affects')).toBe('lines');
	});

	it('filters by entity type — "affects stops" excludes the lines-only alert', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		const stopsChip = screen.getByRole('radio', { name: copyEn.filters.entity.stops });
		await fireEvent.click(stopsChip);

		expect(logRows()).toHaveLength(2);
		expect(screen.getByText('Stop moved')).toBeInTheDocument();
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.queryByText('Line closed')).toBeNull();
	});

	it('filters by severity — "Critical" narrows to the single critical alert AND mirrors ?severity', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		const criticalChip = screen.getByRole('radio', { name: copyEn.severity.critical });
		await fireEvent.click(criticalChip);

		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Line closed')).toBeInTheDocument();
		expect(nav.url.searchParams.get('severity')).toBe('critical');
	});

	it('shows the honest no-match note (never an empty void) when filters match nothing', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.severity.critical }));
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.filters.entity.stops }));

		expect(screen.queryByRole('list', { name: /past service alerts, newest first/i })).toBeNull();
		const note = document.querySelector('[data-slot="alert-no-match"]');
		expect(note).not.toBeNull();
		expect(note).toHaveTextContent(copyEn.filters.noMatch);
		expect(note).toHaveAttribute('data-component', 'state-notice');
		expect(note).toHaveAttribute('data-presentation', 'silo');
		expect(note?.textContent).not.toContain('·');
	});

	it('clears the filters and restores the full log', async () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		await fireEvent.click(screen.getByRole('radio', { name: copyEn.severity.critical }));
		expect(logRows()).toHaveLength(1);

		const clear = document.querySelector('[data-slot="clear-filters"]') as HTMLElement;
		expect(clear).not.toBeNull();
		await fireEvent.click(clear);

		expect(logRows()).toHaveLength(3);
		expect(document.querySelector('[data-slot="clear-filters"]')).toBeNull();
	});
});

describe('AlertHistory specific-entity pickers (Line / Stop) — codec-seeded', () => {
	function seedFilterFixture(): void {
		fixture.alerts = [
			{
				id: 'L1',
				severity: 'critical',
				header_text_en: 'Line closed',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-20T09:00:00Z',
				end_utc: '2026-06-20T10:00:00Z',
			},
			{
				id: 'S1',
				severity: 'high',
				header_text_en: 'Stop moved',
				routes: [],
				stops: ['52458'],
				start_utc: '2026-06-20T11:00:00Z',
				end_utc: '2026-06-20T12:00:00Z',
			},
			{
				id: 'B1',
				severity: 'watch',
				header_text_en: 'Detour',
				routes: ['24'],
				stops: ['99999'],
				start_utc: '2026-06-20T13:00:00Z',
				end_utc: '2026-06-20T14:00:00Z',
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
	}

	function logRows(): HTMLElement[] {
		const list = screen.queryByRole('list', { name: /past service alerts, newest first/i });
		return list ? within(list).getAllByRole('listitem') : [];
	}

	it('exposes a labeled Line picker and a Stop picker (the type carried once, no per-row prefix)', () => {
		seedFilterFixture();
		render(AlertHistoryScreen);
		// Two combobox pickers, each with its own labeled input; the group label names the
		// type once (the Combobox input carries it as aria-label — no per-row prefix).
		const linePick = document.querySelector('[data-slot="line-pick"]');
		const stopPick = document.querySelector('[data-slot="stop-pick"]');
		expect(linePick).not.toBeNull();
		expect(stopPick).not.toBeNull();
		expect(
			within(linePick as HTMLElement).getByRole('combobox', { name: copyEn.filters.line.label }),
		).toBeInTheDocument();
		expect(
			within(stopPick as HTMLElement).getByRole('combobox', { name: copyEn.filters.stop.label }),
		).toBeInTheDocument();
		expect(linePick?.querySelector('[data-slot="combobox"]')).not.toBeNull();
		expect(stopPick?.querySelector('[data-slot="combobox"]')).not.toBeNull();
		// The old bespoke chip set / SearchInput is GONE.
		expect(document.querySelector('[data-slot="entity-chips"]')).toBeNull();
	});

	it('seeds the Line pick from ?route= and narrows the log to that line', () => {
		seedFilterFixture();
		setUrl('http://localhost/alerts?route=24');
		render(AlertHistoryScreen);
		// Only B1 carries line 24.
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Detour')).toBeInTheDocument();
		expect(screen.queryByText('Line closed')).toBeNull();
		expect(screen.queryByText('Stop moved')).toBeNull();
	});

	it('seeds the Stop pick from ?stop= and narrows the log to that stop (route 24 vs stop never collide)', () => {
		seedFilterFixture();
		setUrl('http://localhost/alerts?stop=52458');
		render(AlertHistoryScreen);
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Stop moved')).toBeInTheDocument();
		expect(screen.queryByText('Detour')).toBeNull();
	});

	it('seeds affects + severity from the URL (promoted axes round-trip)', () => {
		seedFilterFixture();
		setUrl('http://localhost/alerts?affects=lines&severity=critical');
		render(AlertHistoryScreen);
		// affects=lines (L1 + B1) ∩ severity=critical (L1) → just L1.
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Line closed')).toBeInTheDocument();
		// The seeded axes are reflected on the radiogroups.
		expect(
			(
				screen.getByRole('radio', { name: copyEn.filters.entity.lines }) as HTMLElement
			).getAttribute('aria-checked'),
		).toBe('true');
	});
});

describe('AlertHistory date window (?from/?to)', () => {
	function seedWindowFixture(): void {
		fixture.alerts = [
			{
				id: 'early',
				severity: 'watch',
				header_text_en: 'Early alert',
				routes: ['10'],
				stops: [],
				start_utc: '2026-06-01T09:00:00Z',
				end_utc: '2026-06-01T10:00:00Z',
			},
			{
				id: 'late',
				severity: 'watch',
				header_text_en: 'Late alert',
				routes: ['20'],
				stops: [],
				start_utc: '2026-06-20T09:00:00Z',
				end_utc: '2026-06-20T10:00:00Z',
			},
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
	}

	function logRows(): HTMLElement[] {
		const list = screen.queryByRole('list', { name: /past service alerts, newest first/i });
		return list ? within(list).getAllByRole('listitem') : [];
	}

	it('seeds ?from/?to and clips the log to alerts intersecting the span', () => {
		seedWindowFixture();
		// Payload carries the served span so availableDates covers the seed.
		(fixture as AlertHistory).window_start = '2026-06-01';
		(fixture as AlertHistory).window_end = '2026-06-30';
		setUrl('http://localhost/alerts?from=2026-06-15&to=2026-06-25');
		render(AlertHistoryScreen);
		// Only the late alert intersects [06-15, 06-25].
		expect(logRows()).toHaveLength(1);
		expect(screen.getByText('Late alert')).toBeInTheDocument();
		expect(screen.queryByText('Early alert')).toBeNull();
	});

	it('renders the date-range picker over the served span (both native date inputs present)', () => {
		seedWindowFixture();
		(fixture as AlertHistory).window_start = '2026-06-01';
		(fixture as AlertHistory).window_end = '2026-06-30';
		render(AlertHistoryScreen);
		const picker = document.querySelector('[data-slot="date-range"]');
		expect(picker).not.toBeNull();
		// From + To are now native <input type="date"> calendar pickers (not <select>s).
		expect((picker as HTMLElement).querySelectorAll('input[type="date"]').length).toBe(2);
	});

	it('clamps unavailable URL bounds away and restores the full served log', async () => {
		seedWindowFixture();
		(fixture as AlertHistory).window_start = '2026-06-01';
		(fixture as AlertHistory).window_end = '2026-06-30';
		setUrl('http://localhost/alerts?from=2026-05-01&to=2026-07-01');
		render(AlertHistoryScreen);

		await waitFor(() => {
			expect(nav.url.searchParams.get('from')).toBeNull();
			expect(nav.url.searchParams.get('to')).toBeNull();
			expect(logRows()).toHaveLength(2);
		});
	});

	it('hides the picker with honest absence when NOTHING is datable (no window fields, undatable entries)', () => {
		fixture.alerts = [
			{ id: 'u', severity: 'watch', header_text_en: 'Undatable', routes: ['10'], stops: [] },
		] as unknown as AlertHistory['alerts'];
		fixture.breakdown = null;
		render(AlertHistoryScreen);
		const pick = document.querySelector('[data-slot="window-pick"]');
		expect(pick).not.toBeNull();
		// The DateRangePicker renders its honest-absence AbsentValue (no selects).
		expect(pick?.querySelector('[data-slot="date-range"]')).toBeNull();
		expect(pick?.querySelector('[data-slot="absent-value"]')).not.toBeNull();
	});
});

describe('AlertHistory retained archive integration', () => {
	it('keeps first-seen-only archive entries ahead of older current-shape entries', async () => {
		(fixture as AlertHistory).window_start = '2026-06-20';
		(fixture as AlertHistory).window_end = '2026-06-22';
		archiveState.index = makeArchiveIndex();
		archiveState.entries = [
			makeArchiveEntry('archive-newest', 'Archive newest', '2026-06-21', '2026-06-21', {
				start_utc: null,
				end_utc: null,
				first_seen_utc: '2026-06-21T08:00:00Z' as AlertArchiveEntry['first_seen_utc'],
			}),
			makeArchiveEntry('current-older', 'Current older', '2026-06-20', '2026-06-20'),
		];

		render(AlertHistoryScreen);
		await waitFor(() => expect(ports.getAlertArchiveRange).toHaveBeenCalled());

		const list = screen.getByRole('list', { name: /past service alerts, newest first/i });
		const rows = within(list).getAllByRole('listitem');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toHaveTextContent('Archive newest');
		expect(rows[1]).toHaveTextContent('Current older');
	});

	it('loads the clamped current archive range before rendering every calculation', async () => {
		(fixture as AlertHistory).window_start = '2026-06-20';
		(fixture as AlertHistory).window_end = '2026-06-22';
		archiveState.index = makeArchiveIndex();
		archiveState.entries = [
			makeArchiveEntry('archive-current', 'Archive current alert', '2026-06-21', '2026-06-21'),
		];

		const { container } = render(AlertHistoryScreen);

		await waitFor(() =>
			expect(ports.getAlertArchiveRange).toHaveBeenCalledWith(
				archiveState.index,
				{ from: '2026-06-20', to: '2026-06-22' },
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			),
		);
		expect(screen.getByText('Archive current alert')).toBeInTheDocument();
		expect(screen.queryByText('Service alert')).toBeNull();
		expect(within(card(container, 'alerts-window')).getByText('1')).toBeInTheDocument();
		expect(
			within(card(container, 'alerts-breakdown')).getByText('Construction'),
		).toBeInTheDocument();
		expect(container.querySelector('[data-slot="history-navigator"]')).not.toBeNull();
		expect(nav.url.searchParams.get('from')).toBeNull();
		expect(nav.url.searchParams.get('to')).toBeNull();
		expect(container.querySelector('[data-slot="clear-filters"]')).toBeNull();
	});

	it('uses one selected cross-month archive array for filters, headline, breakdown, and log', async () => {
		(fixture as AlertHistory).window_start = '2026-06-20';
		(fixture as AlertHistory).window_end = '2026-06-22';
		fixture.breakdown = {
			by_cause: [{ key: 'SERVER_ONLY', count: 500, median_duration_min: 999 }],
			by_effect: [],
			by_severity: [],
		};
		archiveState.index = makeArchiveIndex();
		archiveState.entries = [
			makeArchiveEntry('older', 'Older retained alert', '2026-05-10', '2026-05-11', {
				duration_min: 120,
				cause: 'ACCIDENT',
			}),
			makeArchiveEntry('newer', 'Newer retained alert', '2026-06-20', '2026-06-20', {
				duration_min: 60,
			}),
			makeArchiveEntry('other-route', 'Other route', '2026-06-15', '2026-06-15', {
				routes: ['10'],
			}),
		];
		setUrl('http://localhost/alerts?from=2026-05-01&to=2026-06-30&route=24&severity=watch');

		const { container } = render(AlertHistoryScreen);

		await waitFor(() =>
			expect(ports.getAlertArchiveRange).toHaveBeenCalledWith(
				archiveState.index,
				{ from: '2026-05-01', to: '2026-06-30' },
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			),
		);
		expect(screen.getByText('Older retained alert')).toBeInTheDocument();
		expect(screen.getByText('Newer retained alert')).toBeInTheDocument();
		expect(screen.queryByText('Other route')).toBeNull();
		expect(within(card(container, 'alerts-window')).getByText('2')).toBeInTheDocument();
		expect(
			within(card(container, 'alerts-window')).getByText('median duration 90 min'),
		).toBeInTheDocument();
		const causes = within(card(container, 'alerts-breakdown')).getByRole('list', {
			name: /distribution by cause/i,
		});
		expect(within(causes).getByText('Accident')).toBeInTheDocument();
		expect(within(causes).getByText('Construction')).toBeInTheDocument();
		expect(within(causes).queryByText('SERVER_ONLY')).toBeNull();
		expect(container.querySelector('[data-slot="alert-truncated"]')).toBeNull();
	});

	it('resolves localized archive source copy only when a hidden row is expanded', async () => {
		currentLocale.value = 'fr';
		(fixture as AlertHistory).window_start = '2026-06-20';
		(fixture as AlertHistory).window_end = '2026-06-22';
		archiveState.index = makeArchiveIndex();
		archiveState.entries = [
			...Array.from({ length: 25 }, (_, index) =>
				makeArchiveEntry(`visible-${index}`, `Visible ${index}`, '2026-06-21', '2026-06-21'),
			),
			makeArchiveEntry('hidden-source', 'Your line', '2026-06-20', '2026-06-20', {
				header_text: 'Votre ligne',
				description: '<p>Avis caché &amp; <strong>nettoyé</strong>.</p>',
				description_en: '<p>Hidden &amp; <strong>scrubbed</strong> notice.</p>',
				url: 'https://stm.info/fr/infos/etat-du-service/travaux',
			}),
		];
		setUrl('http://localhost/fr/alerts');

		const { container } = render(AlertHistoryScreen);
		await waitFor(() => expect(ports.getAlertArchiveRange).toHaveBeenCalled());
		const logCard = card(container, 'alerts-log');

		expect(logCard.querySelectorAll('[data-slot="alert-row"]')).toHaveLength(25);
		expect(screen.queryByText('Avis caché & nettoyé.')).toBeNull();
		expect(screen.queryByText('Hidden & scrubbed notice.')).toBeNull();

		await fireEvent.click(
			within(logCard).getByRole('button', { name: alertHistoryCopy.fr.more(1) }),
		);
		const localizedCopy = screen.getByText('Avis caché & nettoyé.');
		const hiddenRow = localizedCopy.closest('[data-slot="alert-row"]') as HTMLElement;
		expect(hiddenRow).not.toBeNull();
		expect(hiddenRow.querySelector('strong')).toBeNull();
		expect(screen.queryByText('Hidden & scrubbed notice.')).toBeNull();
		const externalLink = within(hiddenRow).getByRole('link');
		expect(externalLink).toHaveAttribute(
			'href',
			'https://stm.info/fr/infos/etat-du-service/travaux',
		);
		expect(externalLink).toHaveAttribute('target', '_blank');
		expect(externalLink.getAttribute('rel')).toContain('noopener');
	});

	it('keeps the legacy newest-window fallback and truncation when the optional index is null', () => {
		(fixture as AlertHistory).truncated = true;
		(fixture as AlertHistory).total_in_window = 512;
		archiveState.index = null;

		render(AlertHistoryScreen);

		expect(ports.getAlertArchiveRange).not.toHaveBeenCalled();
		expect(document.querySelector('[data-slot="alert-truncated"]')).toHaveTextContent(
			copyEn.truncatedNote(2, 512),
		);
	});

	it('renders an archive-backed quiet range as healthy empty, not legacy rows', async () => {
		(fixture as AlertHistory).window_start = '2026-06-20';
		(fixture as AlertHistory).window_end = '2026-06-22';
		archiveState.index = makeArchiveIndex();
		archiveState.entries = [];

		const { container } = render(AlertHistoryScreen);

		await waitFor(() => expect(ports.getAlertArchiveRange).toHaveBeenCalled());
		expect(container.querySelector('[data-slot="edge-state"]')).toHaveAttribute(
			'data-variant',
			'empty-avis',
		);
		expect(screen.queryByRole('list', { name: /past service alerts, newest first/i })).toBeNull();
	});

	it('normalizes an inverted complete range and preserves unrelated filters in one mirror', async () => {
		(fixture as AlertHistory).window_start = '2026-06-20';
		(fixture as AlertHistory).window_end = '2026-06-22';
		archiveState.index = makeArchiveIndex();
		archiveState.entries = [
			makeArchiveEntry('older', 'Older retained alert', '2026-05-10', '2026-05-11'),
		];
		setUrl(
			'http://localhost/alerts?from=2026-06-30&to=2026-05-01&affects=lines&severity=watch&route=24&stop=52458',
		);

		render(AlertHistoryScreen);

		await waitFor(() => {
			expect(Object.fromEntries(nav.url.searchParams)).toEqual({
				affects: 'lines',
				severity: 'watch',
				route: '24',
				stop: '52458',
				from: '2026-05-01',
				to: '2026-06-30',
			});
		});
		expect(replaceState).toHaveBeenCalledTimes(1);
	});

	it.each([
		['blank pair', '?from=&to='],
		['half pair', '?from=2026-06-01'],
		['impossible date', '?from=2026-02-30&to=2026-03-01'],
		['outside coverage', '?from=2025-12-31&to=2026-06-01'],
	])('corrects a %s once, removes both bounds, and announces it', async (_, query) => {
		(fixture as AlertHistory).window_start = '2026-06-20';
		(fixture as AlertHistory).window_end = '2026-06-22';
		archiveState.index = makeArchiveIndex();
		archiveState.entries = [
			makeArchiveEntry('archive-current', 'Archive current alert', '2026-06-21', '2026-06-21'),
		];
		setUrl(`http://localhost/alerts${query}&route=24`);

		render(AlertHistoryScreen);

		await waitFor(() => {
			expect(nav.url.searchParams.get('from')).toBeNull();
			expect(nav.url.searchParams.get('to')).toBeNull();
			expect(nav.url.searchParams.get('route')).toBe('24');
		});
		const announcement = document.querySelector('[data-slot="history-announcement"]');
		expect(announcement).not.toHaveTextContent(/^\s*$/);
		expect(replaceState).toHaveBeenCalledTimes(1);
	});

	it('announces a correction once outside collapsed controls before and after the mobile sheet opens', async () => {
		localStorage.setItem('transit:quiet-mode', 'true');
		(fixture as AlertHistory).window_start = '2026-06-20';
		(fixture as AlertHistory).window_end = '2026-06-22';
		archiveState.index = makeArchiveIndex();
		archiveState.entries = [
			makeArchiveEntry('archive-current', 'Archive current alert', '2026-06-21', '2026-06-21'),
		];
		setUrl('http://localhost/alerts?from=&to=&route=24');

		const { container } = render(AlertHistoryScreen);
		const expected = copyEn.filters.history.correction.malformed;

		await waitFor(() => expect(nav.url.searchParams.has('from')).toBe(false));
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() =>
			expect(within(rail).getByRole('button', { name: copyEn.filters.railLabel })).toHaveAttribute(
				'aria-expanded',
				'false',
			),
		);
		expect(screen.queryByRole('dialog')).toBeNull();

		let liveRegions = container.querySelectorAll('[role="status"][aria-live="polite"]');
		expect(liveRegions).toHaveLength(1);
		expect(liveRegions[0]).toHaveTextContent(expected);
		expect(liveRegions[0]?.closest('[data-slot="surface-rail"]')).toBeNull();
		let navigatorCopies = container.querySelectorAll('[data-slot="history-announcement"]');
		expect(navigatorCopies).toHaveLength(1);
		const navigatorCopy = navigatorCopies[0];
		expect(navigatorCopy).toHaveTextContent(expected);
		expect(navigatorCopy).not.toHaveAttribute('role');

		await fireEvent.click(screen.getByRole('button', { name: new RegExp(copyEn.rail.open, 'i') }));
		expect(screen.getByRole('dialog', { name: copyEn.rail.label })).toBeInTheDocument();
		liveRegions = container.querySelectorAll('[role="status"][aria-live="polite"]');
		expect(liveRegions).toHaveLength(1);
		navigatorCopies = container.querySelectorAll('[data-slot="history-announcement"]');
		expect(navigatorCopies).toHaveLength(1);
		expect(navigatorCopies[0]).toBe(navigatorCopy);
		for (const copy of navigatorCopies) {
			expect(copy).toHaveTextContent(expected);
			expect(copy).not.toHaveAttribute('role');
			expect(copy).not.toHaveAttribute('aria-live');
		}
		expect(replaceState).toHaveBeenCalledTimes(1);
	});

	it('renders localized coverage, selection, and correction copy', async () => {
		currentLocale.value = 'fr';
		(fixture as AlertHistory).window_start = '2026-06-20';
		(fixture as AlertHistory).window_end = '2026-06-22';
		archiveState.index = makeArchiveIndex();
		archiveState.entries = [
			makeArchiveEntry('courant', 'Avis courant', '2026-06-21', '2026-06-21'),
		];
		setUrl('http://localhost/fr/alerts?from=&to=');

		const { container } = render(AlertHistoryScreen);

		await waitFor(() =>
			expect(container.querySelector('[data-slot="history-coverage"]')).not.toBeNull(),
		);
		expect(container.querySelector('[data-slot="history-coverage"]')).toHaveTextContent('Archives');
		expect(container.querySelector('[data-slot="history-selection"]')).toHaveTextContent(
			'Sélection',
		);
		expect(document.querySelector('[data-slot="history-announcement"]')).not.toHaveTextContent(
			/^\s*$/,
		);
	});
});

describe('AlertHistory combined rail and disclosure behavior', () => {
	it('mounts filters first and TOC second in one desktop SurfaceRail', () => {
		const { container } = render(AlertHistoryScreen);
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const filters = rail.querySelector('[data-slot="alert-filters"]') as HTMLElement;
		const toc = rail.querySelector('[data-slot="section-toc"]') as HTMLElement;

		expect(rail).not.toBeNull();
		expect(filters).not.toBeNull();
		expect(toc).not.toBeNull();
		expect(filters.compareDocumentPosition(toc) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
		expect(document.querySelectorAll('[data-slot="line-pick"]')).toHaveLength(1);
		expect(document.querySelector('.alert-history-filters')).toBeNull();
	});

	it('persists the Filters and TOC disclosures independently with locale-free Alerts keys', async () => {
		const first = render(AlertHistoryScreen);
		const firstRail = first.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const firstFilters = within(firstRail).getByRole('button', { name: 'Filters' });
		const firstToc = within(firstRail).getByRole('button', { name: 'On this page' });

		expect(firstFilters).toHaveAttribute('aria-expanded', 'true');
		expect(firstToc).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(firstFilters);
		expect(firstFilters).toHaveAttribute('aria-expanded', 'false');
		expect(firstToc).toHaveAttribute('aria-expanded', 'true');
		expect(sessionStorage.getItem('transit.persisted:alerts-filters')).toBe('false');
		expect(sessionStorage.getItem('transit.persisted:alerts-toc')).toBeNull();
		first.unmount();

		const second = render(AlertHistoryScreen);
		const secondRail = second.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() =>
			expect(within(secondRail).getByRole('button', { name: 'Filters' })).toHaveAttribute(
				'aria-expanded',
				'false',
			),
		);
		expect(within(secondRail).getByRole('button', { name: 'On this page' })).toHaveAttribute(
			'aria-expanded',
			'true',
		);
	});

	it('Collapse all and Expand all synchronize both rail disclosures and every article card', async () => {
		const { container } = render(AlertHistoryScreen);
		const ids = ['alerts-window', 'alerts-breakdown', 'alerts-log'];
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const railTriggers = [
			within(rail).getByRole('button', { name: 'Filters' }),
			within(rail).getByRole('button', { name: 'On this page' }),
		];

		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'true');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'true');

		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'false');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'false');
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Expand all');

		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'true');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByTestId('quiet-mode-toggle')).toHaveTextContent('Collapse all');
	});

	it('Always start collapsed initializes both rail disclosures and every article card closed', async () => {
		localStorage.setItem('transit:quiet-mode', 'true');
		const { container } = render(AlertHistoryScreen);
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;

		await waitFor(() => {
			expect(within(rail).getByRole('button', { name: 'Filters' })).toHaveAttribute(
				'aria-expanded',
				'false',
			);
			expect(within(rail).getByRole('button', { name: 'On this page' })).toHaveAttribute(
				'aria-expanded',
				'false',
			);
			for (const id of ['alerts-window', 'alerts-breakdown', 'alerts-log']) {
				expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'false');
			}
		});
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');
	});

	it('opens the target card before a TOC scroll while leaving sibling cards closed', async () => {
		const { container } = render(AlertHistoryScreen);
		await fireEvent.click(cardTrigger(container, 'alerts-window'));
		await fireEvent.click(cardTrigger(container, 'alerts-breakdown'));
		const statesAtScroll: Array<{ window: string | null; breakdown: string | null }> = [];
		Element.prototype.scrollIntoView = vi.fn(() => {
			statesAtScroll.push({
				window: cardTrigger(container, 'alerts-window').getAttribute('aria-expanded'),
				breakdown: cardTrigger(container, 'alerts-breakdown').getAttribute('aria-expanded'),
			});
		});

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await fireEvent.click(within(rail).getByRole('button', { name: 'Breakdown' }));
		await waitFor(() => expect(statesAtScroll).toHaveLength(1));
		expect(statesAtScroll[0]).toEqual({ window: 'false', breakdown: 'true' });
	});

	it('keeps Show more/Show less inside alerts-log and independent of the card disclosure', async () => {
		fixture.alerts = Array.from({ length: 26 }, (_, index) => ({
			id: `alert-${index}`,
			severity: 'watch',
			header_text_en: `Alert ${index}`,
			routes: ['24'],
			stops: [],
			start_utc: `2026-06-${String((index % 20) + 1).padStart(2, '0')}T09:00:00Z`,
			end_utc: `2026-06-${String((index % 20) + 1).padStart(2, '0')}T10:00:00Z`,
			duration_min: 60,
			cause: 'CONSTRUCTION',
			effect: 'DETOUR',
		})) as unknown as AlertHistory['alerts'];
		fixture.breakdown = {
			by_cause: [{ key: 'CONSTRUCTION', count: 26, median_duration_min: 60 }],
			by_effect: [],
			by_severity: [],
		};
		const { container } = render(AlertHistoryScreen);
		const logCard = card(container, 'alerts-log');

		expect(logCard.querySelectorAll('[data-slot="alert-row"]')).toHaveLength(25);
		const more = within(logCard).getByRole('button', { name: '+1 more' });
		expect(card(container, 'alerts-window').contains(more)).toBe(false);
		await fireEvent.click(more);
		expect(logCard.querySelectorAll('[data-slot="alert-row"]')).toHaveLength(26);
		expect(within(logCard).getByRole('button', { name: 'Show less' })).toBeInTheDocument();

		await fireEvent.click(cardTrigger(container, 'alerts-log'));
		expect(cardTrigger(container, 'alerts-log')).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(cardTrigger(container, 'alerts-log'));
		expect(cardTrigger(container, 'alerts-log')).toHaveAttribute('aria-expanded', 'true');
		expect(logCard.querySelectorAll('[data-slot="alert-row"]')).toHaveLength(26);
		expect(within(logCard).getByRole('button', { name: 'Show less' })).toBeInTheDocument();
	});
});

describe('AlertHistory empty state', () => {
	it('keeps the healthy archive-empty ResourceBoundary and renders no article cards or rail', () => {
		fixture.alerts = [];
		const { container } = render(AlertHistoryScreen);
		expect(container.querySelector('[data-slot="article-header"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="edge-state"]')).toHaveAttribute(
			'data-variant',
			'empty-avis',
		);
		expect(container.querySelectorAll('[data-toc^="alerts-"]')).toHaveLength(0);
		expect(container.querySelector('[data-slot="surface-rail"]')).toBeNull();
		expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();
		expect(screen.queryByRole('list', { name: /past service alerts, newest first/i })).toBeNull();
		expect(container.querySelector('[data-slot="alert-breakdown"]')).toBeNull();
	});
});

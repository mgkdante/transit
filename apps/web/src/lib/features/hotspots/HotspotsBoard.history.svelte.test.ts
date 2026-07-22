import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataRefresh } from '$lib/stores';
import type {
	HistoricCollectionIndex,
	HistoricHotspotsDay,
	Hotspots,
	IsoUtc,
} from '$lib/v1/schemas';

const harness = vi.hoisted(() => {
	const state = {
		url: new URL('http://localhost/hotspots'),
	};
	const page = {
		get url() {
			return state.url;
		},
		state: {},
	};
	const replaceState = vi.fn((url: string | URL) => {
		state.url = new URL(url, 'http://localhost');
	});
	const mirrorSearchParams = vi.fn((values: Record<string, string | null>) => {
		const next = new URL(state.url);
		for (const [key, value] of Object.entries(values)) {
			if (value == null) next.searchParams.delete(key);
			else next.searchParams.set(key, value);
		}
		state.url = next;
	});
	return {
		state,
		page,
		replaceState,
		mirrorSearchParams,
		goto: vi.fn(),
		locale: { value: 'en' as 'en' | 'fr' },
		getHotspots: vi.fn(),
		getHotspotsHistoryIndex: vi.fn(),
		getHotspotsHistoryDay: vi.fn(),
		capturedLadders: [] as unknown[],
	};
});

vi.mock('$app/state', () => ({ page: harness.page }));
vi.mock('$app/navigation', () => ({
	replaceState: harness.replaceState,
	goto: harness.goto,
}));
vi.mock('$lib/site/urlMirror', () => ({
	mirrorSearchParams: harness.mirrorSearchParams,
}));
vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => harness.locale.value };
});
vi.mock('$lib/v1/repositories/historic', () => ({
	getHotspots: harness.getHotspots,
	getHotspotsHistoryIndex: harness.getHotspotsHistoryIndex,
	getHotspotsHistoryDay: harness.getHotspotsHistoryDay,
}));
vi.mock('./selectors/hotspotLadder', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./selectors/hotspotLadder')>();
	return {
		...actual,
		selectHotspotLadder: (...args: Parameters<typeof actual.selectHotspotLadder>) => {
			const result = actual.selectHotspotLadder(...args);
			harness.capturedLadders.push(result);
			return result;
		},
	};
});

import HotspotsBoard from './HotspotsBoard.svelte';
import { copy as hotspotsCopy } from './hotspots.copy';

const AVAILABLE_DATES = ['2026-06-20', '2026-06-22', '2026-06-25'] as const;

const historyIndex: HistoricCollectionIndex = {
	generated_utc: '2026-07-01T00:00:00Z' as IsoUtc,
	family: 'hotspots',
	selection_mode: 'date',
	collection_generation_id: 'a'.repeat(64),
	available_dates: [...AVAILABLE_DATES],
};

function payload(
	label: string,
	generatedUtc: string,
	options: { empty?: boolean; rankedEmpty?: boolean; date?: string } = {},
): Hotspots | HistoricHotspotsDay {
	const value: Hotspots = {
		generated_utc: generatedUtc as IsoUtc,
		hotspots: [],
		by_grain: [
			{
				grain: 'day',
				date: options.date ?? '2026-06-25',
				window_end: options.date ?? '2026-06-25',
				entries:
					options.empty || options.rankedEmpty
						? []
						: [
								{
									rank: 1,
									type: 'route',
									id: '51',
									name: `${label} line`,
									severe_pct: 61,
									observation_count: 120,
								},
								{
									rank: 1,
									type: 'stop',
									id: 'S1',
									name: `${label} stop`,
									severe_pct: 52,
									observation_count: 90,
								},
							],
				tray: options.empty
					? []
					: [
							{
								rank: null,
								type: 'route',
								id: 'R-null',
								name: `${label} null tray`,
								severe_pct: 4,
								observation_count: null,
							},
							{
								rank: null,
								type: 'stop',
								id: 'S-zero',
								name: `${label} zero tray`,
								severe_pct: 0,
								observation_count: 0,
							},
						],
			},
			{
				grain: 'week',
				date: options.date ?? '2026-06-25',
				window_end: options.date ?? '2026-06-25',
				entries:
					options.empty || options.rankedEmpty
						? []
						: [
								{
									rank: 1,
									type: 'route',
									id: '161',
									name: `${label} week line`,
									severe_pct: 57,
									observation_count: 500,
								},
							],
				tray: [],
			},
		],
	};
	return options.date ? { ...value, date: options.date } : value;
}

const current = payload('Current', '2026-06-25T12:00:00Z') as Hotspots;
const retained20 = payload('Retained 20', '2026-06-20T23:59:59Z', {
	date: '2026-06-20',
}) as HistoricHotspotsDay;
const retained22 = payload('Retained 22', '2026-06-22T23:59:59Z', {
	date: '2026-06-22',
}) as HistoricHotspotsDay;

function reset(url = 'http://localhost/hotspots'): void {
	harness.state.url = new URL(url);
	harness.locale.value = 'en';
	harness.replaceState.mockClear();
	harness.mirrorSearchParams.mockClear();
	harness.goto.mockClear();
	harness.getHotspots.mockReset().mockResolvedValue(current);
	harness.getHotspotsHistoryIndex.mockReset().mockResolvedValue(historyIndex);
	harness.getHotspotsHistoryDay.mockReset().mockImplementation(async (date: string) => {
		if (date === '2026-06-20') return retained20;
		if (date === '2026-06-22') return retained22;
		throw new Error(`Unexpected retained date ${date}`);
	});
	harness.capturedLadders = [];
	sessionStorage.clear();
	localStorage.clear();
	Element.prototype.scrollIntoView = vi.fn();
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

function desktopRail(container: HTMLElement): HTMLElement {
	const rail = container.querySelector<HTMLElement>('[data-slot="surface-rail"]');
	if (!rail) throw new Error('Expected the desktop Hotspots rail');
	return rail;
}

beforeEach(() => reset());
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('HotspotsBoard retained date history', () => {
	it('keeps the default current article intact while discovering dates without fetching a day artifact', async () => {
		const { container } = render(HotspotsBoard);
		await screen.findAllByText('Current line');
		await waitFor(() => expect(harness.getHotspotsHistoryIndex).toHaveBeenCalledTimes(1));

		expect(harness.getHotspots).toHaveBeenCalledTimes(1);
		expect(harness.getHotspotsHistoryDay).not.toHaveBeenCalled();
		const rail = desktopRail(container);
		expect(within(rail).getByLabelText('History date')).toHaveValue('2026-06-25');
		const controlsBody = rail.querySelector('[data-slot="controls-body"]') as HTMLElement;
		expect(controlsBody.querySelector('[data-slot="history-navigator"]')).not.toBeNull();
		expect(controlsBody.querySelector('[data-slot="grain-picker"]')).not.toBeNull();
		expect(
			controlsBody
				.querySelector('[data-slot="history-navigator"]')
				?.compareDocumentPosition(controlsBody.querySelector('[data-slot="grain-picker"]')!),
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		const grain = within(rail).getByRole('radiogroup', { name: 'Granularity' });
		expect(grain).toHaveAttribute('data-variant', 'time-grid');
		expect(
			within(grain)
				.getAllByRole('radio')
				.map((radio) => radio.textContent?.trim()),
		).toEqual(['Day', 'Week', 'Month', 'Peak hours']);
		expect(screen.getByTestId('quiet-mode-controls').querySelectorAll('button')).toHaveLength(2);
		expect(screen.getAllByRole('link', { name: /Current line/ })[0]).toHaveAttribute(
			'href',
			'/lines/51',
		);

		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector(':scope > button') as HTMLButtonElement);
		const sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		const mobileHistory = sheet.querySelector('[data-slot="history-navigator"]')!;
		const mobileGrain = sheet.querySelector('[data-slot="grain-picker"]')!;
		expect(mobileHistory.compareDocumentPosition(mobileGrain)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
	});

	it('falls back to the current article when optional discovery is missing', async () => {
		reset('http://localhost/hotspots?date=2026-06-20&campaign=walk');
		harness.getHotspotsHistoryIndex.mockResolvedValue(null);
		const { container } = render(HotspotsBoard);

		await screen.findAllByText('Current line');
		expect(harness.getHotspots).toHaveBeenCalledTimes(1);
		expect(harness.getHotspotsHistoryDay).not.toHaveBeenCalled();
		expect(container.querySelector('[data-slot="history-navigator"]')).toBeNull();
		expect(desktopRail(container)).not.toBeNull();
		expect(harness.state.url.searchParams.get('campaign')).toBe('walk');
	});

	it('loads only a valid older artifact and drives cards, timestamp, captions, and clean links from it', async () => {
		reset('http://localhost/hotspots?date=2026-06-22&grain=week&n=5&campaign=walk');
		const { container } = render(HotspotsBoard);

		await screen.findAllByText('Retained 22 week line');
		expect(harness.getHotspots).not.toHaveBeenCalled();
		expect(harness.getHotspotsHistoryDay).toHaveBeenCalledWith(
			'2026-06-22',
			historyIndex,
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(screen.queryByText(/Current week line/)).toBeNull();
		expect(
			screen.getByText(
				'The worst hotspot in the selected retained observations and the evidence behind it',
			),
		).toBeInTheDocument();
		expect(screen.queryByText('The worst current hotspot and the evidence behind it')).toBeNull();
		for (const caption of screen.getAllByText(/Available retained observations ending/)) {
			expect(caption).toHaveTextContent('Jun 22');
		}
		expect(container.querySelector('time[datetime="2026-06-22T23:59:59Z"]')).not.toBeNull();
		const retainedLink = screen.getAllByRole('link', { name: /Retained 22 week line/ })[0];
		expect(retainedLink).toHaveAttribute('href', '/lines/161');
		expect(retainedLink.getAttribute('href')).not.toContain('date=');
		expect(harness.state.url.searchParams.get('campaign')).toBe('walk');
		expect(harness.state.url.searchParams.get('date')).toBe('2026-06-22');
		expect(harness.state.url.searchParams.get('grain')).toBe('week');
		expect(harness.state.url.searchParams.get('n')).toBe('5');
	});

	it('uses retained stand-down copy when a retained grain has tray evidence but no ranked hotspot', async () => {
		reset('http://localhost/hotspots?date=2026-06-20');
		harness.getHotspotsHistoryDay.mockResolvedValue(
			payload('Retained tray only', '2026-06-20T23:59:59Z', {
				date: '2026-06-20',
				rankedEmpty: true,
			}),
		);
		render(HotspotsBoard);

		await screen.findAllByText('Retained tray only null tray');
		expect(
			screen.getByText('No hotspot ranks in the selected retained observations.'),
		).toBeInTheDocument();
		expect(screen.queryByText('Nothing is a hotspot right now.')).toBeNull();
	});

	it('canonicalizes an explicit latest date to current and cleans only date', async () => {
		reset('http://localhost/hotspots?date=2026-06-25&grain=week&campaign=walk');
		render(HotspotsBoard);

		await screen.findAllByText('Current week line');
		await waitFor(() => expect(harness.state.url.searchParams.get('date')).toBeNull());
		expect(harness.getHotspots).toHaveBeenCalledTimes(1);
		expect(harness.getHotspotsHistoryDay).not.toHaveBeenCalled();
		expect(harness.state.url.searchParams.get('grain')).toBe('week');
		expect(harness.state.url.searchParams.get('campaign')).toBe('walk');
	});

	it.each([
		['2026-06-25', null],
		['2026-06-21', 'That day was not published. Showing the latest hotspots.'],
	] as const)(
		'forgets cleaned explicit date %s so a later discovery refresh cannot resurrect it',
		async (rawDate, correction) => {
			reset(`http://localhost/hotspots?date=${rawDate}`);
			const newlyAdvertised = payload('Newly advertised', '2026-06-25T23:59:59Z', {
				date: rawDate,
			}) as HistoricHotspotsDay;
			harness.getHotspotsHistoryDay.mockResolvedValue(newlyAdvertised);
			const { container } = render(HotspotsBoard);

			await screen.findAllByText('Current line');
			await waitFor(() => expect(harness.state.url.searchParams.get('date')).toBeNull());
			if (correction) {
				expect(
					container.querySelector('[data-slot="history-page-announcement"]'),
				).toHaveTextContent(correction);
			}

			harness.getHotspotsHistoryIndex.mockResolvedValue({
				...historyIndex,
				available_dates: ['2026-06-20', '2026-06-21', '2026-06-25', '2026-06-26'],
			});
			dataRefresh.bumpEpoch();
			await waitFor(() => expect(harness.getHotspotsHistoryIndex).toHaveBeenCalledTimes(2));
			await waitFor(() => expect(harness.getHotspots).toHaveBeenCalledTimes(2));
			expect(harness.getHotspotsHistoryDay).not.toHaveBeenCalled();
			expect(screen.queryByText(/Newly advertised line/)).toBeNull();
			expect(harness.state.url.searchParams.get('date')).toBeNull();
		},
	);

	it.each([
		['not-a-date', 'That date was not valid. Showing the latest hotspots.'],
		['2026-06-21', 'That day was not published. Showing the latest hotspots.'],
	] as const)('corrects %s once to current with an honest announcement', async (date, message) => {
		reset(`http://localhost/hotspots?date=${date}&campaign=walk`);
		const { container } = render(HotspotsBoard);

		await screen.findAllByText('Current line');
		const rail = desktopRail(container);
		await waitFor(() =>
			expect(rail.querySelector('[data-slot="history-announcement"]')).toHaveTextContent(message),
		);
		const navigatorCopy = rail.querySelector('[data-slot="history-announcement"]');
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector(':scope > button') as HTMLButtonElement);
		expect(container.querySelectorAll('[data-slot="history-announcement"]')).toHaveLength(1);
		expect(container.querySelector('[data-slot="history-announcement"]')).toBe(navigatorCopy);
		for (const copy of container.querySelectorAll('[data-slot="history-announcement"]')) {
			expect(copy).not.toHaveAttribute('role');
			expect(copy).not.toHaveAttribute('aria-live');
		}
		const live = screen.getByRole('status');
		expect(container.querySelectorAll('[data-slot="history-page-announcement"]')).toHaveLength(1);
		expect(live).toHaveTextContent(message);
		expect(live).toHaveAttribute('aria-live', 'polite');
		expect(live).toHaveAttribute('aria-atomic', 'true');
		expect(harness.getHotspotsHistoryDay).not.toHaveBeenCalled();
		expect(harness.state.url.searchParams.get('date')).toBeNull();
		expect(harness.state.url.searchParams.get('campaign')).toBe('walk');
	});

	it('uses gap-skipping neighbors and suppresses an aborted stale date completion', async () => {
		reset('http://localhost/hotspots?date=2026-06-20');
		const stale = deferred<HistoricHotspotsDay>();
		let staleSignal: AbortSignal | undefined;
		harness.getHotspotsHistoryDay.mockImplementation(
			(date: string, _index: HistoricCollectionIndex, ctx: { signal: AbortSignal }) => {
				if (date === '2026-06-20') {
					staleSignal = ctx.signal;
					return stale.promise;
				}
				return Promise.resolve(retained22);
			},
		);
		const { container } = render(HotspotsBoard);
		await waitFor(() => expect(harness.getHotspotsHistoryDay).toHaveBeenCalledTimes(1));
		const rail = desktopRail(container);
		expect(within(rail).getByRole('button', { name: 'Previous date' })).toBeDisabled();
		expect(within(rail).getByRole('button', { name: 'Next date' })).not.toBeDisabled();

		await fireEvent.click(within(rail).getByRole('button', { name: 'Next date' }));
		await screen.findAllByText('Retained 22 line');
		expect(staleSignal?.aborted).toBe(true);
		stale.resolve(retained20);
		await Promise.resolve();
		expect(screen.queryByText(/Retained 20 line/)).toBeNull();
		expect(harness.state.url.searchParams.get('date')).toBe('2026-06-22');
	});

	it('mirrors date, grain, and n atomically without clobbering unrelated parameters', async () => {
		reset('http://localhost/hotspots?date=2026-06-20&grain=week&n=5&campaign=walk');
		const { container } = render(HotspotsBoard);
		await screen.findAllByText('Retained 20 week line');
		const rail = desktopRail(container);

		await fireEvent.click(within(rail).getByRole('button', { name: 'Next date' }));
		await screen.findAllByText('Retained 22 week line');
		await waitFor(() =>
			expect(harness.mirrorSearchParams).toHaveBeenLastCalledWith({
				date: '2026-06-22',
				grain: 'week',
				n: '5',
			}),
		);
		for (const [values] of harness.mirrorSearchParams.mock.calls) {
			expect(Object.keys(values).sort()).toEqual(['date', 'grain', 'n']);
		}
		expect(harness.state.url.searchParams.get('campaign')).toBe('walk');
	});

	it('renders retained ranking, clean actions, honest tray readings, and chart-only scroll structure', async () => {
		reset('http://localhost/hotspots?date=2026-06-22');
		const { container } = render(HotspotsBoard);
		await screen.findAllByText('Retained 22 line');

		const ladders = harness.capturedLadders as Array<{
			spec: {
				kind: string;
				domain?: readonly number[];
				sort?: string;
				rows?: ReadonlyArray<{
					key: string;
					value: number | null;
					href?: string;
					tapPopover?: { action?: { href: string; label: string } };
				}>;
			};
		}>;
		const retainedSpec = ladders
			.map((result) => result.spec)
			.find((spec) => spec.rows?.some((row) => row.key === 'stop-S1'));
		expect(retainedSpec).toMatchObject({ domain: [0, 100], sort: 'given' });
		const stopRow = retainedSpec?.rows?.find((row) => row.key === 'stop-S1');
		expect(stopRow).toMatchObject({
			value: 52,
			href: '/stop/S1',
			tapPopover: { action: { href: '/stop/S1', label: 'View stop' } },
		});

		const stopLink = screen.getByRole('link', { name: /Retained 22 stop/ });
		expect(stopLink).toHaveAttribute('href', '/stop/S1');
		expect(stopLink.getAttribute('href')).not.toContain('date=');
		const lineTable = screen
			.getByText('Retained 22 null tray')
			.closest('table') as HTMLTableElement;
		const nullRow = within(lineTable).getByText('Retained 22 null tray').closest('tr')!;
		expect(nullRow.querySelector('[data-slot="absent-value"]')).not.toBeNull();
		expect(nullRow).not.toHaveTextContent(/\b0\b/);
		const stopTable = screen
			.getByText('Retained 22 zero tray')
			.closest('table') as HTMLTableElement;
		const zeroRow = within(stopTable).getByText('Retained 22 zero tray').closest('tr')!;
		expect(zeroRow.querySelector('.hotspot-tray-readings')).toHaveTextContent('0');
		expect(zeroRow.querySelector('[data-slot="absent-value"]')).toBeNull();

		for (const card of ['hotspots-lines', 'hotspots-stops']) {
			const section = container.querySelector(`[data-toc="${card}"]`)!;
			const output = section.querySelector('[data-slot="chart-output"]')!;
			const viewport = output.querySelector('[data-slot="chart-viewport"]')!;
			expect(viewport.querySelector('[data-slot="chart-canvas"]')).not.toBeNull();
			expect(output.querySelector('[data-slot="hotspot-tray-table"]')).toBeNull();
			expect(section.querySelector('[data-slot="hotspot-tray-table"]')).not.toBeNull();
			expect(output.closest(`[data-toc="${card}"]`)).toBe(section);
		}
	});

	it('keeps an advertised missing day visibly retryable and never substitutes current', async () => {
		reset('http://localhost/hotspots?date=2026-06-22');
		harness.getHotspotsHistoryDay
			.mockRejectedValueOnce(new Error('advertised history artifact not found'))
			.mockResolvedValueOnce(retained22);
		render(HotspotsBoard);

		const retry = await screen.findByRole('button', { name: 'Retry' });
		expect(screen.queryByText(/Current line/)).toBeNull();
		expect(harness.getHotspots).not.toHaveBeenCalled();
		await fireEvent.click(retry);
		await screen.findAllByText('Retained 22 line');
		expect(harness.getHotspotsHistoryDay).toHaveBeenCalledTimes(2);
	});

	it('keeps the navigator rail on a published-empty retained day', async () => {
		reset('http://localhost/hotspots?date=2026-06-20');
		harness.getHotspotsHistoryDay.mockResolvedValue(
			payload('Empty retained', '2026-06-20T23:59:59Z', {
				date: '2026-06-20',
				empty: true,
			}),
		);
		const { container } = render(HotspotsBoard);

		await waitFor(() =>
			expect(container.querySelector('[data-slot="hotspots-empty"]')).not.toBeNull(),
		);
		expect(desktopRail(container)).not.toBeNull();
		expect(within(desktopRail(container)).getByLabelText('History date')).toHaveValue('2026-06-20');
		expect(container.querySelectorAll('[data-toc^="hotspots-"]')).toHaveLength(0);
	});

	it('refetches the selected historical lane globally and reports freshness only from accepted payloads', async () => {
		reset('http://localhost/hotspots?date=2026-06-22');
		const noteFreshness = vi.spyOn(dataRefresh, 'noteDataGeneratedUtc');
		render(HotspotsBoard);
		await screen.findAllByText('Retained 22 line');

		expect(noteFreshness).toHaveBeenCalledWith('2026-06-22T23:59:59Z');
		expect(noteFreshness).not.toHaveBeenCalledWith(historyIndex.generated_utc);
		dataRefresh.bumpEpoch();
		await waitFor(() => expect(harness.getHotspotsHistoryDay).toHaveBeenCalledTimes(2));
		expect(harness.getHotspots).not.toHaveBeenCalled();
		expect(harness.state.url.searchParams.get('date')).toBe('2026-06-22');
	});

	it('defines complete English and French retained-time copy without changing current copy', () => {
		expect(hotspotsCopy.en.history.retainedTopSubtitle).toBe(
			'The worst hotspot in the selected retained observations and the evidence behind it',
		);
		expect(hotspotsCopy.en.history.retainedVerdictNone).toBe(
			'No hotspot ranks in the selected retained observations.',
		);
		expect(hotspotsCopy.fr.history.retainedTopSubtitle).toBe(
			'Le pire point chaud des observations conservées sélectionnées et les preuves qui l’expliquent',
		);
		expect(hotspotsCopy.fr.history.retainedVerdictNone).toBe(
			'Aucun point chaud classé dans les observations conservées sélectionnées.',
		);
		expect(hotspotsCopy.en.cards.top.subtitle).toBe(
			'The worst current hotspot and the evidence behind it',
		);
		expect(hotspotsCopy.en.verdict.none).toBe('Nothing is a hotspot right now.');
	});
});

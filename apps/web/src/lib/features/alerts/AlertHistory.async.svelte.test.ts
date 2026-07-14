import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertArchiveEntry, AlertArchiveIndex, AlertHistory } from '$lib/v1/schemas';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

const ports = vi.hoisted(() => ({
	getAlertHistory: vi.fn(),
	getAlertArchiveIndex: vi.fn(),
	getAlertArchiveRange: vi.fn(),
}));
const nav = vi.hoisted(() => ({ url: new URL('http://localhost/alerts') }));
const replaceState = vi.hoisted(() =>
	vi.fn((url: string | URL) => {
		nav.url = new URL(url, 'http://localhost');
	}),
);

vi.mock('$lib/v1', () => ({
	getAlertHistory: ports.getAlertHistory,
	getAlertArchiveIndex: ports.getAlertArchiveIndex,
	getAlertArchiveRange: ports.getAlertArchiveRange,
}));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return nav.url;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({ replaceState }));
vi.mock('$lib/i18n', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/i18n')>();
	return { ...actual, getLocale: () => 'en' as const };
});

import AlertHistoryScreen from './AlertHistory.svelte';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const HISTORY: AlertHistory = {
	generated_utc: '2026-06-22T12:00:00Z' as AlertHistory['generated_utc'],
	window_start: '2026-06-20',
	window_end: '2026-06-22',
	alerts: [],
	breakdown: null,
};
const INDEX: AlertArchiveIndex = {
	generated_utc: '2026-07-13T12:00:00Z' as AlertArchiveIndex['generated_utc'],
	collection_generation_id: 'alerts-2026-07-13',
	first_available_date: '2026-01-01',
	last_available_date: '2026-07-13',
	total_alerts: 10,
	months: [],
};

function entry(id: string, headline: string, date: string): AlertArchiveEntry {
	return {
		id,
		header_text_en: headline,
		severity: 'watch',
		routes: ['24'],
		stops: [],
		start_utc: `${date}T09:00:00Z` as AlertArchiveEntry['start_utc'],
		end_utc: `${date}T10:00:00Z` as AlertArchiveEntry['end_utc'],
		first_seen_utc: `${date}T08:00:00Z` as AlertArchiveEntry['first_seen_utc'],
		last_seen_utc: `${date}T11:00:00Z` as AlertArchiveEntry['last_seen_utc'],
		duration_min: 60,
	};
}

type RangeCall = {
	window: { from: string; to: string };
	signal: AbortSignal;
	gate: ReturnType<typeof deferred<AlertArchiveEntry[]>>;
};
let rangeCalls: RangeCall[];

beforeEach(() => {
	cleanup();
	quietModeStore.resetForTest();
	nav.url = new URL('http://localhost/alerts');
	replaceState.mockClear();
	rangeCalls = [];
	ports.getAlertHistory.mockReset();
	ports.getAlertArchiveIndex.mockReset();
	ports.getAlertArchiveRange.mockReset();
	ports.getAlertHistory.mockResolvedValue(HISTORY);
	ports.getAlertArchiveIndex.mockResolvedValue(INDEX);
	ports.getAlertArchiveRange.mockImplementation(
		(
			_index: AlertArchiveIndex,
			window: { from: string; to: string },
			ctx: { signal: AbortSignal },
		) => {
			const call = {
				window: { ...window },
				signal: ctx.signal,
				gate: deferred<AlertArchiveEntry[]>(),
			};
			rangeCalls.push(call);
			return call.gate.promise;
		},
	);
	Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
	cleanup();
	quietModeStore.resetForTest();
});

describe('AlertHistory asynchronous catalog and range transitions', () => {
	it('omits numeric filter summaries while an advertised range is pending or failed', async () => {
		nav.url = new URL('http://localhost/alerts?route=24');
		render(AlertHistoryScreen);
		await waitFor(() => expect(rangeCalls).toHaveLength(1));

		const pill = document.querySelector(
			'[data-slot="surface-rail-mobile"] .surface-rail-pill',
		) as HTMLButtonElement;
		expect(pill).not.toBeNull();
		expect(pill.getAttribute('aria-label')).not.toContain('0 alerts');
		expect(pill.querySelector('.surface-rail-pill-summary')).toBeNull();
		expect(document.querySelector('[data-slot="filter-summary"]')).toBeNull();

		rangeCalls[0].gate.reject(new Error('advertised archive page missing'));
		await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
		expect(pill.getAttribute('aria-label')).not.toContain('0 alerts');
		expect(pill.querySelector('.surface-rail-pill-summary')).toBeNull();
		expect(document.querySelector('[data-slot="filter-summary"]')).toBeNull();
	});

	it('shows a real zero summary after a matching successful healthy-empty range', async () => {
		nav.url = new URL('http://localhost/alerts?route=24');
		render(AlertHistoryScreen);
		await waitFor(() => expect(rangeCalls).toHaveLength(1));
		rangeCalls[0].gate.resolve([]);

		await waitFor(() =>
			expect(document.querySelector('[data-variant="empty-avis"]')).not.toBeNull(),
		);
		const pill = document.querySelector(
			'[data-slot="surface-rail-mobile"] .surface-rail-pill',
		) as HTMLButtonElement;
		expect(pill).toHaveAttribute('aria-label', expect.stringContaining('0 alerts'));
		expect(pill.querySelector('.surface-rail-pill-summary')).toHaveTextContent('0 alerts');
		expect(document.querySelector('[data-slot="filter-summary-count"]')).toHaveTextContent(
			'0 alerts',
		);
	});

	it('does not erase malformed raw history evidence before a deferred catalog settles', async () => {
		const historyGate = deferred<AlertHistory>();
		const indexGate = deferred<AlertArchiveIndex | null>();
		ports.getAlertHistory.mockReturnValue(historyGate.promise);
		ports.getAlertArchiveIndex.mockReturnValue(indexGate.promise);
		nav.url = new URL('http://localhost/alerts?from=&to=not-a-date&route=24');

		render(AlertHistoryScreen);
		await Promise.resolve();
		await Promise.resolve();

		expect(replaceState).not.toHaveBeenCalled();
		expect(nav.url.searchParams.has('from')).toBe(true);
		expect(nav.url.searchParams.get('to')).toBe('not-a-date');

		historyGate.resolve(HISTORY);
		indexGate.resolve(INDEX);
		await waitFor(() => expect(rangeCalls).toHaveLength(1));
		rangeCalls[0].gate.resolve([entry('current', 'Current range', '2026-06-21')]);

		await waitFor(() => {
			expect(nav.url.searchParams.get('from')).toBeNull();
			expect(nav.url.searchParams.get('to')).toBeNull();
			expect(nav.url.searchParams.get('route')).toBe('24');
		});
		await waitFor(() => expect(screen.getByText('Current range')).toBeInTheDocument());
		expect(replaceState).toHaveBeenCalledTimes(1);
		expect(document.querySelector('[data-slot="history-announcement"]')).not.toHaveTextContent(
			/^\s*$/,
		);
	});

	it('aborts superseded ranges and never renders retained data under the wrong selection', async () => {
		render(AlertHistoryScreen);
		await waitFor(() => expect(rangeCalls).toHaveLength(1));
		rangeCalls[0].gate.resolve([entry('current', 'Current range', '2026-06-21')]);
		await waitFor(() => expect(screen.getByText('Current range')).toBeInTheDocument());

		await fireEvent.change(screen.getByLabelText('Alert history range · From'), {
			target: { value: '2026-05-01' },
		});
		await waitFor(() => expect(rangeCalls).toHaveLength(2));
		expect(rangeCalls[0].signal.aborted).toBe(true);
		expect(screen.queryByText('Current range')).toBeNull();
		expect(document.querySelector('[data-variant="skeleton"]')).not.toBeNull();

		await fireEvent.change(screen.getByLabelText('Alert history range · To'), {
			target: { value: '2026-05-31' },
		});
		await waitFor(() => expect(rangeCalls).toHaveLength(3));
		expect(rangeCalls[1].signal.aborted).toBe(true);

		rangeCalls[1].gate.reject(new Error('superseded range failed'));
		rangeCalls[2].gate.resolve([entry('selected', 'Selected range', '2026-05-20')]);
		await waitFor(() => expect(screen.getByText('Selected range')).toBeInTheDocument());
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.queryByText('Current range')).toBeNull();
		expect(screen.queryByText('Superseded range')).toBeNull();
		expect(rangeCalls[2].window).toEqual({ from: '2026-05-01', to: '2026-05-31' });
	});

	it('prioritizes a selected-range failure over stale data and retries that exact range', async () => {
		render(AlertHistoryScreen);
		await waitFor(() => expect(rangeCalls).toHaveLength(1));
		rangeCalls[0].gate.resolve([entry('current', 'Current range', '2026-06-21')]);
		await waitFor(() => expect(screen.getByText('Current range')).toBeInTheDocument());

		await fireEvent.change(screen.getByLabelText('Alert history range · From'), {
			target: { value: '2026-05-01' },
		});
		await fireEvent.change(screen.getByLabelText('Alert history range · To'), {
			target: { value: '2026-05-31' },
		});
		await waitFor(() =>
			expect(
				rangeCalls.some(
					(call) => call.window.from === '2026-05-01' && call.window.to === '2026-05-31',
				),
			).toBe(true),
		);
		const failed = rangeCalls.findLast(
			(call) => call.window.from === '2026-05-01' && call.window.to === '2026-05-31',
		)!;
		failed.gate.reject(new Error('advertised archive page missing'));

		await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
		expect(screen.queryByText('Current range')).toBeNull();
		expect(document.querySelector('[data-toc^="alerts-"]')).toBeNull();

		const callsBeforeRetry = rangeCalls.length;
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(rangeCalls).toHaveLength(callsBeforeRetry + 1));
		const retried = rangeCalls.at(-1)!;
		expect(retried.window).toEqual({ from: '2026-05-01', to: '2026-05-31' });
		retried.gate.resolve([entry('recovered', 'Recovered range', '2026-05-20')]);
		await waitFor(() => expect(screen.getByText('Recovered range')).toBeInTheDocument());
	});
});

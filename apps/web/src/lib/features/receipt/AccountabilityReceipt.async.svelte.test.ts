import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IsoUtc, Receipt, ReceiptsIndex } from '$lib/v1/schemas';
import { dataRefresh } from '$lib/stores';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

const ports = vi.hoisted(() => ({
	getReceiptsIndex: vi.fn(),
	getReceipt: vi.fn(),
	getAdvertisedReceipt: vi.fn(),
}));
const nav = vi.hoisted(() => ({
	url: new URL('http://localhost/receipt'),
	replaceState: vi.fn((url: string | URL) => {
		nav.url = new URL(url, 'http://localhost');
	}),
}));

vi.mock('$lib/v1', () => ({
	getReceiptsIndex: ports.getReceiptsIndex,
	getReceipt: ports.getReceipt,
	getAdvertisedReceipt: ports.getAdvertisedReceipt,
}));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return nav.url;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({
	replaceState: nav.replaceState,
}));

import AccountabilityReceipt from './AccountabilityReceipt.svelte';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const DATES = ['2026-06-15', '2026-06-16', '2026-06-17'] as const;
const OLD_RETAINED_DATE = '2024-06-17';
const LATEST_RETAINED_DATE = '2026-06-17';
const INDEX: ReceiptsIndex = {
	generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
	dates: [...DATES],
};

function receipt(date: string, includeSilent = true): Receipt {
	return {
		generated_utc: `${date}T07:00:00Z` as IsoUtc,
		date,
		otp_pct: 82,
		avg_delay_min: 3.4,
		severe_pct: 11.1,
		affected_routes: 12,
		affected_stops: 340,
		alerts: 5,
		vehicles: null,
		rider_impact_score: 7.2,
		worst_route: { id: '161', name: 'Van Horne', otp_delta_pts: -8 },
		worst_stop: { id: '57191', name: 'Rockland', avg_delay_min: 6.1 },
		by_shift: [
			{
				shift: 'pm_peak',
				severe_pct: 11.1,
				observation_count: 180,
				severe_count: 20,
				avg_delay_min: 8,
			},
		],
		service_states: {
			scheduled_trip_days: 100,
			delivered_trip_days: 80,
			cancelled_trip_days: 5,
			silent_trip_days: includeSilent ? 15 : 0,
			not_reported_route_count: includeSilent ? 1 : 0,
			service_completeness_pct: 80,
			not_reported_routes: includeSilent
				? [{ id: '51', name: 'Édouard-Montpetit', scheduled_trip_days: 12 }]
				: [],
		},
	};
}

let receiptGates: Map<string, ReturnType<typeof deferred<Receipt | null>>>;
let intersectionCallback: IntersectionObserverCallback | undefined;

class ReceiptIntersectionObserver {
	readonly root = null;
	readonly rootMargin = '';
	readonly thresholds: readonly number[] = [];

	constructor(callback: IntersectionObserverCallback) {
		intersectionCallback = callback;
	}

	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

function card(container: HTMLElement, id: string): HTMLElement {
	return container.querySelector(`[data-toc="${id}"]`) as HTMLElement;
}

async function activate(container: HTMLElement, id: string): Promise<void> {
	await waitFor(() => expect(intersectionCallback).toBeDefined());
	await act(() =>
		intersectionCallback!(
			[
				{
					isIntersecting: true,
					target: card(container, id),
				} as unknown as IntersectionObserverEntry,
			],
			{} as IntersectionObserver,
		),
	);
}

beforeEach(() => {
	cleanup();
	quietModeStore.resetForTest();
	localStorage.removeItem('transit:quiet-mode');
	for (const key of ['receipt-controls', 'receipt-toc']) {
		sessionStorage.removeItem(`transit.persisted:${key}`);
	}
	nav.url = new URL('http://localhost/receipt');
	nav.replaceState.mockClear();
	intersectionCallback = undefined;
	vi.stubGlobal('IntersectionObserver', ReceiptIntersectionObserver);
	receiptGates = new Map(DATES.map((date) => [date, deferred<Receipt | null>()]));
	ports.getReceiptsIndex.mockReset();
	ports.getReceipt.mockReset();
	ports.getAdvertisedReceipt.mockReset();
	ports.getReceiptsIndex.mockResolvedValue(INDEX);
	ports.getReceipt.mockImplementation((date: string) => receiptGates.get(date)!.promise);
	ports.getAdvertisedReceipt.mockImplementation((_index: ReceiptsIndex, date: string) =>
		ports.getReceipt(date),
	);
	Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
	cleanup();
	quietModeStore.resetForTest();
	vi.unstubAllGlobals();
});

describe('AccountabilityReceipt — asynchronous date transitions', () => {
	it('loads only an exact advertised date and skips an unpublished interior neighbor', async () => {
		ports.getReceiptsIndex.mockResolvedValue({
			generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
			dates: ['2026-06-17', '2026-06-15', '2026-06-17'],
		});
		const { container } = render(AccountabilityReceipt);

		await waitFor(() =>
			expect(ports.getAdvertisedReceipt).toHaveBeenCalledWith(
				expect.objectContaining({ dates: ['2026-06-17', '2026-06-15', '2026-06-17'] }),
				'2026-06-17',
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			),
		);
		receiptGates.get('2026-06-17')!.resolve(receipt('2026-06-17'));

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() =>
			expect(within(rail).getByLabelText('Receipt day')).toHaveValue('2026-06-17'),
		);
		const desktopInput = within(rail).getByLabelText('Receipt day') as HTMLInputElement;
		expect(desktopInput.min).toBe('2026-06-15');
		expect(desktopInput.max).toBe('2026-06-17');
		expect(within(rail).getByText('Available receipts: Jun 15–Jun 17')).toBeInTheDocument();
		expect(within(rail).getByText('Showing: Jun 17')).toBeInTheDocument();

		await fireEvent.click(within(container).getByRole('button', { name: /Open day controls/ }));
		const sheet = within(container).getByRole('dialog', { name: 'Day & contents' });
		expect(container.querySelectorAll('[data-slot="surface-rail"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-slot="history-navigator"]')).toHaveLength(2);
		await fireEvent.click(within(sheet).getByRole('button', { name: 'Previous date' }));
		expect(within(container).getByRole('dialog', { name: 'Day & contents' })).toBeInTheDocument();
		await waitFor(() =>
			expect(ports.getAdvertisedReceipt).toHaveBeenCalledWith(
				expect.anything(),
				'2026-06-15',
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			),
		);
		receiptGates.get('2026-06-15')!.resolve({ ...receipt('2026-06-15'), otp_pct: 61 });
		await waitFor(() => {
			for (const input of within(container).getAllByLabelText('Receipt day')) {
				expect(input).toHaveValue('2026-06-15');
			}
		});
		expect(ports.getAdvertisedReceipt).not.toHaveBeenCalledWith(
			expect.anything(),
			'2026-06-16',
			expect.anything(),
		);
	});

	it('corrects an unpublished native date before state or fetch and never flashes an error', async () => {
		ports.getReceiptsIndex.mockResolvedValue({
			generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
			dates: ['2026-06-15', '2026-06-17'],
		});
		const { container } = render(AccountabilityReceipt);
		await waitFor(() => expect(ports.getAdvertisedReceipt).toHaveBeenCalledTimes(1));
		receiptGates.get('2026-06-17')!.resolve(receipt('2026-06-17'));
		await waitFor(() => expect(within(container).getByText('82%')).toBeInTheDocument());

		await fireEvent.change(within(container).getByLabelText('Receipt day'), {
			target: { value: '2026-06-16' },
		});
		await waitFor(() =>
			expect(within(container).getByRole('status')).toHaveTextContent(
				'That day was not published. Showing the latest receipt.',
			),
		);
		expect(within(container).getByLabelText('Receipt day')).toHaveValue('2026-06-17');
		expect(ports.getAdvertisedReceipt).not.toHaveBeenCalledWith(
			expect.anything(),
			'2026-06-16',
			expect.anything(),
		);
		expect(within(container).queryByRole('alert')).toBeNull();
		expect(within(container).getByText('82%')).toBeInTheDocument();
	});

	it('aborts the superseded advertised request and ignores its late result', async () => {
		const { container } = render(AccountabilityReceipt);
		await waitFor(() => expect(ports.getAdvertisedReceipt).toHaveBeenCalledTimes(1));
		const latestSignal = ports.getAdvertisedReceipt.mock.calls[0]?.[2]?.signal as AbortSignal;

		await fireEvent.change(within(container).getByLabelText('Receipt day'), {
			target: { value: '2026-06-16' },
		});
		await waitFor(() => expect(ports.getAdvertisedReceipt).toHaveBeenCalledTimes(2));
		expect(latestSignal.aborted).toBe(true);
		receiptGates.get('2026-06-17')!.resolve({ ...receipt('2026-06-17'), otp_pct: 99 });
		expect(within(container).queryByText('99%')).toBeNull();
		receiptGates.get('2026-06-16')!.resolve({ ...receipt('2026-06-16'), otp_pct: 74 });
		await waitFor(() => expect(within(container).getByText('74%')).toBeInTheDocument());
		expect(within(container).queryByText('99%')).toBeNull();
	});

	it('keeps an empty index healthy and never starts a receipt request', async () => {
		ports.getReceiptsIndex.mockResolvedValue({
			generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
			dates: [],
		});
		const { container } = render(AccountabilityReceipt);

		await waitFor(() =>
			expect(
				within(container).getByText(/No receipts have been published yet/i),
			).toBeInTheDocument(),
		);
		expect(ports.getAdvertisedReceipt).not.toHaveBeenCalled();
		expect(within(container).queryByRole('alert')).toBeNull();
	});

	it('keeps index failure and retry distinct from receipt loading', async () => {
		ports.getReceiptsIndex
			.mockReset()
			.mockRejectedValueOnce(new Error('index unavailable'))
			.mockResolvedValueOnce(INDEX);
		const { container } = render(AccountabilityReceipt);

		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument());
		expect(ports.getAdvertisedReceipt).not.toHaveBeenCalled();
		await fireEvent.click(within(container).getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(ports.getAdvertisedReceipt).toHaveBeenCalledTimes(1));
		expect(within(container).queryByRole('alert')).toBeNull();
	});

	it('preserves a surviving active TOC card while the next receipt is loading', async () => {
		const { container } = render(AccountabilityReceipt);
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith('2026-06-17'));
		receiptGates.get('2026-06-17')!.resolve(receipt('2026-06-17'));

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() => expect(card(container, 'receipt-silent')).not.toBeNull());
		await activate(container, 'receipt-silent');
		expect(
			within(rail).getByRole('button', { name: 'Scheduled but never appeared' }),
		).toHaveAttribute('aria-current', 'location');

		await fireEvent.change(within(rail).getByLabelText('Receipt day'), {
			target: { value: '2026-06-16' },
		});
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith('2026-06-16'));
		expect(container.querySelector('[data-toc="receipt-main"]')).toBeNull();

		receiptGates.get('2026-06-16')!.resolve(receipt('2026-06-16'));
		await waitFor(() =>
			expect(
				within(rail).getByRole('button', { name: 'Scheduled but never appeared' }),
			).toHaveAttribute('aria-current', 'location'),
		);
	});

	it('reconciles to the nearest surviving card after an asynchronous receipt resolves', async () => {
		const { container } = render(AccountabilityReceipt);
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith('2026-06-17'));
		receiptGates.get('2026-06-17')!.resolve(receipt('2026-06-17'));

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() => expect(card(container, 'receipt-silent')).not.toBeNull());
		await activate(container, 'receipt-silent');

		await fireEvent.change(within(rail).getByLabelText('Receipt day'), {
			target: { value: '2026-06-15' },
		});
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith('2026-06-15'));
		expect(container.querySelector('[data-toc="receipt-main"]')).toBeNull();

		receiptGates.get('2026-06-15')!.resolve(receipt('2026-06-15', false));
		await waitFor(() => {
			expect(container.querySelector('[data-toc="receipt-silent"]')).toBeNull();
			expect(within(rail).getByRole('button', { name: 'Service delivered' })).toHaveAttribute(
				'aria-current',
				'location',
			);
		});
	});

	it('clears stale TOC history after a selected receipt settles as missing', async () => {
		const { container } = render(AccountabilityReceipt);
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith('2026-06-17'));
		receiptGates.get('2026-06-17')!.resolve(receipt('2026-06-17'));

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() => expect(card(container, 'receipt-silent')).not.toBeNull());
		await activate(container, 'receipt-silent');

		await fireEvent.change(within(rail).getByLabelText('Receipt day'), {
			target: { value: '2026-06-16' },
		});
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith('2026-06-16'));
		receiptGates.get('2026-06-16')!.resolve(null);
		await waitFor(() =>
			expect(container.querySelector('[data-slot="receipt-empty"]')).not.toBeNull(),
		);

		await fireEvent.change(within(rail).getByLabelText('Receipt day'), {
			target: { value: '2026-06-15' },
		});
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith('2026-06-15'));
		receiptGates.get('2026-06-15')!.resolve(receipt('2026-06-15'));
		await waitFor(() =>
			expect(within(rail).getByRole('button', { name: 'The receipt' })).toHaveAttribute(
				'aria-current',
				'location',
			),
		);
	});

	it('removes stale cards and TOC after a same-date refresh fails, then restores continuity on retry', async () => {
		const { container } = render(AccountabilityReceipt);
		await waitFor(() => expect(ports.getAdvertisedReceipt).toHaveBeenCalledTimes(1));
		receiptGates.get('2026-06-17')!.resolve(receipt('2026-06-17'));

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() => expect(card(container, 'receipt-silent')).not.toBeNull());
		await activate(container, 'receipt-silent');
		expect(within(container).getByText('4 sections')).toBeInTheDocument();

		const failedRefresh = deferred<Receipt | null>();
		receiptGates.set('2026-06-17', failedRefresh);
		dataRefresh.bumpEpoch();
		await waitFor(() => expect(ports.getAdvertisedReceipt.mock.calls.length).toBeGreaterThan(1));
		failedRefresh.reject(new Error('refresh failed'));

		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument());
		expect(container.querySelector('[data-toc="receipt-main"]')).toBeNull();
		expect(rail.querySelector('[data-slot="section-toc"]')).toBeNull();
		expect(within(container).queryByText('4 sections')).toBeNull();

		const successfulRetry = deferred<Receipt | null>();
		receiptGates.set('2026-06-17', successfulRetry);
		const callsBeforeRetry = ports.getAdvertisedReceipt.mock.calls.length;
		await fireEvent.click(within(container).getByRole('button', { name: 'Retry' }));
		await waitFor(() =>
			expect(ports.getAdvertisedReceipt).toHaveBeenCalledTimes(callsBeforeRetry + 1),
		);
		expect(ports.getAdvertisedReceipt.mock.calls.at(-1)?.[1]).toBe('2026-06-17');
		successfulRetry.resolve(receipt('2026-06-17'));
		await waitFor(() =>
			expect(
				within(rail).getByRole('button', { name: 'Scheduled but never appeared' }),
			).toHaveAttribute('aria-current', 'location'),
		);
	});
});

describe('AccountabilityReceipt — retained-span URLs', () => {
	beforeEach(() => {
		ports.getReceiptsIndex.mockResolvedValue({
			generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
			dates: [OLD_RETAINED_DATE, LATEST_RETAINED_DATE],
		});
		receiptGates.set(OLD_RETAINED_DATE, deferred<Receipt | null>());
	});

	it('fetches and presents an old retained receipt from its date deep link', async () => {
		nav.url = new URL(`http://localhost/receipt?date=${OLD_RETAINED_DATE}`);
		const { container } = render(AccountabilityReceipt);

		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith(OLD_RETAINED_DATE));
		receiptGates.get(OLD_RETAINED_DATE)!.resolve({ ...receipt(OLD_RETAINED_DATE), otp_pct: 61 });

		await waitFor(() => expect(within(container).getByText('61%')).toBeInTheDocument());
		expect(within(container).getByLabelText('Receipt day')).toHaveValue(OLD_RETAINED_DATE);
	});

	it('still defaults to the latest receipt across the retained span', async () => {
		const { container } = render(AccountabilityReceipt);

		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith(LATEST_RETAINED_DATE));
		receiptGates
			.get(LATEST_RETAINED_DATE)!
			.resolve({ ...receipt(LATEST_RETAINED_DATE), otp_pct: 93 });

		await waitFor(() => expect(within(container).getByText('93%')).toBeInTheDocument());
		expect(within(container).getByLabelText('Receipt day')).toHaveValue(LATEST_RETAINED_DATE);
		expect(nav.url.searchParams.has('date')).toBe(false);
		expect(within(container).getByRole('status')).toHaveTextContent('');
		expect(nav.replaceState).not.toHaveBeenCalled();
	});

	it('removes the date parameter when an old receipt switches back to latest', async () => {
		nav.url = new URL(`http://localhost/receipt?date=${OLD_RETAINED_DATE}`);
		const { container } = render(AccountabilityReceipt);
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith(OLD_RETAINED_DATE));
		receiptGates.get(OLD_RETAINED_DATE)!.resolve(receipt(OLD_RETAINED_DATE));
		await waitFor(() =>
			expect(within(container).getByLabelText('Receipt day')).toHaveValue(OLD_RETAINED_DATE),
		);

		await fireEvent.change(within(container).getByLabelText('Receipt day'), {
			target: { value: LATEST_RETAINED_DATE },
		});
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith(LATEST_RETAINED_DATE));
		receiptGates.get(LATEST_RETAINED_DATE)!.resolve(receipt(LATEST_RETAINED_DATE));

		await waitFor(() => expect(nav.url.searchParams.has('date')).toBe(false));
	});

	it('renders an advertised object failure as a whole-page error and retries the same date', async () => {
		nav.url = new URL(`http://localhost/receipt?date=${OLD_RETAINED_DATE}`);
		const { container } = render(AccountabilityReceipt);
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith(OLD_RETAINED_DATE));
		receiptGates.get(OLD_RETAINED_DATE)!.reject(new Error('advertised receipt missing'));

		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument());
		expect(within(container).queryByText('No receipt was published for this day.')).toBeNull();
		expect(container.querySelector('[data-toc="receipt-main"]')).toBeNull();
		expect(container.querySelector('[data-slot="section-toc"]')).toBeNull();

		const retry = deferred<Receipt | null>();
		receiptGates.set(OLD_RETAINED_DATE, retry);
		await fireEvent.click(within(container).getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(ports.getAdvertisedReceipt).toHaveBeenCalledTimes(2));
		expect(ports.getAdvertisedReceipt.mock.calls[1]?.[1]).toBe(OLD_RETAINED_DATE);
		retry.resolve(receipt(OLD_RETAINED_DATE));
		await waitFor(() => expect(within(container).getByText('82%')).toBeInTheDocument());
	});
});

describe('AccountabilityReceipt — raw URL corrections', () => {
	beforeEach(() => {
		ports.getReceiptsIndex.mockResolvedValue({
			generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
			dates: ['2026-06-15', '2026-06-17'],
		});
	});

	it.each([
		['', 'That date was not valid. Showing the latest receipt.'],
		['2026-02-30', 'That date was not valid. Showing the latest receipt.'],
		['2025-06-17', 'That date is outside the retained receipts. Showing the latest receipt.'],
		['2026-06-16', 'That day was not published. Showing the latest receipt.'],
	])('corrects ?date=%s once without fetching the bad value', async (raw, message) => {
		nav.url = new URL(`http://localhost/receipt?date=${raw}`);
		const { container } = render(AccountabilityReceipt);

		await waitFor(() => expect(ports.getAdvertisedReceipt).toHaveBeenCalledTimes(1));
		expect(ports.getAdvertisedReceipt.mock.calls[0]?.[1]).toBe('2026-06-17');
		expect(ports.getAdvertisedReceipt.mock.calls.some((call) => call[1] === raw)).toBe(false);
		receiptGates.get('2026-06-17')!.resolve(receipt('2026-06-17'));
		await waitFor(() => expect(within(container).getByRole('status')).toHaveTextContent(message));
		expect(nav.url.searchParams.has('date')).toBe(false);
		expect(nav.replaceState).toHaveBeenCalledTimes(1);
	});

	it('waits for the index before correcting a present blank date', async () => {
		const indexGate = deferred<ReceiptsIndex>();
		ports.getReceiptsIndex.mockReturnValue(indexGate.promise);
		nav.url = new URL('http://localhost/receipt?date=');
		const { container } = render(AccountabilityReceipt);

		expect(nav.replaceState).not.toHaveBeenCalled();
		expect(ports.getAdvertisedReceipt).not.toHaveBeenCalled();
		indexGate.resolve({
			generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
			dates: ['2026-06-15', '2026-06-17'],
		});
		await waitFor(() => expect(ports.getAdvertisedReceipt).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(nav.replaceState).toHaveBeenCalledTimes(1));
		expect(container.querySelector('[data-slot="history-announcement"]')).toHaveTextContent(
			'That date was not valid. Showing the latest receipt.',
		);
	});
});

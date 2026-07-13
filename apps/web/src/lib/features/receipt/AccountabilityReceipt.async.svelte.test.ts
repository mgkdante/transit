import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IsoUtc, Receipt, ReceiptsIndex } from '$lib/v1/schemas';
import { dataRefresh } from '$lib/stores';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';

const ports = vi.hoisted(() => ({
	getReceiptsIndex: vi.fn(),
	getReceipt: vi.fn(),
}));
const nav = vi.hoisted(() => ({ url: new URL('http://localhost/receipt') }));

vi.mock('$lib/v1', () => ({
	getReceiptsIndex: ports.getReceiptsIndex,
	getReceipt: ports.getReceipt,
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
	replaceState: vi.fn((url: string | URL) => {
		nav.url = new URL(url, 'http://localhost');
	}),
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
	intersectionCallback = undefined;
	vi.stubGlobal('IntersectionObserver', ReceiptIntersectionObserver);
	receiptGates = new Map(DATES.map((date) => [date, deferred<Receipt | null>()]));
	ports.getReceiptsIndex.mockReset();
	ports.getReceipt.mockReset();
	ports.getReceiptsIndex.mockResolvedValue(INDEX);
	ports.getReceipt.mockImplementation((date: string) => receiptGates.get(date)!.promise);
	Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
	cleanup();
	quietModeStore.resetForTest();
	vi.unstubAllGlobals();
});

describe('AccountabilityReceipt — asynchronous date transitions', () => {
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
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledWith('2026-06-17'));
		receiptGates.get('2026-06-17')!.resolve(receipt('2026-06-17'));

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() => expect(card(container, 'receipt-silent')).not.toBeNull());
		await activate(container, 'receipt-silent');
		expect(within(container).getByText('4 sections')).toBeInTheDocument();

		const failedRefresh = deferred<Receipt | null>();
		receiptGates.set('2026-06-17', failedRefresh);
		dataRefresh.bumpEpoch();
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledTimes(2));
		failedRefresh.reject(new Error('refresh failed'));

		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument());
		expect(container.querySelector('[data-toc="receipt-main"]')).toBeNull();
		expect(rail.querySelector('[data-slot="section-toc"]')).toBeNull();
		expect(within(container).queryByText('4 sections')).toBeNull();

		const successfulRetry = deferred<Receipt | null>();
		receiptGates.set('2026-06-17', successfulRetry);
		await fireEvent.click(within(container).getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(ports.getReceipt).toHaveBeenCalledTimes(3));
		successfulRetry.resolve(receipt('2026-06-17'));
		await waitFor(() =>
			expect(
				within(rail).getByRole('button', { name: 'Scheduled but never appeared' }),
			).toHaveAttribute('aria-current', 'location'),
		);
	});
});

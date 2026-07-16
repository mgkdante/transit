import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IsoUtc, Receipt, ReceiptsIndex } from '$lib/v1/schemas';
import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
import AccountabilityReceipt from './AccountabilityReceipt.svelte';
import { copy as receiptCopy } from './receipt.copy';

let reconciliationIntersectionCallback: IntersectionObserverCallback | undefined;

class ReconciliationIntersectionObserver {
	readonly root = null;
	readonly rootMargin = '';
	readonly thresholds: readonly number[] = [];

	constructor(callback: IntersectionObserverCallback) {
		reconciliationIntersectionCallback = callback;
	}

	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

// The index of published receipt dates (ascending, as the contract publishes).
// The latest enabled entry (Jun 17) is the seeded default.
let indexData: ReceiptsIndex = {
	generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
	dates: ['2026-06-15', '2026-06-16', '2026-06-17'],
};

// One day's receipt for the seeded default date. Carries a full headline + counts
// + a worst route AND a worst stop. A null severe-share exercises the honesty
// no-data branch; a null vehicles exercises the always-null cell OMISSION.
let receiptData: Receipt | null = {
	generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
	date: '2026-06-17',
	otp_pct: 82,
	avg_delay_min: 3.4,
	severe_pct: null,
	affected_routes: 12,
	affected_stops: 340,
	alerts: 5,
	vehicles: null,
	rider_impact_score: 7.2,
	worst_route: { id: '161', name: 'Van Horne', otp_delta_pts: -8 },
	worst_stop: { id: '57191', name: 'Rockland', avg_delay_min: 6.1 },
};

function withAllCuts(base: Receipt = receiptData as Receipt): Receipt {
	return {
		...base,
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
			silent_trip_days: 15,
			not_reported_route_count: 2,
			service_completeness_pct: 80,
			not_reported_routes: [{ id: '51', name: 'Édouard-Montpetit', scheduled_trip_days: 12 }],
		},
	};
}

function card(container: HTMLElement, id: string): HTMLElement {
	return container.querySelector(`[data-toc="${id}"]`) as HTMLElement;
}

function cardTrigger(container: HTMLElement, id: string): HTMLButtonElement {
	return card(container, id).querySelector(
		'h2.section-heading > button.section-header',
	) as HTMLButtonElement;
}

function resetReceiptState(): void {
	for (const key of [
		'receipt-card-main',
		'receipt-card-time',
		'receipt-card-delivered',
		'receipt-card-silent',
	]) {
		sessionStorage.removeItem(`transit.persisted:${key}`);
	}
	sessionStorage.removeItem('transit.persisted:receipt-controls');
	sessionStorage.removeItem('transit.persisted:receipt-toc');
	localStorage.removeItem('transit:quiet-mode');
	quietModeStore.resetForTest();
}

// Mock $lib/v1 with a clean factory (importing the real barrel pulls the full
// module graph incl. $app/environment, which jsdom can't boot). The two getters
// are the only v1 surface this screen touches.
vi.mock('$lib/v1', () => ({
	getReceiptsIndex: vi.fn(),
	getReceipt: vi.fn(),
	getAdvertisedReceipt: vi.fn(),
}));

// createResource is reactive in production (re-runs the fetcher when its inputs
// change). The receipt fetcher reads `selectedDate`, which an $effect seeds AFTER
// the first render. We model that by re-invoking the fetcher every time `.data`
// is read: the component re-renders when its OWN $state (`selectedDate`) changes,
// and on that re-render the getter re-pumps and returns the freshly-fetched value.
// To keep the read SYNCHRONOUS (so first paint already carries data), the mocked
// getters below resolve synchronously — the fetcher returns the value directly,
// not a promise, and a non-thenable return is captured immediately. The lone
// thenable (the empty-`selectedDate` seed → `Promise.resolve(null)`) stays null,
// which is exactly the pre-seed state.
vi.mock('$lib/v1/resource.svelte', () => ({
	createResource: <T>(fetcher: (signal: AbortSignal) => Promise<T> | T) => {
		let data: T | null = null;
		const signal = new AbortController().signal;
		const pump = () => {
			const v = fetcher(signal) as T | Promise<T>;
			if (v != null && typeof (v as Promise<T>).then === 'function') {
				void (v as Promise<T>).then((r) => {
					data = r;
				});
			} else {
				data = v as T;
			}
		};
		pump();
		return {
			get data() {
				pump();
				return data;
			},
			error: null,
			loading: false,
			settled: true,
			reload: vi.fn(),
		};
	},
}));

beforeEach(async () => {
	resetReceiptState();
	Element.prototype.scrollIntoView = vi.fn();
	indexData = {
		generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
		dates: ['2026-06-15', '2026-06-16', '2026-06-17'],
	};
	receiptData = {
		generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
		date: '2026-06-17',
		otp_pct: 82,
		avg_delay_min: 3.4,
		severe_pct: null,
		affected_routes: 12,
		affected_stops: 340,
		alerts: 5,
		vehicles: null,
		rider_impact_score: 7.2,
		worst_route: { id: '161', name: 'Van Horne', otp_delta_pts: -8 },
		worst_stop: { id: '57191', name: 'Rockland', avg_delay_min: 6.1 },
	};
	const v1 = await import('$lib/v1');
	// Resolve synchronously: the createResource mock above captures a non-thenable
	// return immediately, so first paint carries data (the real getters are async;
	// the synchronous stub only matters for the test's render timing).
	vi.mocked(v1.getReceiptsIndex).mockImplementation(() => indexData as never);
	vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
	vi.mocked(v1.getAdvertisedReceipt).mockImplementation(
		((_index: ReceiptsIndex, date: string, ctx?: { signal?: AbortSignal }) =>
			v1.getReceipt(date, ctx) as never) as never,
	);
});

afterEach(resetReceiptState);

describe('AccountabilityReceipt article shell', () => {
	it('renders one article heading and only the exact two shared reading controls', async () => {
		const { container } = render(AccountabilityReceipt);
		expect(
			await screen.findAllByRole('heading', { level: 1, name: 'Accountability receipt' }),
		).toHaveLength(1);
		const controls = screen.getByTestId('quiet-mode-controls');
		expect(within(controls).getAllByRole('button')).toHaveLength(2);
		expect(within(controls).getByRole('button', { name: /Collapse all/ })).toBeInTheDocument();
		expect(container.querySelector('[data-slot="detail-shell"]')).not.toBeNull();
	});

	it('puts the availability-bound day picker and four-entry TOC in one combined rail', async () => {
		const v1 = await import('$lib/v1');
		receiptData = withAllCuts();
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		const { container } = render(AccountabilityReceipt);
		await screen.findByText('82%');

		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(rail).not.toBeNull();
		const input = within(rail).getByLabelText('Receipt day') as HTMLInputElement;
		expect(input.min).toBe('2026-06-15');
		expect(input.max).toBe('2026-06-17');
		for (const name of [
			'The receipt',
			'By time of day',
			'Service delivered',
			'Scheduled but never appeared',
		]) {
			expect(within(rail).getByRole('button', { name })).toBeInTheDocument();
		}

		const ids = ['receipt-main', 'receipt-time', 'receipt-delivered', 'receipt-silent'];
		expect(
			ids.map((id) =>
				card(container, id).querySelector('[data-slot="badge"]')?.textContent?.trim(),
			),
		).toEqual(['01', '02', '03', '04']);
	});

	it('stands optional cards and TOC entries down together while retaining fixed numbers', async () => {
		const v1 = await import('$lib/v1');
		receiptData = {
			...withAllCuts(),
			by_shift: undefined,
		};
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		const { container } = render(AccountabilityReceipt);
		await screen.findByText('82%');

		expect(container.querySelector('[data-toc="receipt-time"]')).toBeNull();
		expect(
			container.querySelector('[data-toc="receipt-delivered"] [data-slot="badge"]'),
		).toHaveTextContent('03');
		expect(
			container.querySelector('[data-toc="receipt-silent"] [data-slot="badge"]'),
		).toHaveTextContent('04');
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(rail).queryByRole('button', { name: 'By time of day' })).toBeNull();
		expect(within(rail).getByRole('button', { name: 'Service delivered' })).toBeInTheDocument();
		expect(
			within(rail).getByRole('button', { name: 'Scheduled but never appeared' }),
		).toBeInTheDocument();
	});

	it('applies the delivered and silent gates independently to each card and TOC entry', async () => {
		const v1 = await import('$lib/v1');
		const base = receiptData as Receipt;
		receiptData = {
			...base,
			service_states: {
				scheduled_trip_days: 100,
				delivered_trip_days: 80,
				cancelled_trip_days: 5,
				silent_trip_days: 15,
				service_completeness_pct: 80,
				not_reported_route_count: 0,
				not_reported_routes: [],
			},
		};
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		const deliveredOnly = render(AccountabilityReceipt);
		await screen.findByText('82%');
		let rail = deliveredOnly.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(card(deliveredOnly.container, 'receipt-delivered')).not.toBeNull();
		expect(deliveredOnly.container.querySelector('[data-toc="receipt-silent"]')).toBeNull();
		expect(within(rail).getByRole('button', { name: 'Service delivered' })).toBeInTheDocument();
		expect(within(rail).queryByRole('button', { name: 'Scheduled but never appeared' })).toBeNull();
		deliveredOnly.unmount();
		resetReceiptState();

		receiptData = {
			...base,
			service_states: {
				scheduled_trip_days: null,
				delivered_trip_days: null,
				cancelled_trip_days: null,
				silent_trip_days: null,
				service_completeness_pct: null,
				not_reported_route_count: 1,
				not_reported_routes: [{ id: '51', name: 'Édouard-Montpetit', scheduled_trip_days: 12 }],
			},
		};
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		const silentOnly = render(AccountabilityReceipt);
		await screen.findByText('82%');
		rail = silentOnly.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(silentOnly.container.querySelector('[data-toc="receipt-delivered"]')).toBeNull();
		expect(card(silentOnly.container, 'receipt-silent')).not.toBeNull();
		expect(within(rail).queryByRole('button', { name: 'Service delivered' })).toBeNull();
		expect(
			within(rail).getByRole('button', { name: 'Scheduled but never appeared' }),
		).toBeInTheDocument();
	});

	it('Collapse all and Expand all cover every currently rendered receipt card', async () => {
		const v1 = await import('$lib/v1');
		receiptData = withAllCuts();
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		const { container } = render(AccountabilityReceipt);
		await screen.findByText('82%');
		const ids = ['receipt-main', 'receipt-time', 'receipt-delivered', 'receipt-silent'];
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const railTriggers = [
			within(rail).getByRole('button', { name: 'Day' }),
			within(rail).getByRole('button', { name: 'On this page' }),
		];

		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'false');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(screen.getByTestId('quiet-mode-toggle'));
		for (const trigger of railTriggers) expect(trigger).toHaveAttribute('aria-expanded', 'true');
		for (const id of ids)
			expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'true');
	});

	it('persists the Day and TOC disclosures independently across a remount', async () => {
		const v1 = await import('$lib/v1');
		receiptData = withAllCuts();
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		const first = render(AccountabilityReceipt);
		await screen.findByText('82%');
		const firstRail = first.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		const firstDay = within(firstRail).getByRole('button', { name: 'Day' });
		const firstToc = within(firstRail).getByRole('button', { name: 'On this page' });
		await fireEvent.click(firstDay);
		await fireEvent.click(firstToc);
		await fireEvent.click(firstToc);
		expect(firstDay).toHaveAttribute('aria-expanded', 'false');
		expect(firstToc).toHaveAttribute('aria-expanded', 'true');
		first.unmount();

		const second = render(AccountabilityReceipt);
		const secondRail = second.container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() =>
			expect(within(secondRail).getByRole('button', { name: 'Day' })).toHaveAttribute(
				'aria-expanded',
				'false',
			),
		);
		expect(within(secondRail).getByRole('button', { name: 'On this page' })).toHaveAttribute(
			'aria-expanded',
			'true',
		);
		expect(sessionStorage.getItem('transit.persisted:receipt-controls')).toBe('false');
		expect(sessionStorage.getItem('transit.persisted:receipt-toc')).toBe('true');
	});

	it('Always start collapsed initializes both rail disclosures and every current card closed', async () => {
		const v1 = await import('$lib/v1');
		receiptData = withAllCuts();
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		localStorage.setItem('transit:quiet-mode', 'true');
		const { container } = render(AccountabilityReceipt);
		await screen.findByText('82%');
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await waitFor(() => {
			expect(within(rail).getByRole('button', { name: 'Day' })).toHaveAttribute(
				'aria-expanded',
				'false',
			);
			expect(within(rail).getByRole('button', { name: 'On this page' })).toHaveAttribute(
				'aria-expanded',
				'false',
			);
			for (const id of ['receipt-main', 'receipt-time', 'receipt-delivered', 'receipt-silent']) {
				expect(cardTrigger(container, id)).toHaveAttribute('aria-expanded', 'false');
			}
		});
		expect(localStorage.getItem('transit:quiet-mode')).toBe('true');
	});

	it('a late optional card mounted by a date change adopts remembered collapsed mode', async () => {
		const v1 = await import('$lib/v1');
		localStorage.setItem('transit:quiet-mode', 'true');
		const base = receiptData as Receipt;
		const byDate: Record<string, Receipt> = {
			'2026-06-17': base,
			'2026-06-16': withAllCuts({ ...base, date: '2026-06-16' }),
		};
		vi.mocked(v1.getReceipt).mockImplementation(((date: string) => byDate[date] as never) as never);
		const { container } = render(AccountabilityReceipt);
		await screen.findByText('82%');
		expect(container.querySelector('[data-toc="receipt-time"]')).toBeNull();

		await fireEvent.change(screen.getByLabelText('Receipt day'), {
			target: { value: '2026-06-16' },
		});
		await waitFor(() =>
			expect(cardTrigger(container, 'receipt-time')).toHaveAttribute('aria-expanded', 'false'),
		);
	});

	it('opens a closed TOC target before scrolling without opening another card', async () => {
		const v1 = await import('$lib/v1');
		receiptData = withAllCuts();
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		const { container } = render(AccountabilityReceipt);
		await screen.findByText('82%');
		const statesAtScroll: Array<{ time: string | null; main: string | null }> = [];
		Element.prototype.scrollIntoView = vi.fn(() => {
			statesAtScroll.push({
				time: cardTrigger(container, 'receipt-time').getAttribute('aria-expanded'),
				main: cardTrigger(container, 'receipt-main').getAttribute('aria-expanded'),
			});
		});
		await fireEvent.click(cardTrigger(container, 'receipt-main'));
		await fireEvent.click(cardTrigger(container, 'receipt-time'));
		const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		await fireEvent.click(within(rail).getByRole('button', { name: 'By time of day' }));
		await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce());
		expect(statesAtScroll).toEqual([{ time: 'true', main: 'false' }]);
	});

	it('reconciles an active Silent destination to the nearest surviving receipt card', async () => {
		const v1 = await import('$lib/v1');
		const base = receiptData as Receipt;
		const byDate: Record<string, Receipt> = {
			'2026-06-17': withAllCuts(base),
			'2026-06-16': {
				...base,
				date: '2026-06-16',
				service_states: {
					scheduled_trip_days: 100,
					delivered_trip_days: 80,
					cancelled_trip_days: 5,
					silent_trip_days: 15,
					service_completeness_pct: 80,
					not_reported_route_count: 0,
					not_reported_routes: [],
				},
			},
		};
		vi.mocked(v1.getReceipt).mockImplementation(((date: string) => byDate[date] as never) as never);
		reconciliationIntersectionCallback = undefined;
		vi.stubGlobal('IntersectionObserver', ReconciliationIntersectionObserver);

		try {
			const { container } = render(AccountabilityReceipt);
			await waitFor(() => expect(reconciliationIntersectionCallback).toBeDefined());
			await act(() =>
				reconciliationIntersectionCallback!(
					[
						{
							isIntersecting: true,
							target: card(container, 'receipt-silent'),
						} as unknown as IntersectionObserverEntry,
					],
					{} as IntersectionObserver,
				),
			);
			const rail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
			expect(
				within(rail).getByRole('button', { name: 'Scheduled but never appeared' }),
			).toHaveAttribute('aria-current', 'location');

			await fireEvent.change(within(rail).getByLabelText('Receipt day'), {
				target: { value: '2026-06-16' },
			});
			await waitFor(() => {
				expect(container.querySelector('[data-toc="receipt-silent"]')).toBeNull();
				expect(within(rail).getByRole('button', { name: 'Service delivered' })).toHaveAttribute(
					'aria-current',
					'location',
				);
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('never renders stale cards from the previously selected receipt while a new day resolves', async () => {
		const v1 = await import('$lib/v1');
		receiptData = withAllCuts();
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		const { container } = render(AccountabilityReceipt);
		await screen.findByText('82%');
		expect(card(container, 'receipt-time')).not.toBeNull();

		await fireEvent.change(screen.getByLabelText('Receipt day'), {
			target: { value: '2026-06-16' },
		});
		await waitFor(() => expect(container.querySelector('[data-toc="receipt-time"]')).toBeNull());
		expect(container.querySelector('[data-toc="receipt-main"]')).toBeNull();
	});
});

describe('AccountabilityReceipt headline + counts', () => {
	it('renders the headline reliability figures for the most recent receipt', async () => {
		render(AccountabilityReceipt);
		expect(await screen.findByText('82%')).toBeInTheDocument();
		expect(screen.getByText('3.4 min')).toBeInTheDocument();
		expect(screen.getByText('7.2')).toBeInTheDocument();
	});

	it('renders the affected counts on the day', async () => {
		render(AccountabilityReceipt);
		expect(await screen.findByText('340')).toBeInTheDocument();
		expect(screen.getByText('12')).toBeInTheDocument();
		expect(screen.getByText('5')).toBeInTheDocument();
	});

	it('links the worst route to its detail page and the worst stop to its detail page', async () => {
		render(AccountabilityReceipt);
		expect(await screen.findByRole('link', { name: /Van Horne/i })).toHaveAttribute(
			'href',
			'/lines/161',
		);
		expect(screen.getByRole('link', { name: /Rockland/i })).toHaveAttribute('href', '/stop/57191');
	});
});

describe('AccountabilityReceipt honesty', () => {
	it('shows the styled honest-absence chip for a null severe-share, never a fabricated 0', async () => {
		render(AccountabilityReceipt);
		await screen.findByText('82%');
		// severe % is null → the styled honest-absence chip (AbsentValue), never "0".
		const absent = document.querySelectorAll('[data-slot="absent-value"]');
		expect(absent.length).toBeGreaterThanOrEqual(1);
		expect(screen.queryByText('0%')).not.toBeInTheDocument();
	});

	it('OMITS the always-null vehicles cell entirely rather than a permanent no-data row', async () => {
		render(AccountabilityReceipt);
		// `vehicles` is structurally always-null on /v1, so its cell (label + value)
		// is dropped rather than rendering a permanent "no data" row.
		await screen.findByText('340');
		expect(screen.queryByText('Vehicles')).not.toBeInTheDocument();
	});

	it('shows the SPECIFIC empty-index copy when no receipt dates are published', async () => {
		const v1 = await import('$lib/v1');
		indexData = { generated_utc: '2026-06-17T07:00:00Z' as IsoUtc, dates: [] };
		vi.mocked(v1.getReceiptsIndex).mockImplementation(() => indexData as never);
		render(AccountabilityReceipt);
		// An empty index renders the more-informative localized emptyIndex message,
		// NOT the generic boundary empty — and the headline figures must NOT render.
		const message = await screen.findByText(/No receipts have been published yet/i);
		expect(message).toBeInTheDocument();
		expect(message.closest('[data-component="state-notice"]')).toHaveAttribute(
			'data-presentation',
			'card',
		);
		expect(screen.queryByText('82%')).not.toBeInTheDocument();
	});

	it('loads the latest day through the strict advertised-receipt seam', async () => {
		const v1 = await import('$lib/v1');
		render(AccountabilityReceipt);
		expect(await screen.findByText('82%')).toBeInTheDocument();
		expect(vi.mocked(v1.getAdvertisedReceipt)).toHaveBeenCalledWith(
			indexData,
			'2026-06-17',
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});
});

describe('AccountabilityReceipt composed layout (E2)', () => {
	it('renders the composed receipt as deliberate sections (headline / affected / worst)', async () => {
		render(AccountabilityReceipt);
		await screen.findByText('82%');
		const layout = document.querySelector('[data-slot="receipt-layout"]');
		expect(layout).not.toBeNull();
		// The three designed slots, each present and in document order.
		const headline = document.querySelector('[data-slot="receipt-headline"]');
		const affected = document.querySelector('[data-slot="receipt-affected"]');
		const worst = document.querySelector('[data-slot="receipt-worst"]');
		expect(headline).not.toBeNull();
		expect(affected).not.toBeNull();
		expect(worst).not.toBeNull();
		// DOM order is headline -> affected -> worst (the stack order on mobile and
		// the source order the desktop grid-areas re-compose; reading order is sacred).
		const order = Array.from(layout!.children);
		expect(order.indexOf(headline as Element)).toBeLessThan(order.indexOf(affected as Element));
		expect(order.indexOf(affected as Element)).toBeLessThan(order.indexOf(worst as Element));
	});

	it('stands the worst-of-day panel down and marks the layout no-worst when absent', async () => {
		const v1 = await import('$lib/v1');
		receiptData = {
			generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
			date: '2026-06-17',
			otp_pct: 82,
			avg_delay_min: 3.4,
			severe_pct: null,
			affected_routes: 12,
			affected_stops: 340,
			alerts: 5,
			vehicles: null,
			rider_impact_score: 7.2,
			// No worst route/stop on the day.
			worst_route: null,
			worst_stop: null,
		};
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		render(AccountabilityReceipt);
		await screen.findByText('82%');
		// The worst panel is gone; the layout flags no-worst (the secondary row
		// collapses to the affected column — never a fabricated empty card).
		expect(document.querySelector('[data-slot="receipt-worst"]')).toBeNull();
		expect(document.querySelector('[data-slot="receipt-layout"]')).toHaveClass('no-worst');
		// Headline + affected sections still compose.
		expect(document.querySelector('[data-slot="receipt-headline"]')).not.toBeNull();
		expect(document.querySelector('[data-slot="receipt-affected"]')).not.toBeNull();
	});

	it('preserves honesty in the composed layout (null severe-share reads the styled chip, never 0)', async () => {
		render(AccountabilityReceipt);
		await screen.findByText('82%');
		const absent = document.querySelectorAll('[data-slot="absent-value"]');
		expect(absent.length).toBeGreaterThanOrEqual(1);
		expect(screen.queryByText('0%')).not.toBeInTheDocument();
	});
});

describe('AccountabilityReceipt date switching', () => {
	it('re-fetches the chosen day and renders its figures when a non-default chip is picked', async () => {
		const v1 = await import('$lib/v1');

		// Model a reactive, date-KEYED re-fetch: getReceipt returns the day matching
		// the date it is invoked with, so picking another chip (which flips the
		// component's selectedDate $state → a re-render → the createResource mock
		// re-pumps getReceipt(selectedDate)) yields THAT day's figures, not a single
		// frozen resolve. The seeded default is the most recent day (Jun 17, 82%);
		// Jun 16 is a distinct day (74%).
		const byDate: Record<string, Receipt> = {
			'2026-06-17': { ...(receiptData as Receipt), date: '2026-06-17', otp_pct: 82 },
			'2026-06-16': {
				generated_utc: '2026-06-16T07:00:00Z' as IsoUtc,
				date: '2026-06-16',
				otp_pct: 74,
				avg_delay_min: 5.1,
				severe_pct: 6.3,
				affected_routes: 18,
				affected_stops: 410,
				alerts: 9,
				vehicles: 220,
				rider_impact_score: 9.4,
				worst_route: { id: '24', name: 'Sherbrooke', otp_delta_pts: -11 },
				worst_stop: { id: '40001', name: 'Snowdon', avg_delay_min: 7.8 },
			},
		};
		vi.mocked(v1.getReceipt).mockImplementation(
			((d: string) => (byDate[d] ?? null) as never) as never,
		);

		render(AccountabilityReceipt);

		// First paint carries the seeded default (the LATEST published day, Jun 17, 82%).
		expect(await screen.findByText('82%')).toBeInTheDocument();

		// Pick the NON-default Jun 16 day via the smart single-date picker (S13 —
		// the GrainPicker-as-date-picker misuse is gone; the picker is now an
		// availability-bound native date picker (<input type="date">) whose min/max
		// bound the real published span).
		const input = screen.getByLabelText('Receipt day') as HTMLInputElement;
		await fireEvent.change(input, { target: { value: '2026-06-16' } });

		// getReceipt was invoked with the freshly-picked date …
		expect(vi.mocked(v1.getReceipt)).toHaveBeenCalledWith(
			'2026-06-16',
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		// … and the newly-fetched day's figures render (74%, not the old 82%).
		expect(await screen.findByText('74%')).toBeInTheDocument();
		expect(screen.queryByText('82%')).not.toBeInTheDocument();
	});
});

describe('AccountabilityReceipt smart date picker (S13)', () => {
	it('owns complete English and French history-navigation copy', () => {
		expect(receiptCopy.en.history).toMatchObject({
			group: 'Browse published receipts',
			previous: 'Previous date',
			next: 'Next date',
		});
		expect(receiptCopy.en.history.coverage('Jun 15', 'Jun 17, 2026')).toBe(
			'Available receipts: Jun 15–Jun 17, 2026',
		);
		expect(receiptCopy.fr.history).toMatchObject({
			group: 'Parcourir les reçus publiés',
			previous: 'Date précédente',
			next: 'Date suivante',
		});
		expect(receiptCopy.fr.history.correction.unpublished).toContain('pas été publiée');
	});

	it('defaults to the LATEST published day and bounds the calendar to the full span', async () => {
		render(AccountabilityReceipt);
		await screen.findByText('82%');
		const input = screen.getByLabelText('Receipt day') as HTMLInputElement;
		// A native date picker bounded (min/max) to the published earliest→latest span.
		expect(input.type).toBe('date');
		expect(input.min).toBe('2026-06-15');
		expect(input.max).toBe('2026-06-17');
		// The default selection is the latest published day (Jun 17).
		expect(input.value).toBe('2026-06-17');
	});

	it('bounds the calendar across a GAP day (native pickers cannot disable an interior day)', async () => {
		const v1 = await import('$lib/v1');
		// Jun 15 + Jun 17 published; Jun 16 is a gap the index never published.
		indexData = {
			generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
			dates: ['2026-06-15', '2026-06-17'],
		};
		vi.mocked(v1.getReceiptsIndex).mockImplementation(() => indexData as never);
		render(AccountabilityReceipt);
		await screen.findByText('82%');
		const input = screen.getByLabelText('Receipt day') as HTMLInputElement;
		// The native calendar can only BOUND (min/max) — the gap day (Jun 16) is INSIDE the
		// span and pickable; its honesty is preserved at runtime via the receipt's absent-day
		// path, not by disabling the option (which the old <select> could do). This is the
		// documented S13 degradation from the selects→native-date-picker migration.
		expect(input.type).toBe('date');
		expect(input.min).toBe('2026-06-15');
		expect(input.max).toBe('2026-06-17');
	});
});

describe('AccountabilityReceipt S13 re-granulated cuts', () => {
	it('renders the by-time-of-day, service-delivered, and not-reported cuts when present', async () => {
		const v1 = await import('$lib/v1');
		receiptData = {
			...(receiptData as Receipt),
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
				silent_trip_days: 15,
				not_reported_route_count: 2,
				service_completeness_pct: 80,
				not_reported_routes: [{ id: '51', name: 'Édouard-Montpetit', scheduled_trip_days: 12 }],
			},
		};
		vi.mocked(v1.getReceipt).mockImplementation(() => receiptData as never);
		render(AccountabilityReceipt);
		await screen.findByText('82%');
		expect(document.querySelector('[data-slot="receipt-time-of-day"]')).not.toBeNull();
		expect(document.querySelector('[data-slot="receipt-state-cuts"]')).not.toBeNull();
		expect(document.querySelector('[data-slot="receipt-not-reported"]')).not.toBeNull();
		// The not-reported line links to /lines/[id].
		expect(screen.getByRole('link', { name: /View line 51/i })).toHaveAttribute(
			'href',
			'/lines/51',
		);
	});

	it('stands the S13 cuts DOWN on ramp-in absence (pre-S13 receipt, no fabricated cards)', async () => {
		// The default receiptData carries NO by_shift / service_states → the cuts stand down.
		render(AccountabilityReceipt);
		await screen.findByText('82%');
		expect(document.querySelector('[data-slot="receipt-time-of-day"]')).toBeNull();
		expect(document.querySelector('[data-slot="receipt-state-cuts"]')).toBeNull();
		expect(document.querySelector('[data-slot="receipt-not-reported"]')).toBeNull();
	});
});

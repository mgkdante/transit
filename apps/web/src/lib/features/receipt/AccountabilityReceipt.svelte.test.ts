import { render, screen, fireEvent } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IsoUtc, Receipt, ReceiptsIndex } from '$lib/v1/schemas';
import AccountabilityReceipt from './AccountabilityReceipt.svelte';

// The index of published receipt dates (ascending, as the contract publishes).
// The screen reverses it → the most recent day (Jun 17) is the seeded default.
let indexData: ReceiptsIndex = {
	generated_utc: '2026-06-17T07:00:00Z' as IsoUtc,
	dates: ['2026-06-15', '2026-06-16', '2026-06-17'],
};

// One day's receipt for the seeded default date. Carries a full headline + counts
// + a worst route AND a worst stop. Null severe-share + null vehicles exercise the
// honesty no-data branches.
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

// Mock $lib/v1 with a clean factory (importing the real barrel pulls the full
// module graph incl. $app/environment, which jsdom can't boot). The two getters
// are the only v1 surface this screen touches.
vi.mock('$lib/v1', () => ({
	getReceiptsIndex: vi.fn(),
	getReceipt: vi.fn(),
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
	createResource: <T>(fetcher: () => Promise<T> | T) => {
		let data: T | null = null;
		const pump = () => {
			const v = fetcher() as T | Promise<T>;
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
			'/route/161',
		);
		expect(screen.getByRole('link', { name: /Rockland/i })).toHaveAttribute('href', '/stop/57191');
	});
});

describe('AccountabilityReceipt honesty', () => {
	it('shows the localized no-data string for a null severe-share and null vehicles, never a fabricated 0', async () => {
		render(AccountabilityReceipt);
		// severe % is null AND vehicles is null → two honest no-data marks; never "0".
		const noData = await screen.findAllByText('no data');
		expect(noData.length).toBeGreaterThanOrEqual(2);
		expect(screen.queryByText('0%')).not.toBeInTheDocument();
	});

	it('shows the SPECIFIC empty-index copy when no receipt dates are published', async () => {
		const v1 = await import('$lib/v1');
		indexData = { generated_utc: '2026-06-17T07:00:00Z' as IsoUtc, dates: [] };
		vi.mocked(v1.getReceiptsIndex).mockImplementation(() => indexData as never);
		render(AccountabilityReceipt);
		// An empty index renders the more-informative localized emptyIndex message,
		// NOT the generic boundary empty — and the headline figures must NOT render.
		expect(await screen.findByText(/No receipts have been published yet/i)).toBeInTheDocument();
		expect(screen.queryByText('82%')).not.toBeInTheDocument();
	});

	it('shows the empty-receipt state when the chosen day 404s (getReceipt → null)', async () => {
		const v1 = await import('$lib/v1');
		receiptData = null;
		vi.mocked(v1.getReceipt).mockImplementation(() => null as never);
		render(AccountabilityReceipt);
		expect(await screen.findByText('No receipt was published for this day.')).toBeInTheDocument();
		expect(screen.queryByText('82%')).not.toBeInTheDocument();
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

		// First paint carries the seeded default (Jun 17, 82%).
		expect(await screen.findByText('82%')).toBeInTheDocument();

		// Pick the NON-default Jun 16 chip (the GrainPicker renders role=radio chips
		// labelled by the localized short date).
		const jun16 = screen.getByRole('radio', { name: 'Jun 16' });
		await fireEvent.click(jun16);

		// getReceipt was invoked with the freshly-picked date …
		expect(vi.mocked(v1.getReceipt)).toHaveBeenCalledWith('2026-06-16');
		// … and the newly-fetched day's figures render (74%, not the old 82%).
		expect(await screen.findByText('74%')).toBeInTheDocument();
		expect(screen.queryByText('82%')).not.toBeInTheDocument();
	});
});

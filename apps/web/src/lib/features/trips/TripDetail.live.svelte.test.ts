import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV1Runtime } from '$lib/v1/runtime';
import TripDetail from './TripDetail.svelte';

const fixture = vi.hoisted(() => ({
	ttl: 30,
	now: Date.parse('2026-06-15T12:00:00Z'),
	epoch: 0,
	visible: 'visible' as DocumentVisibilityState,
	online: true,
	trips: vi.fn(),
	vehicles: vi.fn(),
	stopDepartures: vi.fn(),
	alerts: vi.fn(),
	network: vi.fn(),
	stopNames: vi.fn(),
	clockDispose: vi.fn(),
}));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/v1/boot', () => ({
	getV1Context: () => ({
		manifest: {
			short_name: 'STM',
			display_name: 'STM',
			files: { live: { ttl_s: fixture.ttl, generated_utc: '2000-01-01T00:00:00Z' } },
		},
	}),
}));
vi.mock('$lib/v1/adapter', () => ({ adapter: { live: fixture } }));
vi.mock('$lib/v1/repositories/static', () => ({ getStopsIndex: fixture.stopNames }));
vi.mock('$lib/stores', () => ({
	sharedClock: {
		subscribe: () => () => {},
		get serverNow() {
			return fixture.now;
		},
	},
}));

let tick = () => {};
let refresh = () => {};
const subscribeClock = createSubscriber((update) => {
	tick = update;
});
const subscribeRefresh = createSubscriber((update) => {
	refresh = update;
});
let restoreRuntime: () => void;
const base = Date.parse('2026-06-15T12:00:00Z');
const report = (offset = 0, include = true) => ({
	generated_utc: new Date(base + offset * 1000).toISOString(),
	trips: include
		? {
				probe: {
					status: 'on_time',
					route: '24',
					delay_min: 0,
					stops: [{ stop: 'sA', eta_utc: '2026-06-15T12:05:00Z', delay_min: null }],
				},
			}
		: {},
});
async function settle() {
	for (let i = 0; i < 8; i += 1) await Promise.resolve();
	flushSync();
}
async function advance(seconds: number) {
	fixture.now += seconds * 1000;
	tick();
	await vi.advanceTimersByTimeAsync(seconds * 1000);
	await settle();
}
async function manualRefresh() {
	fixture.epoch += 1;
	refresh();
	flushSync();
	await settle();
}
const stamp = () => document.querySelector('[data-slot="freshness-stamp"]')!;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(base - 300_000); // Client clock is five minutes behind the report clock.
	fixture.ttl = 30;
	fixture.now = base;
	fixture.epoch = 0;
	fixture.visible = 'visible';
	fixture.online = true;
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => fixture.visible,
	});
	Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => fixture.online });
	for (const method of [
		fixture.trips,
		fixture.vehicles,
		fixture.stopDepartures,
		fixture.alerts,
		fixture.network,
		fixture.stopNames,
		fixture.clockDispose,
	])
		method.mockReset();
	fixture.trips.mockResolvedValue(report());
	fixture.stopNames.mockResolvedValue(null);
	restoreRuntime = configureV1Runtime({
		clock: {
			get serverNow() {
				subscribeClock();
				return fixture.now;
			},
			noteServerEpochMs: () => {},
			subscribe: () => fixture.clockDispose,
		},
		refresh: {
			get epoch() {
				subscribeRefresh();
				return fixture.epoch;
			},
		},
	});
});
afterEach(() => {
	cleanup();
	restoreRuntime();
	vi.useRealTimers();
});

describe('TripDetail with the shared live store', () => {
	it.each([30, 60])(
		'polls at TTL %s and ages the unchanged report at exactly 3×TTL',
		async (ttl) => {
			fixture.ttl = ttl;
			render(TripDetail, { props: { id: 'probe' } });
			await settle();
			expect(fixture.trips).toHaveBeenCalledTimes(1);
			expect(stamp()).toHaveAttribute('data-age-seconds', '0');
			await advance(ttl - 1);
			expect(fixture.trips).toHaveBeenCalledTimes(1);
			await advance(1);
			expect(fixture.trips).toHaveBeenCalledTimes(2);
			await advance(ttl * 2 - 1);
			expect(stamp()).toHaveAttribute('data-stale', 'false');
			await advance(1);
			expect(stamp()).toHaveAttribute('data-stale', 'true');
			expect(stamp()).toHaveAttribute('data-age-seconds', String(ttl * 3));
			expect(screen.getByTestId('trip-report-notice')).toHaveTextContent('Report behind schedule');
			expect(document.querySelectorAll('.trip-stop-link')).toHaveLength(1);
			for (const unused of [
				fixture.vehicles,
				fixture.stopDepartures,
				fixture.alerts,
				fixture.network,
			])
				expect(unused).not.toHaveBeenCalled();
		},
	);

	it('retains numeric data on failure, clears failure on unchanged success, and accepts a newer report', async () => {
		render(TripDetail, { props: { id: 'probe' } });
		await settle();
		fixture.trips.mockRejectedValue(new Error('controlled outage'));
		await advance(30);
		expect(stamp()).toHaveAttribute('data-degraded', 'true');
		expect(stamp()).toHaveAttribute('data-stale', 'false');
		expect(screen.getByTestId('trip-report-notice')).toHaveTextContent('Refresh unavailable');
		expect(document.querySelector('.trip-verdict [data-slot="status-badge"]')).toHaveTextContent(
			'On time',
		);
		await advance(60);
		expect(stamp()).toHaveAttribute('data-stale', 'true');
		fixture.trips.mockResolvedValue(report());
		await manualRefresh();
		expect(stamp()).not.toHaveAttribute('data-degraded');
		expect(stamp()).toHaveAttribute('data-stale', 'true');
		expect(screen.getByTestId('trip-report-notice')).toHaveTextContent('Report behind schedule');
		fixture.trips.mockResolvedValue(report(90));
		await advance(30);
		expect(stamp()).toHaveAttribute('data-stale', 'false');
		expect(stamp().querySelector('time')).toHaveAttribute('datetime', report(90).generated_utc);
		expect(screen.queryByTestId('trip-report-notice')).toBeNull();
	});

	it('preserves the timestamp for a missing trip and updates it when polling reports that trip', async () => {
		fixture.trips.mockResolvedValue(report(0, false));
		render(TripDetail, { props: { id: 'probe' } });
		await settle();
		expect(screen.getByRole('heading', { name: 'Trip not in this report' })).toBeInTheDocument();
		expect(stamp().querySelector('time')).toHaveAttribute('datetime', report().generated_utc);
		fixture.trips.mockResolvedValue(report(30));
		await advance(30);
		expect(screen.getByRole('heading', { name: 'Trip probe' })).toBeInTheDocument();
		expect(screen.queryByTestId('trip-standdown')).toBeNull();
	});

	it('uses the cold error retry without inventing a report, even when optional stop names fail', async () => {
		fixture.trips.mockRejectedValue(new Error('controlled outage'));
		fixture.stopNames.mockRejectedValue(new Error('optional names unavailable'));
		render(TripDetail, { props: { id: 'probe' } });
		await settle();
		expect(stamp()).toBeNull();
		expect(screen.queryByTestId('trip-standdown')).toBeNull();
		fixture.trips.mockResolvedValue(report());
		await fireEvent.click(screen.getByRole('button', { name: /retry/i }));
		await settle();
		expect(document.querySelector('.trip-stop-name')).toHaveTextContent('sA');
		expect(stamp()).toHaveAttribute('data-stale', 'false');
		expect(stamp()).not.toHaveAttribute('data-degraded');
	});

	it.each(['hidden', 'offline'] as const)(
		'pauses when %s, refreshes once on resume, and stops on unmount',
		async (reason) => {
			const view = render(TripDetail, { props: { id: 'probe' } });
			await settle();
			if (reason === 'hidden') {
				fixture.visible = 'hidden';
				document.dispatchEvent(new Event('visibilitychange'));
			} else {
				fixture.online = false;
				window.dispatchEvent(new Event('offline'));
			}
			await advance(95);
			expect(fixture.trips).toHaveBeenCalledTimes(1);
			if (reason === 'hidden') {
				fixture.visible = 'visible';
				document.dispatchEvent(new Event('visibilitychange'));
			} else {
				fixture.online = true;
				window.dispatchEvent(new Event('online'));
			}
			await settle();
			expect(fixture.trips).toHaveBeenCalledTimes(2);
			expect(stamp()).toHaveAttribute('data-stale', 'true');
			await advance(30);
			expect(fixture.trips).toHaveBeenCalledTimes(3);
			view.unmount();
			await advance(90);
			expect(fixture.trips).toHaveBeenCalledTimes(3);
			expect(fixture.clockDispose).toHaveBeenCalledTimes(1);
		},
	);
});

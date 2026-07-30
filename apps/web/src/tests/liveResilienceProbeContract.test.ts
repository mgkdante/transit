import { describe, expect, it } from 'vitest';
import {
	activeMapFamilies,
	allRoutedRequestsCompleted,
	commitProbeSelection,
	createFixtureGenerationClock,
	expectedRequestsAfterCycle,
	lastServedGeneratedUtcByFamily,
	requireRefreshAcknowledgement,
	successfulRoutedRequestsSince,
	waitForRoutedRequestIdle,
	waitForRequestTargets,
} from '../../scripts/live-resilience-probe-contract.mjs';

describe('live resilience probe fixture timeline contract', () => {
	it('keeps successful family age and skew fixed against fulfillment wall time', () => {
		let nowMs = Date.parse('2026-07-30T12:00:10.000Z');
		const nextGeneratedUtc = createFixtureGenerationClock({
			baseAgeMs: 5_000,
			skewsMs: { trips: 2_000 },
			now: () => nowMs,
		});

		expect(nextGeneratedUtc('vehicles')).toBe('2026-07-30T12:00:05.000Z');

		nowMs += 45_000;
		expect(nextGeneratedUtc('vehicles')).toBe('2026-07-30T12:00:50.000Z');
		expect(nextGeneratedUtc('trips')).toBe('2026-07-30T12:00:48.000Z');
	});

	it('strictly advances a successful family when wall time stalls or regresses', () => {
		let nowMs = Date.parse('2026-07-30T12:00:10.000Z');
		const nextGeneratedUtc = createFixtureGenerationClock({
			baseAgeMs: 5_000,
			now: () => nowMs,
		});

		expect(nextGeneratedUtc('vehicles')).toBe('2026-07-30T12:00:05.000Z');
		expect(nextGeneratedUtc('vehicles')).toBe('2026-07-30T12:00:05.001Z');

		nowMs -= 1_000;
		expect(nextGeneratedUtc('vehicles')).toBe('2026-07-30T12:00:05.002Z');
	});

	it('preserves one frozen timestamp across arbitrarily slow cycles', () => {
		let nowMs = Date.parse('2026-07-30T12:00:10.000Z');
		const nextGeneratedUtc = createFixtureGenerationClock({
			frozenAgeMs: 100_000,
			now: () => nowMs,
		});

		expect(nextGeneratedUtc('vehicles')).toBe('2026-07-30T11:58:30.000Z');

		nowMs += 60_000;
		expect(nextGeneratedUtc('vehicles')).toBe('2026-07-30T11:58:30.000Z');
		expect(nextGeneratedUtc('alerts')).toBe('2026-07-30T11:58:30.000Z');
	});

	it('reports the last stamp actually served for every family, not a later failure', () => {
		expect(
			lastServedGeneratedUtcByFamily({
				vehicles: [
					{ status: 200, generatedUtc: '2026-07-30T12:00:01.000Z', delivered: true },
					{ status: 200, generatedUtc: '2026-07-30T12:00:02.000Z', delivered: true },
					{ status: 200, generatedUtc: '2026-07-30T12:00:05.000Z', delivered: false },
				],
				trips: [{ status: 200, generatedUtc: '2026-07-30T12:00:03.000Z', delivered: true }],
				departures: [],
				alerts: [
					{ status: 200, generatedUtc: '2026-07-30T12:00:04.000Z', delivered: true },
					{ status: 500, generatedUtc: null, delivered: true },
				],
				network: [],
			}),
		).toEqual({
			vehicles: '2026-07-30T12:00:02.000Z',
			trips: '2026-07-30T12:00:03.000Z',
			departures: null,
			alerts: '2026-07-30T12:00:04.000Z',
			network: null,
		});
	});
});

describe('live resilience probe cycle contract', () => {
	it('does not call a routed cycle complete while intercepted responses are still pending', () => {
		const requests = { vehicles: 3, trips: 2, departures: 0, alerts: 3, network: 0 };
		const completed = { vehicles: 2, trips: 1, departures: 0, alerts: 2, network: 0 };

		expect(allRoutedRequestsCompleted(requests, completed)).toBe(false);
		expect(allRoutedRequestsCompleted(requests, requests)).toBe(true);
	});

	it('derives the next cycle counts from committed presence and a verified trips lease', () => {
		const requests = { vehicles: 3, trips: 2, departures: 0, alerts: 3, network: 0 };

		expect(activeMapFamilies('present', [])).toEqual(['vehicles', 'alerts']);
		expect(expectedRequestsAfterCycle(requests, activeMapFamilies('present', []))).toEqual({
			vehicles: 4,
			trips: 2,
			departures: 0,
			alerts: 4,
			network: 0,
		});
		expect(activeMapFamilies('present', ['trips'])).toEqual(['vehicles', 'alerts', 'trips']);
		expect(expectedRequestsAfterCycle(requests, activeMapFamilies('present', ['trips']))).toEqual({
			vehicles: 4,
			trips: 3,
			departures: 0,
			alerts: 4,
			network: 0,
		});

		expect(activeMapFamilies('missing-grace', ['trips'])).toEqual(['vehicles', 'alerts', 'trips']);
		expect(
			expectedRequestsAfterCycle(requests, activeMapFamilies('missing-grace', ['trips'])),
		).toEqual({
			vehicles: 4,
			trips: 3,
			departures: 0,
			alerts: 4,
			network: 0,
		});
		expect(activeMapFamilies('gone', ['trips'])).toEqual(['vehicles', 'alerts']);
		expect(expectedRequestsAfterCycle(requests, activeMapFamilies('gone', ['trips']))).toEqual({
			vehicles: 4,
			trips: 2,
			departures: 0,
			alerts: 4,
			network: 0,
		});
	});

	it('does not release the idle barrier until a pending response completes and stays quiet', async () => {
		const requests = { vehicles: 1, trips: 0, departures: 0, alerts: 1, network: 0 };
		const completed = { vehicles: 0, trips: 0, departures: 0, alerts: 0, network: 0 };
		let releaseFirstRetry!: () => void;
		let retries = 0;
		let frames = 0;
		let settled = false;

		const pending = waitForRoutedRequestIdle({
			requests,
			completed,
			waitForFrame: async () => {
				frames += 1;
			},
			waitForRetry: async () => {
				retries += 1;
				if (retries === 1) {
					await new Promise<void>((resolve) => {
						releaseFirstRetry = resolve;
					});
				}
			},
		}).then(() => {
			settled = true;
		});

		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(frames).toBe(0);

		Object.assign(completed, requests);
		releaseFirstRetry();
		await pending;

		expect(frames).toBe(2);
		expect(retries).toBeGreaterThanOrEqual(2);
	});

	it('reports both target and observed request counts when a cycle never starts', async () => {
		const observed = { vehicles: 2, trips: 2, departures: 0, alerts: 2, network: 0 };
		let now = 0;

		const failure = await Promise.resolve()
			.then(() =>
				waitForRequestTargets({
					targets: { vehicles: 3, trips: 3, alerts: 3 },
					readObserved: () => ({ ...observed }),
					waitForRetry: async () => {
						now += 2;
					},
					timeoutMs: 1,
					now: () => now,
				}),
			)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			'Timed out waiting for live requests; targets={"vehicles":3,"trips":3,"alerts":3}; observed={"vehicles":2,"trips":2,"departures":0,"alerts":2,"network":0}',
		);
	});

	it('captures click-point and overlap evidence when refresh never acknowledges the click', async () => {
		const events: string[] = [];
		const evidence = {
			screenshot: 'scripts/__probe-debug__/refresh-control-unacknowledged.png',
			clickPoint: { x: 640, y: 52 },
			elementFromPoint: 'aside[data-slot="map-detail-overlay"]',
			boundingBoxes: {
				refreshControl: { x: 622, y: 34, width: 36, height: 36 },
				navPill: { x: 196, y: 16, width: 888, height: 72 },
				detailOverlay: { x: 920, y: 0, width: 360, height: 900 },
			},
		};

		const failure = await Promise.resolve()
			.then(() =>
				requireRefreshAcknowledgement({
					click: async () => {
						events.push('click');
					},
					waitForAcknowledgement: async () => {
						events.push('wait');
						return null;
					},
					captureFailureEvidence: async () => {
						events.push('capture');
						return evidence;
					},
					timeoutMs: 1_000,
				}),
			)
			.catch((error: unknown) => error);

		expect(events).toEqual(['click', 'wait', 'capture']);
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			`Refresh control did not prove a false-to-true aria-busy/data-refreshing transition within 1000ms; evidence=${JSON.stringify(evidence)}`,
		);
	});

	it('rejects a post-click busy value when the control was already busy before the click', async () => {
		const events: string[] = [];
		const evidence = { initialDataRefreshing: 'true', observedDataRefreshing: 'true' };

		const failure = await requireRefreshAcknowledgement({
			click: async () => {
				events.push('click');
			},
			waitForAcknowledgement: async () => {
				events.push('wait');
				return {
					initial: { ariaBusy: null, dataRefreshing: 'true' },
					observed: { ariaBusy: null, dataRefreshing: 'true' },
					clickEventAtMs: 100,
					observedAtMs: 125,
				};
			},
			captureFailureEvidence: async () => {
				events.push('capture');
				return evidence;
			},
			timeoutMs: 1_000,
		}).catch((error: unknown) => error);

		expect(events).toEqual(['click', 'wait', 'capture']);
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			`Refresh control did not prove a false-to-true aria-busy/data-refreshing transition within 1000ms; evidence=${JSON.stringify(evidence)}`,
		);
	});

	it('passes the recorded click event point to diagnostic capture when acknowledgement is invalid', async () => {
		let capturedAcknowledgement: unknown;
		const acknowledgement = {
			initial: { ariaBusy: null, dataRefreshing: 'false' },
			observed: null,
			clickEventAtMs: 100,
			observedAtMs: null,
			clickPoint: { x: 921, y: 52 },
		};

		const failure = await requireRefreshAcknowledgement({
			click: async () => {},
			waitForAcknowledgement: async () => acknowledgement,
			captureFailureEvidence: async (captured) => {
				capturedAcknowledgement = captured;
				return { clickPoint: acknowledgement.clickPoint };
			},
		}).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect(capturedAcknowledgement).toEqual(acknowledgement);
	});

	it('rejects a false-to-true busy transition observed after the one-second deadline', async () => {
		const evidence = { observedAfterClickMs: 1_001 };

		const failure = await requireRefreshAcknowledgement({
			click: async () => {},
			waitForAcknowledgement: async () => ({
				initial: { ariaBusy: null, dataRefreshing: 'false' },
				observed: { ariaBusy: null, dataRefreshing: 'true' },
				clickEventAtMs: 100,
				observedAtMs: 1_101,
			}),
			captureFailureEvidence: async () => evidence,
			timeoutMs: 1_000,
		}).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			`Refresh control did not prove a false-to-true aria-busy/data-refreshing transition within 1000ms; evidence=${JSON.stringify(evidence)}`,
		);
	});

	it('continues without diagnostic capture after the refresh control acknowledges the click', async () => {
		const events: string[] = [];

		await requireRefreshAcknowledgement({
			click: async () => {
				events.push('click');
			},
			waitForAcknowledgement: async () => {
				events.push('wait');
				return {
					initial: { ariaBusy: null, dataRefreshing: 'false' },
					observed: { ariaBusy: null, dataRefreshing: 'true' },
					clickEventAtMs: 100,
					observedAtMs: 125,
				};
			},
			captureFailureEvidence: async () => {
				events.push('capture');
				return {};
			},
		});

		expect(events).toEqual(['click', 'wait']);
	});

	it('captures evidence when the pointer dispatch itself fails', async () => {
		const events: string[] = [];
		const evidence = {
			elementFromPoint: 'aside[data-slot="map-detail-overlay"]',
			clickPoint: { x: 921, y: 52 },
		};

		const failure = await requireRefreshAcknowledgement({
			click: async () => {
				events.push('click');
				throw new Error('pointer dispatch failed');
			},
			waitForAcknowledgement: async () => {
				events.push('wait');
				return null;
			},
			captureFailureEvidence: async () => {
				events.push('capture');
				return evidence;
			},
		}).catch((error: unknown) => error);

		expect(events).toEqual(['click', 'capture']);
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toBe(
			`Refresh control click failed: pointer dispatch failed; evidence=${JSON.stringify(evidence)}`,
		);
	});

	it('proves a routed lease only from a successful post-baseline transport', () => {
		const baseline = { requests: 2, finished: 2, failed: 0, settlements: 2 };

		expect(
			successfulRoutedRequestsSince(baseline, {
				requests: 3,
				finished: 3,
				failed: 0,
				settlements: [{ status: 200 }, { status: 200 }, { status: 200 }],
			}),
		).toBe(true);
		expect(
			successfulRoutedRequestsSince(baseline, {
				requests: 3,
				finished: 2,
				failed: 1,
				// The route handler may have prepared a 200 before the transport failed.
				settlements: [{ status: 200 }, { status: 200 }, { status: 200 }],
			}),
		).toBe(false);
		expect(
			successfulRoutedRequestsSince(baseline, {
				requests: 3,
				finished: 3,
				failed: 0,
				settlements: [{ status: 200 }, { status: 200 }, { status: 500 }],
			}),
		).toBe(false);
	});
});

describe('live resilience probe selection contract', () => {
	it('waits for rendered-vehicle readiness, re-projects every retry, and verifies the lease', async () => {
		const points = [
			{ x: 601, y: 450 },
			{ x: 607, y: 450 },
		];
		const events: string[] = [];
		let presence = 'gone';

		const proof = await commitProbeSelection({
			maxAttempts: 3,
			projectPoint: async (attempt) => {
				events.push(`project:${attempt}`);
				return points[attempt - 1];
			},
			waitForVehicleAtPoint: async (point, attempt) => {
				events.push(`ready:${attempt}:${point.x}`);
				return true;
			},
			clickPoint: async (point, attempt) => {
				events.push(`click:${attempt}:${point.x}`);
			},
			waitForCommittedPresence: async (attempt) => {
				events.push(`commit:${attempt}`);
				if (attempt === 2) presence = 'present';
				return attempt === 2;
			},
			readSelectionPresence: async () => presence,
			waitForTripsLease: async (attempt) => {
				events.push(`lease:${attempt}`);
				return true;
			},
			waitForBackoff: async (attempt) => {
				events.push(`backoff:${attempt}`);
			},
		});

		expect(proof).toEqual({
			attempts: 2,
			point: points[1],
			presence: 'present',
			tripsLease: true,
		});
		expect(events).toEqual([
			'project:1',
			'ready:1:601',
			'click:1:601',
			'commit:1',
			'backoff:1',
			'project:2',
			'ready:2:607',
			'click:2:607',
			'commit:2',
			'lease:2',
		]);
	});

	it('fails at the selection step when the rendered vehicle never becomes pickable', async () => {
		let projections = 0;
		let clicks = 0;
		let leaseChecks = 0;

		const failure = await commitProbeSelection({
			maxAttempts: 2,
			projectPoint: async () => ({ x: 600 + ++projections, y: 450 }),
			waitForVehicleAtPoint: async () => false,
			clickPoint: async () => {
				clicks += 1;
			},
			waitForCommittedPresence: async () => false,
			readSelectionPresence: async () => 'gone',
			waitForTripsLease: async () => {
				leaseChecks += 1;
				return false;
			},
			waitForBackoff: async () => {},
		}).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toContain('Probe selection step failed after 2 attempts');
		expect((failure as Error).message).toContain('data-selection-presence="gone"');
		expect((failure as Error).message).toContain('rendered vehicle readiness=false');
		expect(projections).toBe(2);
		expect(clicks).toBe(0);
		expect(leaseChecks).toBe(0);
	});

	it('fails at the selection step when commitment does not activate the trips lease', async () => {
		const failure = await commitProbeSelection({
			maxAttempts: 1,
			projectPoint: async () => ({ x: 601, y: 450 }),
			waitForVehicleAtPoint: async () => true,
			clickPoint: async () => {},
			waitForCommittedPresence: async () => true,
			readSelectionPresence: async () => 'present',
			waitForTripsLease: async () => false,
			waitForBackoff: async () => {},
		}).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toContain(
			'Probe selection committed with data-selection-presence="present", but the trips lease did not activate',
		);
	});

	it('does not trust a commitment wait unless the authoritative presence seam is present', async () => {
		let leaseChecks = 0;
		const failure = await commitProbeSelection({
			maxAttempts: 1,
			projectPoint: async () => ({ x: 601, y: 450 }),
			waitForVehicleAtPoint: async () => true,
			clickPoint: async () => {},
			waitForCommittedPresence: async () => true,
			readSelectionPresence: async () => 'loading',
			waitForTripsLease: async () => {
				leaseChecks += 1;
				return true;
			},
			waitForBackoff: async () => {},
		}).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toContain('data-selection-presence="loading"');
		expect(leaseChecks).toBe(0);
	});
});

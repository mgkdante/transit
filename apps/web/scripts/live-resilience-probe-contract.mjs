/** @typedef {'vehicles' | 'trips' | 'departures' | 'alerts' | 'network'} LiveFamily */
/** @typedef {Record<LiveFamily, number>} RequestCounts */

const LIVE_FAMILIES = /** @type {const} */ ([
	'vehicles',
	'trips',
	'departures',
	'alerts',
	'network',
]);
const MAP_BASELINE_FAMILIES = /** @type {const} */ (['vehicles', 'alerts']);
const TRIPS_LEASE_PRESENCES = new Set(['present', 'missing-grace']);
export const FIXTURE_GENERATION_MONOTONIC_FLOOR_MS = 1;

/**
 * Successful fixtures stay a fixed age behind fulfillment wall time. A
 * per-family floor preserves strict generation advancement even when two
 * fulfillments share a millisecond or the local clock moves backward. Frozen
 * mode deliberately bypasses both behaviors and returns one installation-time
 * stamp forever.
 *
 * @param {{
 *   baseAgeMs?: number;
 *   frozenAgeMs?: number | null;
 *   skewsMs?: Record<string, number>;
 *   now?: () => number;
 * }} options
 */
export function createFixtureGenerationClock({
	baseAgeMs = 5_000,
	frozenAgeMs = null,
	skewsMs = {},
	now = Date.now,
} = {}) {
	const frozenGeneratedMs = frozenAgeMs == null ? null : now() - frozenAgeMs;
	const previousGeneratedMs = new Map();

	/** @param {string} family */
	return function nextGeneratedUtc(family) {
		if (frozenGeneratedMs != null) return new Date(frozenGeneratedMs).toISOString();

		const wallClockGeneratedMs = now() - baseAgeMs - (skewsMs[family] ?? 0);
		const previous = previousGeneratedMs.get(family);
		const generatedMs =
			previous == null
				? wallClockGeneratedMs
				: Math.max(wallClockGeneratedMs, previous + FIXTURE_GENERATION_MONOTONIC_FLOOR_MS);
		previousGeneratedMs.set(family, generatedMs);
		return new Date(generatedMs).toISOString();
	};
}

/**
 * Return the stamp from the last successful response actually served for each
 * family. A later failure retains the prior successful generation in the app,
 * so diagnostics must not mistake the failure's null stamp for inactivity.
 *
 * @param {Record<string, Array<{
 *   status: number;
 *   generatedUtc: string | null;
 *   delivered: boolean;
 * }>>} settlements
 * @returns {Record<LiveFamily, string | null>}
 */
export function lastServedGeneratedUtcByFamily(settlements) {
	return /** @type {Record<LiveFamily, string | null>} */ (
		Object.fromEntries(
			LIVE_FAMILIES.map((family) => {
				const familySettlements = settlements[family] ?? [];
				for (let index = familySettlements.length - 1; index >= 0; index -= 1) {
					const settlement = familySettlements[index];
					if (
						settlement.status === 200 &&
						settlement.generatedUtc != null &&
						settlement.delivered
					) {
						return [family, settlement.generatedUtc];
					}
				}
				return [family, null];
			}),
		)
	);
}

/**
 * The probe only commits vehicle selections. Present and grace-retained vehicle
 * details make trips eligible, but the family is active here only when the probe
 * has also observed the selection-scoped lease request settle successfully.
 *
 * @param {string | null | undefined} selectionPresence
 * @param {readonly LiveFamily[]} verifiedLeases
 * @returns {LiveFamily[]}
 */
export function activeMapFamilies(selectionPresence, verifiedLeases = []) {
	return TRIPS_LEASE_PRESENCES.has(selectionPresence ?? '') && verifiedLeases.includes('trips')
		? [...MAP_BASELINE_FAMILIES, 'trips']
		: [...MAP_BASELINE_FAMILIES];
}

/**
 * Coordinate the probe's public-seam selection contract without depending on
 * Playwright. A point is projected inside every attempt, readiness must prove a
 * rendered vehicle at that point before the click, and the function returns only
 * after both committed presence and the selection-scoped trips lease are verified.
 *
 * @param {{
 *   maxAttempts: number;
 *   projectPoint: (attempt: number) => Promise<{x: number; y: number}>;
 *   waitForVehicleAtPoint: (
 *     point: {x: number; y: number},
 *     attempt: number,
 *   ) => Promise<boolean>;
 *   clickPoint: (point: {x: number; y: number}, attempt: number) => Promise<void>;
 *   waitForCommittedPresence: (attempt: number) => Promise<boolean>;
 *   readSelectionPresence: () => Promise<string | null>;
 *   waitForTripsLease: (attempt: number) => Promise<boolean>;
 *   waitForBackoff: (attempt: number) => Promise<void>;
 * }} options
 */
export async function commitProbeSelection({
	maxAttempts,
	projectPoint,
	waitForVehicleAtPoint,
	clickPoint,
	waitForCommittedPresence,
	readSelectionPresence,
	waitForTripsLease,
	waitForBackoff,
}) {
	let lastPoint = null;
	let lastPresence = await readSelectionPresence();
	let lastReady = false;

	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		lastPoint = await projectPoint(attempt);
		lastReady = await waitForVehicleAtPoint(lastPoint, attempt);

		if (lastReady) {
			await clickPoint(lastPoint, attempt);
			await waitForCommittedPresence(attempt);
			lastPresence = await readSelectionPresence();
			if (lastPresence === 'present') {
				const tripsLease = await waitForTripsLease(attempt);
				if (!tripsLease) {
					throw new Error(
						`Probe selection committed with data-selection-presence="${lastPresence ?? 'missing'}", but the trips lease did not activate`,
					);
				}
				return {
					attempts: attempt,
					point: lastPoint,
					presence: lastPresence,
					tripsLease: true,
				};
			}
		} else {
			lastPresence = await readSelectionPresence();
		}

		if (attempt < maxAttempts) await waitForBackoff(attempt);
	}

	const pointText = lastPoint ? `${lastPoint.x},${lastPoint.y}` : 'unavailable';
	throw new Error(
		`Probe selection step failed after ${maxAttempts} attempts: rendered vehicle readiness=${lastReady}; data-selection-presence="${lastPresence ?? 'missing'}"; last projected point=${pointText}`,
	);
}

/**
 * @param {RequestCounts} requests
 * @param {readonly LiveFamily[]} activeFamilies
 * @returns {RequestCounts}
 */
export function expectedRequestsAfterCycle(requests, activeFamilies) {
	const active = new Set(activeFamilies);
	return /** @type {RequestCounts} */ (
		Object.fromEntries(
			LIVE_FAMILIES.map((family) => [family, requests[family] + (active.has(family) ? 1 : 0)]),
		)
	);
}

/**
 * Wait for a routed cycle to reach its exact per-family request floor. The
 * observed snapshot is captured on every retry and included in the timeout so a
 * missing click cannot masquerade as an unexplained target-only failure.
 *
 * @param {{
 *   targets: Record<string, number>;
 *   readObserved: () => Record<string, number>;
 *   waitForRetry?: () => Promise<void>;
 *   timeoutMs?: number;
 *   now?: () => number;
 * }} options
 */
export async function waitForRequestTargets({
	targets,
	readObserved,
	waitForRetry = () => new Promise((resolve) => setTimeout(resolve, 50)),
	timeoutMs = 10_000,
	now = Date.now,
}) {
	const started = now();
	let observed = readObserved();

	while (now() - started < timeoutMs) {
		observed = readObserved();
		if (Object.entries(targets).every(([family, minimum]) => (observed[family] ?? 0) >= minimum)) {
			return;
		}
		await waitForRetry();
	}

	observed = readObserved();
	throw new Error(
		`Timed out waiting for live requests; targets=${JSON.stringify(targets)}; observed=${JSON.stringify(observed)}`,
	);
}

/**
 * Execute the real refresh-control click and require an independently observed
 * busy-state transition before settlement is allowed to count. Failure evidence
 * is captured for both actionability errors and swallowed/no-op clicks.
 *
 * @param {{
 *   click: () => Promise<void>;
 *   waitForAcknowledgement: () => Promise<{
 *     initial: {ariaBusy: string | null; dataRefreshing: string | null} | null;
 *     observed: {ariaBusy: string | null; dataRefreshing: string | null} | null;
 *     clickEventAtMs: number | null;
 *     observedAtMs: number | null;
 *     clickPoint?: {x: number; y: number} | null;
 *   } | null>;
 *   captureFailureEvidence: (acknowledgement: {
 *     initial: {ariaBusy: string | null; dataRefreshing: string | null} | null;
 *     observed: {ariaBusy: string | null; dataRefreshing: string | null} | null;
 *     clickEventAtMs: number | null;
 *     observedAtMs: number | null;
 *     clickPoint?: {x: number; y: number} | null;
 *   } | null) => Promise<Record<string, unknown>>;
 *   timeoutMs?: number;
 * }} options
 */
export async function requireRefreshAcknowledgement({
	click,
	waitForAcknowledgement,
	captureFailureEvidence,
	timeoutMs = 1_000,
}) {
	let clickFailure = null;
	try {
		await click();
	} catch (error) {
		clickFailure = error;
	}

	const acknowledgement = clickFailure == null ? await waitForAcknowledgement() : null;
	if (
		acknowledgement != null &&
		acknowledgement.initial != null &&
		acknowledgement.observed != null
	) {
		const initialSignals = [
			acknowledgement.initial.ariaBusy,
			acknowledgement.initial.dataRefreshing,
		];
		const initialWasNonBusy = initialSignals.includes('false') && !initialSignals.includes('true');
		const observedBusy =
			acknowledgement.observed.ariaBusy === 'true' ||
			acknowledgement.observed.dataRefreshing === 'true';
		const elapsed =
			typeof acknowledgement.clickEventAtMs === 'number' &&
			typeof acknowledgement.observedAtMs === 'number'
				? acknowledgement.observedAtMs - acknowledgement.clickEventAtMs
				: Number.NaN;
		if (initialWasNonBusy && observedBusy && elapsed >= 0 && elapsed <= timeoutMs) return;
	}

	const evidence = await captureFailureEvidence(acknowledgement);
	if (clickFailure != null) {
		const message = clickFailure instanceof Error ? clickFailure.message : String(clickFailure);
		throw new Error(
			`Refresh control click failed: ${message}; evidence=${JSON.stringify(evidence)}`,
			{
				cause: clickFailure,
			},
		);
	}
	throw new Error(
		`Refresh control did not prove a false-to-true aria-busy/data-refreshing transition within ${timeoutMs}ms; evidence=${JSON.stringify(evidence)}`,
	);
}

/**
 * A route-handler settlement is only intent; Playwright's transport events prove
 * whether the browser actually received it. Require every post-baseline request
 * to finish, none to fail, and every corresponding HTTP settlement to be 200.
 *
 * @param {{requests: number; finished: number; failed: number; settlements: number}} baseline
 * @param {{
 *   requests: number;
 *   finished: number;
 *   failed: number;
 *   settlements: readonly {status: number}[];
 * }} current
 */
export function successfulRoutedRequestsSince(baseline, current) {
	const requestDelta = current.requests - baseline.requests;
	const finishedDelta = current.finished - baseline.finished;
	const failedDelta = current.failed - baseline.failed;
	const settlements = current.settlements.slice(baseline.settlements);

	return (
		requestDelta > 0 &&
		finishedDelta === requestDelta &&
		failedDelta === 0 &&
		settlements.length === requestDelta &&
		settlements.every((settlement) => settlement.status === 200)
	);
}

/**
 * @param {RequestCounts} requests
 * @param {RequestCounts} completed
 */
export function allRoutedRequestsCompleted(requests, completed) {
	return LIVE_FAMILIES.every((family) => completed[family] === requests[family]);
}

/**
 * @param {{
 *   requests: RequestCounts;
 *   completed: RequestCounts;
 *   waitForFrame: () => Promise<void>;
 *   waitForRetry?: () => Promise<void>;
 *   timeoutMs?: number;
 *   now?: () => number;
 * }} options
 */
export async function waitForRoutedRequestIdle({
	requests,
	completed,
	waitForFrame,
	waitForRetry = () => new Promise((resolve) => setTimeout(resolve, 50)),
	timeoutMs = 12_000,
	now = Date.now,
}) {
	const started = now();
	let stableSignature = null;

	while (now() - started < timeoutMs) {
		if (!allRoutedRequestsCompleted(requests, completed)) {
			stableSignature = null;
		} else {
			await waitForFrame();
			if (!allRoutedRequestsCompleted(requests, completed)) {
				stableSignature = null;
			} else {
				const signature = JSON.stringify(requests);
				if (signature === stableSignature) return;
				stableSignature = signature;
			}
		}
		await waitForRetry();
	}

	throw new Error(
		`Timed out waiting for routed live requests to finish and remain idle; requests=${JSON.stringify(requests)} completed=${JSON.stringify(completed)}`,
	);
}

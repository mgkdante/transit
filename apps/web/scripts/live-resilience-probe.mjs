import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
	activeMapFamilies,
	commitProbeSelection,
	createFixtureGenerationClock,
	expectedRequestsAfterCycle,
	FIXTURE_GENERATION_MONOTONIC_FLOOR_MS,
	lastServedGeneratedUtcByFamily,
	requireRefreshAcknowledgement,
	successfulRoutedRequestsSince,
	waitForRoutedRequestIdle,
	waitForRequestTargets,
} from './live-resilience-probe-contract.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const targetArg = process.argv[2];
if (!targetArg) {
	throw new Error('Usage: node scripts/live-resilience-probe.mjs <vite-dev-url>');
}

const targetUrl = new URL(targetArg);
if (!['http:', 'https:'].includes(targetUrl.protocol)) {
	throw new Error(`Vite dev URL must use http or https: ${targetUrl.href}`);
}

const PROBE_VEHICLE_ID = 'm1-probe-vehicle';
const FAMILY_FILES = {
	vehicles: 'vehicles.json',
	trips: 'trips.json',
	departures: 'stop_departures.json',
	alerts: 'alerts.json',
	network: 'network.json',
};
const LIVE_PATH_FAMILIES = {
	'vehicles.json': 'vehicles',
	'trips.json': 'trips',
	'stop_departures.json': 'departures',
	'alerts.json': 'alerts',
	'network.json': 'network',
};
const FAMILY_NAMES = Object.keys(FAMILY_FILES);
const KNOWN_NON_LIVE_503_PATH = '/api/stops/slim';
const REFRESH_ACKNOWLEDGEMENT_TIMEOUT_MS = 1_000;
const REFRESH_ACKNOWLEDGEMENT_KEY = '__transitM1RefreshAcknowledgement';
const DEFAULT_LIVE_TTL_S = 30;
const STALE_TTL_MULTIPLIER = 3;
const SELECTION_CANDIDATE_RATIOS = [
	[0.47, 0.5],
	[0.47, 0.495],
	[0.47, 0.505],
	[0.465, 0.5],
	[0.475, 0.5],
	[0.46, 0.5],
	[0.48, 0.5],
	[0.49, 0.5],
	[0.5, 0.5],
];
const FIXTURE_ROOT = new URL('./__fixtures__/live/', import.meta.url);
const DEBUG_ROOT = new URL('./__probe-debug__/', import.meta.url);
const FIXTURES = Object.fromEntries(
	Object.entries(FAMILY_FILES).map(([family, filename]) => [
		family,
		JSON.parse(readFileSync(new URL(filename, FIXTURE_ROOT), 'utf8')),
	]),
);

const selectors = {
	mapStage: 'div[role="region"][data-slot="map-stage"]',
	mapCanvas: 'canvas.maplibregl-canvas',
	mapHero: '.map-hero',
	vehicleHover: '.map-peek .map-selection-detail[data-kind="vehicle"]',
	freshness: '[data-slot="freshness-stamp"][data-age-seconds]',
	stall: '[data-slot="map-feed-stall"]',
	liveEdge: '.map-live-edge[data-state]',
	detail: '[data-slot="map-detail-overlay"]',
	detailPanel: '[data-slot="right-panel"]',
	navPill: '[data-slot="nav-pill"]',
	refreshControl: '[data-slot="refresh-control"]',
	refresh: '[data-slot="refresh-control"] button',
};

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function familyFromUrl(rawUrl) {
	const filename = new URL(rawUrl).pathname.split('/').at(-1);
	return LIVE_PATH_FAMILIES[filename] ?? null;
}

function shiftedIso(iso, offsetMs) {
	return new Date(Date.parse(iso) + offsetMs).toISOString();
}

function materializeFixture(family, fixture, generatedUtc, omitVehicle) {
	const payload = structuredClone(fixture);
	payload.generated_utc = generatedUtc;

	if (family === 'vehicles') {
		payload.vehicles = omitVehicle ? [] : payload.vehicles;
		for (const vehicle of payload.vehicles) {
			vehicle.updated_utc = generatedUtc;
			vehicle.reported_utc = shiftedIso(generatedUtc, -5_000);
		}
	} else if (family === 'trips') {
		for (const trip of Object.values(payload.trips)) {
			for (const stop of trip.stops ?? []) {
				stop.eta_utc = shiftedIso(generatedUtc, 5 * 60_000);
			}
		}
	} else if (family === 'departures') {
		for (const departures of Object.values(payload.stops ?? {})) {
			for (const departure of departures) {
				departure.eta_utc = shiftedIso(generatedUtc, 5 * 60_000);
			}
		}
	} else if (family === 'alerts') {
		for (const alert of payload.alerts) {
			alert.start_utc = shiftedIso(generatedUtc, -60 * 60_000);
			alert.end_utc = shiftedIso(generatedUtc, 60 * 60_000);
		}
	}

	return payload;
}

async function waitUntil(predicate, label, timeoutMs = 10_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

async function waitForProbeRequestIdle(page, harness) {
	await waitForRoutedRequestIdle({
		requests: harness.requests,
		completed: harness.completed,
		waitForFrame: () =>
			page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve))),
	});
}

// A request the app aborts mid-fulfillment throws from route.fulfill and emits
// neither requestfinished nor requestfailed; the barrier must still count it.
async function fulfillCountingAborts(route, family, completed, failed, response) {
	try {
		await route.fulfill(response);
		return true;
	} catch {
		completed[family] += 1;
		failed[family] += 1;
		return false;
	}
}

async function installLiveRoutes(
	page,
	{ baseAgeMs = 5_000, frozenAgeMs = null, skewsMs = {} } = {},
) {
	const requests = Object.fromEntries(FAMILY_NAMES.map((family) => [family, 0]));
	const completed = Object.fromEntries(FAMILY_NAMES.map((family) => [family, 0]));
	const finished = Object.fromEntries(FAMILY_NAMES.map((family) => [family, 0]));
	const failed = Object.fromEntries(FAMILY_NAMES.map((family) => [family, 0]));
	const failureFamilies = new Set();
	const verifiedLeases = new Set();
	const settlements = Object.fromEntries(FAMILY_NAMES.map((family) => [family, []]));
	const nextGeneratedUtc = createFixtureGenerationClock({
		baseAgeMs,
		frozenAgeMs,
		skewsMs,
	});
	let omitVehicle = false;

	const markFinished = (request) => {
		const family = familyFromUrl(request.url());
		if (family && request.method() === 'GET') {
			completed[family] += 1;
			finished[family] += 1;
		}
	};
	const markFailed = (request) => {
		const family = familyFromUrl(request.url());
		if (family && request.method() === 'GET') {
			completed[family] += 1;
			failed[family] += 1;
		}
	};
	page.on('requestfinished', markFinished);
	page.on('requestfailed', markFailed);

	// `/api/stops/slim` may return its documented fail-soft 503 in Vite dev, after
	// which the map falls back to the full static stops index. It is deliberately
	// passed through: this probe owns only the five live families, and treating the
	// static-catalogue fast path as a sixth routed family would corrupt the barrier.
	await page.route('**/live/*.json', async (route) => {
		const family = familyFromUrl(route.request().url());
		if (!family || route.request().method() !== 'GET') {
			await route.continue();
			return;
		}

		requests[family] += 1;
		const headers = {
			age: '0',
			'cache-control': 'no-store',
			'content-type': 'application/json; charset=utf-8',
			date: new Date().toUTCString(),
		};

		if (failureFamilies.has(family)) {
			// An unread error body never emits requestfinished (the app throws on
			// !res.ok without consuming it); an empty body completes immediately.
			const delivered = await fulfillCountingAborts(route, family, completed, failed, {
				status: 500,
				headers: { ...headers, 'content-length': '0' },
				body: '',
			});
			settlements[family].push({
				status: 500,
				generatedUtc: null,
				omittedVehicle: false,
				delivered,
			});
			return;
		}

		const generatedUtc = nextGeneratedUtc(family);
		const omitted = family === 'vehicles' && omitVehicle;
		const payload = materializeFixture(family, FIXTURES[family], generatedUtc, omitted);
		const servedGeneratedUtc = payload.generated_utc;
		assert(
			servedGeneratedUtc === generatedUtc,
			`Probe served an unstamped ${family} fixture: expected ${generatedUtc}, got ${String(servedGeneratedUtc)}`,
		);
		const delivered = await fulfillCountingAborts(route, family, completed, failed, {
			status: 200,
			headers,
			body: JSON.stringify(payload),
		});
		settlements[family].push({
			status: 200,
			generatedUtc: servedGeneratedUtc,
			omittedVehicle: omitted,
			delivered,
		});
	});

	return {
		requests,
		completed,
		finished,
		failed,
		settlements,
		verifiedLeases,
		fail(family, enabled = true) {
			if (enabled) failureFamilies.add(family);
			else failureFamilies.delete(family);
		},
		omitVehicle(enabled = true) {
			omitVehicle = enabled;
		},
		summary() {
			return Object.fromEntries(
				FAMILY_NAMES.map((family) => [
					family,
					{
						requests: requests[family],
						completed: completed[family],
						finished: finished[family],
						failed: failed[family],
						settlements: settlements[family],
					},
				]),
			);
		},
	};
}

async function domSnapshot(page) {
	return page.evaluate((s) => {
		const visible = (element) =>
			element != null &&
			element.getClientRects().length > 0 &&
			getComputedStyle(element).visibility !== 'hidden';
		const stamps = [...document.querySelectorAll(s.freshness)];
		const stamp = stamps.find(visible) ?? stamps[0] ?? null;
		const edge = document.querySelector(s.liveEdge);
		const hero = document.querySelector(s.mapHero);
		const details = [...document.querySelectorAll(s.detail)];

		return {
			freshness: stamp
				? {
						ageSeconds: Number(stamp.getAttribute('data-age-seconds')),
						generatedUtc: stamp.querySelector('time')?.getAttribute('datetime') ?? null,
						stale: stamp.getAttribute('data-stale'),
						degraded: stamp.getAttribute('data-degraded'),
						text: stamp.textContent?.trim() ?? '',
					}
				: null,
			edge: edge
				? {
						state: edge.getAttribute('data-state'),
						text: edge.textContent?.trim() ?? '',
					}
				: null,
			stallVisible: visible(document.querySelector(s.stall)),
			selection: hero
				? {
						presence: hero.getAttribute('data-selection-presence'),
						sourceHealth: hero.getAttribute('data-selection-source-health'),
					}
				: null,
			motion: hero
				? {
						stale: hero.getAttribute('data-motion-stale'),
						tickKey: hero.getAttribute('data-motion-tick-key'),
					}
				: null,
			detailVisible: details.some(visible),
		};
	}, selectors);
}

async function settle(page, harness, minimumRequests = { vehicles: 1, alerts: 1 }) {
	await page.locator(selectors.mapStage).waitFor({ state: 'visible' });
	await waitForRequestTargets({
		targets: minimumRequests,
		readObserved: () => ({ ...harness.requests }),
	});
	await waitForProbeRequestIdle(page, harness);
	await page.waitForFunction((s) => {
		const stamps = [...document.querySelectorAll(s.freshness)];
		return (
			stamps.some((stamp) => stamp.getClientRects().length > 0) &&
			document.querySelector(s.liveEdge) != null
		);
	}, selectors);
	await page.evaluate(async (s) => {
		await document.fonts.ready;
		let previous = '';
		let stableFrames = 0;
		const started = performance.now();
		while (stableFrames < 3 && performance.now() - started < 5_000) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const hero = document.querySelector(s.mapHero);
			const edge = document.querySelector(s.liveEdge);
			const current = JSON.stringify({
				presence: hero?.getAttribute('data-selection-presence'),
				health: hero?.getAttribute('data-selection-source-health'),
				edge: edge?.getAttribute('data-state'),
				detail: document.querySelectorAll(s.detail).length,
			});
			stableFrames = current === previous ? stableFrames + 1 : 0;
			previous = current;
		}
	}, selectors);
}

async function readSelectionPresence(page) {
	return page.locator(selectors.mapHero).getAttribute('data-selection-presence');
}

async function pauseBackgroundLiveCadence(page, harness) {
	await waitForProbeRequestIdle(page, harness);
	const online = await page.evaluate(() => {
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			get: () => false,
		});
		window.dispatchEvent(new Event('offline'));
		return navigator.onLine;
	});
	assert(online === false, 'Probe could not pause the background live cadence');
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
	await waitForProbeRequestIdle(page, harness);
}

async function projectProbeVehiclePoint(page, attempt) {
	const stage = page.locator(selectors.mapStage);
	const box = await stage.boundingBox();
	if (!box) throw new Error(`Map stage has no clickable box on selection attempt ${attempt}`);
	const [xRatio, yRatio] = SELECTION_CANDIDATE_RATIOS[attempt - 1];
	return {
		x: box.x + box.width * xRatio,
		y: box.y + box.height * yRatio,
	};
}

async function waitForProbeVehicleAtPoint(page, point, attempt) {
	const timeoutMs = attempt === 1 ? 4_000 : 1_500;
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		// Re-fire MapHero's real mousemove picker while SwiftShader catches up. The
		// vehicle-specific hover detail is produced by the same queryRenderedFeatures
		// path as click, so it proves more than canvas/style load.
		await page.mouse.move(point.x + 32, point.y + 32);
		await page.mouse.move(point.x, point.y);
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
		const ready = await page.evaluate(
			({ id, s }) => {
				const canvas = document.querySelector(s.mapCanvas);
				const detail = document.querySelector(s.vehicleHover);
				return (
					canvas?.style.cursor === 'pointer' &&
					detail != null &&
					detail.getClientRects().length > 0 &&
					detail.textContent?.includes(id) === true
				);
			},
			{ id: PROBE_VEHICLE_ID, s: selectors },
		);
		if (ready) return true;
		await page.waitForTimeout(100);
	}
	return false;
}

async function waitForCommittedSelection(page) {
	try {
		await page.waitForFunction(
			(s) =>
				document.querySelector(s.mapHero)?.getAttribute('data-selection-presence') === 'present',
			selectors,
			{ timeout: 2_000 },
		);
		return true;
	} catch {
		return false;
	}
}

async function selectProbeVehicle(page, harness) {
	await page.waitForURL((url) => !url.searchParams.has('focus'));
	const stage = page.locator(selectors.mapStage);
	await stage.waitFor({ state: 'visible' });
	await stage.locator(selectors.mapCanvas).waitFor({ state: 'visible' });
	await page.waitForFunction(
		(s) => document.querySelector(s.mapHero)?.getAttribute('data-motion-tick-key') != null,
		selectors,
	);

	let tripsBeforeClick = {
		requests: harness.requests.trips,
		finished: harness.finished.trips,
		failed: harness.failed.trips,
		settlements: harness.settlements.trips.length,
	};
	try {
		const proof = await commitProbeSelection({
			maxAttempts: SELECTION_CANDIDATE_RATIOS.length,
			projectPoint: (attempt) => projectProbeVehiclePoint(page, attempt),
			waitForVehicleAtPoint: (point, attempt) => waitForProbeVehicleAtPoint(page, point, attempt),
			clickPoint: async (point) => {
				tripsBeforeClick = {
					requests: harness.requests.trips,
					finished: harness.finished.trips,
					failed: harness.failed.trips,
					settlements: harness.settlements.trips.length,
				};
				await page.mouse.click(point.x, point.y);
			},
			waitForCommittedPresence: () => waitForCommittedSelection(page),
			readSelectionPresence: () => readSelectionPresence(page),
			waitForTripsLease: async () => {
				try {
					await waitUntil(
						() => harness.requests.trips > tripsBeforeClick.requests,
						'selection-scoped trips lease request',
						6_000,
					);
					await waitForProbeRequestIdle(page, harness);
					return successfulRoutedRequestsSince(tripsBeforeClick, {
						requests: harness.requests.trips,
						finished: harness.finished.trips,
						failed: harness.failed.trips,
						settlements: harness.settlements.trips,
					});
				} catch {
					return false;
				}
			},
			waitForBackoff: (attempt) => page.waitForTimeout(Math.min(150 * 2 ** (attempt - 1), 1_200)),
		});
		harness.verifiedLeases.add('trips');
		await settle(page, harness, {
			vehicles: 1,
			alerts: 1,
			trips: harness.requests.trips,
		});
		return {
			...proof,
			tripsRequests: harness.requests.trips,
			tripsCompleted: harness.completed.trips,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const presence = await readSelectionPresence(page);
		throw new Error(
			`Probe vehicle selection step failed before poll arithmetic: ${message}; URL=${page.url()}; data-selection-presence="${presence ?? 'missing'}"; trips requests=${harness.requests.trips}, completed=${harness.completed.trips}`,
			{ cause: error },
		);
	}
}

async function openScenario(
	browser,
	{ selectVehicle = false, baseAgeMs, frozenAgeMs, skewsMs } = {},
) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		colorScheme: 'dark',
		// URL focus becomes a synchronous jump, leaving GL render readiness as the
		// only selection wait. Receipts assert controller inputs, not interpolation.
		reducedMotion: 'reduce',
		serviceWorkers: 'block',
	});
	const page = await context.newPage();
	const harness = await installLiveRoutes(page, { baseAgeMs, frozenAgeMs, skewsMs });
	const path = selectVehicle
		? `/map?vehicle=${encodeURIComponent(PROBE_VEHICLE_ID)}&focus=${encodeURIComponent(
				`vehicle:${PROBE_VEHICLE_ID}`,
			)}`
		: '/map';
	const url = new URL(path, `${targetUrl.origin}/`).href;
	try {
		const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
		if (!response?.ok()) {
			throw new Error(`Navigation failed (${response?.status() ?? 'no response'}): ${url}`);
		}

		await settle(page, harness);
		// Freeze autonomous TTL + manifest-pulse triggers after the constructor
		// baseline. The real refresh epoch and lease paths still run, so each exact
		// request delta below belongs to the receipt action that triggered it.
		await pauseBackgroundLiveCadence(page, harness);
		const selectionProof = selectVehicle ? await selectProbeVehicle(page, harness) : null;
		return { context, page, harness, selectionProof, url };
	} catch (error) {
		await context.close();
		throw error;
	}
}

async function armRefreshAcknowledgement(page) {
	await page.evaluate(
		({ key, selector }) => {
			const button = document.querySelector(selector);
			if (!(button instanceof HTMLButtonElement)) {
				throw new Error(`Refresh acknowledgement could not find ${selector}`);
			}

			const previous = globalThis[key];
			previous?.observer?.disconnect();
			previous?.button?.removeEventListener('click', previous.onClick);
			const readState = () => ({
				ariaBusy: button.getAttribute('aria-busy'),
				dataRefreshing: button.getAttribute('data-refreshing'),
				disabled: button.disabled,
			});
			const state = {
				armedAtMs: performance.now(),
				clickEventAtMs: null,
				clickPoint: null,
				initial: readState(),
				observed: null,
				observedAtMs: null,
				observedAfterClickMs: null,
			};
			const onClick = (event) => {
				state.clickEventAtMs = performance.now();
				state.clickPoint = { x: event.clientX, y: event.clientY };
			};
			button.addEventListener('click', onClick, { once: true });
			const observer = new MutationObserver(() => {
				const current = readState();
				if (current.ariaBusy !== 'true' && current.dataRefreshing !== 'true') return;
				if (state.clickEventAtMs == null) return;
				state.observed = current;
				state.observedAtMs = performance.now();
				state.observedAfterClickMs = state.observedAtMs - state.clickEventAtMs;
				observer.disconnect();
			});
			observer.observe(button, {
				attributes: true,
				attributeFilter: ['aria-busy', 'data-refreshing'],
			});
			globalThis[key] = { button, observer, onClick, state };
		},
		{ key: REFRESH_ACKNOWLEDGEMENT_KEY, selector: selectors.refresh },
	);
}

async function waitForRefreshAcknowledgement(page) {
	try {
		await page.waitForFunction(
			(key) => globalThis[key]?.state?.observed != null,
			REFRESH_ACKNOWLEDGEMENT_KEY,
			{ polling: 25, timeout: REFRESH_ACKNOWLEDGEMENT_TIMEOUT_MS },
		);
	} catch {
		// Return the raw state below; the contract distinguishes a missing
		// observation from a valid false-to-true transition.
	}
	return page.evaluate((key) => globalThis[key]?.state ?? null, REFRESH_ACKNOWLEDGEMENT_KEY);
}

async function clearRefreshAcknowledgement(page) {
	await page
		.evaluate((key) => {
			const acknowledgement = globalThis[key];
			acknowledgement?.observer?.disconnect();
			acknowledgement?.button?.removeEventListener('click', acknowledgement.onClick);
			delete globalThis[key];
		}, REFRESH_ACKNOWLEDGEMENT_KEY)
		.catch(() => undefined);
}

async function captureRefreshFailureEvidence(page, attemptedClickPoint, capturedAcknowledgement) {
	const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
	const filename = `refresh-control-unacknowledged-${timestamp}.png`;
	const screenshotUrl = new URL(filename, DEBUG_ROOT);
	const evidence = await page.evaluate(
		({ acknowledgement: suppliedAcknowledgement, attemptedPoint, key, s }) => {
			const describeElement = (element) => {
				if (!(element instanceof Element)) return null;
				const slot = element.getAttribute('data-slot');
				const id = element.id ? `#${element.id}` : '';
				const classes =
					typeof element.className === 'string' && element.className.trim()
						? `.${element.className.trim().split(/\s+/).join('.')}`
						: '';
				return `${element.tagName.toLowerCase()}${id}${classes}${slot ? `[data-slot="${slot}"]` : ''}`;
			};
			const readBox = (selector) => {
				const matches = [...document.querySelectorAll(selector)];
				const visibleMatches = matches.filter((candidate) => {
					const box = candidate.getBoundingClientRect();
					const style = getComputedStyle(candidate);
					return (
						box.width > 0 &&
						box.height > 0 &&
						style.display !== 'none' &&
						style.visibility !== 'hidden'
					);
				});
				const element = visibleMatches[0] ?? matches[0];
				if (!(element instanceof Element)) return null;
				const box = element.getBoundingClientRect();
				const style = getComputedStyle(element);
				return {
					matches: matches.length,
					visibleMatches: visibleMatches.length,
					x: box.x,
					y: box.y,
					width: box.width,
					height: box.height,
					top: box.top,
					right: box.right,
					bottom: box.bottom,
					left: box.left,
					zIndex: style.zIndex,
					pointerEvents: style.pointerEvents,
					visibility: style.visibility,
				};
			};
			const refresh = document.querySelector(s.refresh);
			const acknowledgement = suppliedAcknowledgement ?? globalThis[key]?.state ?? null;
			const point = acknowledgement?.clickPoint ?? attemptedPoint;

			return {
				attemptedClickPoint: attemptedPoint,
				clickPoint: point,
				clickReachedRefreshControl: acknowledgement?.clickPoint != null,
				elementFromPoint: describeElement(document.elementFromPoint(point.x, point.y)),
				elementsFromPoint: document
					.elementsFromPoint(point.x, point.y)
					.slice(0, 8)
					.map(describeElement),
				refreshState: refresh
					? {
							ariaBusy: refresh.getAttribute('aria-busy'),
							dataRefreshing: refresh.getAttribute('data-refreshing'),
							disabled: refresh instanceof HTMLButtonElement ? refresh.disabled : undefined,
						}
					: null,
				acknowledgement,
				boundingBoxes: {
					refreshControl: readBox(s.refreshControl),
					refreshButton: readBox(s.refresh),
					navPill: readBox(s.navPill),
					detailOverlay: readBox(s.detail),
					detailPanel: readBox(s.detailPanel),
				},
			};
		},
		{
			acknowledgement: capturedAcknowledgement,
			attemptedPoint: attemptedClickPoint,
			key: REFRESH_ACKNOWLEDGEMENT_KEY,
			s: selectors,
		},
	);

	await mkdir(DEBUG_ROOT, { recursive: true });
	let screenshotError = null;
	try {
		await page.screenshot({ path: fileURLToPath(screenshotUrl) });
	} catch (error) {
		screenshotError = error instanceof Error ? error.message : String(error);
	}
	return {
		screenshot: `scripts/__probe-debug__/${filename}`,
		screenshotError,
		...evidence,
	};
}

async function forcePoll(page, harness) {
	await waitForProbeRequestIdle(page, harness);
	const button = page.locator(selectors.refresh);
	await button.waitFor({ state: 'visible' });
	await waitUntil(() => button.isEnabled(), 'refresh control to become enabled');
	const beforeSnapshot = await domSnapshot(page);
	const before = { ...harness.requests };
	const verifiedLeases = [...harness.verifiedLeases];
	const activeFamilies = activeMapFamilies(beforeSnapshot.selection?.presence, verifiedLeases);
	const expectedRequests = expectedRequestsAfterCycle(before, activeFamilies);
	const buttonBox = await button.boundingBox();
	if (!buttonBox) throw new Error('Refresh control has no clickable bounding box');
	const clickPoint = {
		x: buttonBox.x + buttonBox.width / 2,
		y: buttonBox.y + buttonBox.height / 2,
	};
	// Requests are the ground truth: a click during an in-flight cycle coalesces
	// (single-flight) and produces neither a busy flip nor new requests, so verify
	// by per-family request arrival and retry the click when a cycle absorbed it.
	let acknowledged = false;
	for (let attempt = 1; attempt <= 4 && !acknowledged; attempt++) {
		await armRefreshAcknowledgement(page);
		try {
			await requireRefreshAcknowledgement({
				click: () => page.mouse.click(clickPoint.x, clickPoint.y),
				waitForAcknowledgement: () => waitForRefreshAcknowledgement(page),
				captureFailureEvidence: (acknowledgement) =>
					captureRefreshFailureEvidence(page, clickPoint, acknowledgement),
				timeoutMs: REFRESH_ACKNOWLEDGEMENT_TIMEOUT_MS,
			});
			acknowledged = true;
		} catch (error) {
			const arrived = Object.entries(expectedRequests).every(
				([family, expected]) => harness.requests[family] >= expected,
			);
			if (arrived) {
				acknowledged = true; // coalesced flip was unobservable; requests prove the cycle
			} else if (attempt === 4) {
				throw error;
			} else {
				await waitForProbeRequestIdle(page, harness);
			}
		} finally {
			await clearRefreshAcknowledgement(page);
		}
	}
	await waitUntil(
		async () => (await button.getAttribute('data-refreshing')) === 'false',
		'refresh control settlement',
		12_000,
	);
	await settle(page, harness, expectedRequests);
	for (const [family, expected] of Object.entries(expectedRequests)) {
		assert(
			harness.requests[family] === expected,
			`Forced cycle request mismatch for ${family}: expected ${expected}, got ${harness.requests[family]}`,
		);
	}
	return {
		...(await domSnapshot(page)),
		forcedCycle: {
			leaseTruth: {
				selectionPresence: beforeSnapshot.selection?.presence ?? null,
				verifiedLeases,
				activeFamilies,
			},
			beforeRequests: before,
			expectedRequests,
			observedRequests: { ...harness.requests },
		},
	};
}

function assertAdvancing(harness, family) {
	const generations = harness.settlements[family]
		.filter((settlement) => settlement.status === 200)
		.map((settlement) => Date.parse(settlement.generatedUtc));
	for (let index = 1; index < generations.length; index += 1) {
		assert(
			generations[index] > generations[index - 1],
			`${family} fixture stamp did not advance at settlement ${index + 1}`,
		);
	}
}

function routedTransportBaseline(harness, family) {
	return {
		requests: harness.requests[family],
		finished: harness.finished[family],
		failed: harness.failed[family],
		settlements: harness.settlements[family].length,
	};
}

function routedTransportCurrent(harness, family) {
	return {
		requests: harness.requests[family],
		finished: harness.finished[family],
		failed: harness.failed[family],
		settlements: harness.settlements[family],
	};
}

async function selectionCommitsAndLeasesReceipt(browser) {
	const scenario = await openScenario(browser, { selectVehicle: true });
	try {
		const snapshot = await domSnapshot(scenario.page);
		const trips = scenario.harness.summary().trips;
		assert(
			snapshot.selection?.presence === 'present',
			'receipt-0 did not observe committed selection presence',
		);
		assert(
			scenario.harness.verifiedLeases.has('trips'),
			'receipt-0 did not verify the trips lease',
		);
		assert(
			trips.requests >= 1 &&
				trips.finished === trips.requests &&
				trips.failed === 0 &&
				trips.completed === trips.requests,
			`receipt-0 trips lease did not settle successfully: requests=${trips.requests}, finished=${trips.finished}, failed=${trips.failed}`,
		);
		assert(
			trips.settlements.length === trips.requests &&
				trips.settlements.every((settlement) => settlement.status === 200),
			'receipt-0 trips lease did not settle successfully',
		);
		return {
			selectionProof: scenario.selectionProof,
			snapshot,
			routes: scenario.harness.summary(),
			observation:
				'The rendered vehicle hover seam became ready, the click committed data-selection-presence=present, and a successful trips request proved the selection-scoped lease before any forced cycle.',
		};
	} finally {
		await scenario.context.close();
	}
}

async function alertsFailureReceipt(browser) {
	const scenario = await openScenario(browser, { selectVehicle: true });
	try {
		const healthyCycleSnapshot = await forcePoll(scenario.page, scenario.harness);
		const healthyCycleStamps = lastServedGeneratedUtcByFamily(scenario.harness.settlements);
		const healthyCycleSampledAtMs = Date.now();
		const activeFamilyAgeSeconds = Object.fromEntries(
			healthyCycleSnapshot.forcedCycle.leaseTruth.activeFamilies.map((family) => {
				const generatedUtc = healthyCycleStamps[family];
				return [
					family,
					generatedUtc == null
						? null
						: Math.round((healthyCycleSampledAtMs - Date.parse(generatedUtc)) / 1000),
				];
			}),
		);
		assert(
			Object.values(activeFamilyAgeSeconds).every(
				(ageSeconds) => ageSeconds != null && ageSeconds >= 0 && ageSeconds < staleThresholdS,
			),
			`receipt-1 adjudication-C precondition failed; activeFamilyAgeSeconds=${JSON.stringify(activeFamilyAgeSeconds)}; thresholdSeconds=${staleThresholdS}`,
		);
		const before = await domSnapshot(scenario.page);
		const vehicleBaseline = routedTransportBaseline(scenario.harness, 'vehicles');
		scenario.harness.fail('alerts');
		const forcedCycleSnapshot = await forcePoll(scenario.page, scenario.harness);
		const currentVehicles = routedTransportCurrent(scenario.harness, 'vehicles');
		const vehicleRevisions = currentVehicles.settlements.slice(vehicleBaseline.settlements);
		assert(
			vehicleRevisions.length === 1 &&
				vehicleRevisions[0].status === 200 &&
				vehicleRevisions[0].generatedUtc != null,
			'receipt-1 did not produce exactly one successful vehicles revision',
		);
		assert(
			successfulRoutedRequestsSince(vehicleBaseline, currentVehicles),
			'receipt-1 vehicles revision did not finish successfully in the browser',
		);
		const vehicleRevision = vehicleRevisions[0];
		await waitUntil(
			async () =>
				(await domSnapshot(scenario.page)).motion?.tickKey === vehicleRevision.generatedUtc,
			'receipt-1 DOM to commit the forced vehicles revision',
		);
		const after = {
			...(await domSnapshot(scenario.page)),
			forcedCycle: forcedCycleSnapshot.forcedCycle,
		};
		const freshnessEvidence = {
			sampledAtUtc: new Date().toISOString(),
			ageSeconds: after.freshness?.ageSeconds ?? null,
			aggregateGeneratedUtc: after.freshness?.generatedUtc ?? null,
			activeFamilies: after.forcedCycle.leaseTruth.activeFamilies,
			lastServedGeneratedUtcByFamily: lastServedGeneratedUtcByFamily(scenario.harness.settlements),
			adjudicationCPrecondition: {
				activeFamilyAgeSeconds,
				thresholdSeconds: staleThresholdS,
			},
		};
		// Frozen adjudication C: this aggregate is fresh only because every active
		// family's retained stamp remains inside 3×TTL during this receipt. A failed
		// family may honestly age past 3×TTL and make the aggregate stale later.
		assert(
			after.freshness?.stale === 'false',
			`alerts failure made healthy vehicles stale; evidence=${JSON.stringify(freshnessEvidence)}`,
		);
		assert(after.motion?.stale === 'false', 'alerts failure made the vehicle motion input stale');
		assert(
			Date.parse(after.motion?.tickKey ?? '') > Date.parse(before.motion?.tickKey ?? ''),
			'healthy vehicle stamp did not advance through the alerts failure',
		);
		assert(after.freshness?.degraded === 'true', 'alerts failure was not rendered as degraded');
		assert(
			after.edge?.state === 'selected-family-failure',
			'selected alerts-family failure lost announcement priority',
		);
		assert(
			after.motion?.tickKey === vehicleRevision.generatedUtc,
			'receipt-1 sampled motion state before the forced vehicles revision committed',
		);
		assert(after.selection?.presence === 'present', 'alerts failure closed the vehicle detail');
		assert(after.selection?.sourceHealth === 'ok', 'alerts failure poisoned vehicle source health');
		assert(after.detailVisible, 'alerts failure removed the retained vehicle panel');
		assertAdvancing(scenario.harness, 'vehicles');
		return {
			before,
			after,
			vehicleRevisionProof: {
				baselineTickKey: before.motion?.tickKey ?? null,
				generatedUtc: vehicleRevision.generatedUtc,
				sampledTickKey: after.motion?.tickKey ?? null,
				requestDelta: currentVehicles.requests - vehicleBaseline.requests,
				finishedDelta: currentVehicles.finished - vehicleBaseline.finished,
				failedDelta: currentVehicles.failed - vehicleBaseline.failed,
				status: vehicleRevision.status,
			},
			routes: scenario.harness.summary(),
			observation:
				'The vehicles-only controller tick advances and stays non-stale while detail presence and vehicle source health remain healthy through the alerts failure.',
		};
	} finally {
		await scenario.context.close();
	}
}

async function threeOmissionsReceipt(browser) {
	const scenario = await openScenario(browser, { selectVehicle: true });
	try {
		const before = await domSnapshot(scenario.page);
		const vehicleBaseline = routedTransportBaseline(scenario.harness, 'vehicles');
		scenario.harness.omitVehicle();
		const frames = [];
		for (let omission = 1; omission <= 3; omission += 1) {
			const forcedCycleSnapshot = await forcePoll(scenario.page, scenario.harness);
			const revision = scenario.harness.settlements.vehicles.at(-1);
			assert(
				revision?.status === 200 && revision.generatedUtc != null && revision.omittedVehicle,
				`receipt-2 omission ${omission} did not produce a successful omitted vehicles revision`,
			);
			await waitUntil(
				async () => (await domSnapshot(scenario.page)).motion?.tickKey === revision.generatedUtc,
				`receipt-2 omission ${omission} DOM commit`,
			);
			frames.push({
				...(await domSnapshot(scenario.page)),
				forcedCycle: forcedCycleSnapshot.forcedCycle,
			});
		}
		const currentVehicles = routedTransportCurrent(scenario.harness, 'vehicles');
		const vehicleRevisions = currentVehicles.settlements.slice(vehicleBaseline.settlements);
		assert(
			currentVehicles.requests - vehicleBaseline.requests === 3 &&
				currentVehicles.finished - vehicleBaseline.finished === 3 &&
				currentVehicles.failed - vehicleBaseline.failed === 0,
			'receipt-2 did not finish exactly three post-baseline vehicles requests',
		);
		assert(
			successfulRoutedRequestsSince(vehicleBaseline, currentVehicles),
			'receipt-2 vehicles revisions did not all finish successfully in the browser',
		);
		assert(
			vehicleRevisions.length === 3 &&
				vehicleRevisions.every(
					(revision) =>
						revision.status === 200 && revision.generatedUtc != null && revision.omittedVehicle,
				),
			'receipt-2 did not record exactly three successful omitted vehicles revisions',
		);
		assert(
			vehicleRevisions.every(
				(revision, index) => frames[index].motion?.tickKey === revision.generatedUtc,
			),
			'receipt-2 sampled a grace transition before its vehicles revision committed',
		);
		assert(
			frames[0].selection?.presence === 'missing-grace' && frames[0].detailVisible,
			'first successful omission did not retain the selected panel',
		);
		assert(
			frames[1].selection?.presence === 'missing-grace' && frames[1].detailVisible,
			'second successful omission did not retain the selected panel',
		);
		assert(
			frames[2].selection?.presence === 'gone' && !frames[2].detailVisible,
			'third successful omission did not close the selected panel',
		);
		assertAdvancing(scenario.harness, 'vehicles');
		return {
			frames,
			vehicleOmissionProof: {
				baselineTickKey: before.motion?.tickKey ?? null,
				requestDelta: currentVehicles.requests - vehicleBaseline.requests,
				finishedDelta: currentVehicles.finished - vehicleBaseline.finished,
				failedDelta: currentVehicles.failed - vehicleBaseline.failed,
				revisions: vehicleRevisions.map((revision, index) => ({
					...revision,
					sampledTickKey: frames[index].motion?.tickKey ?? null,
					presence: frames[index].selection?.presence ?? null,
					detailVisible: frames[index].detailVisible,
				})),
			},
			routes: scenario.harness.summary(),
			observation:
				'The panel is retained for omissions one and two, then closes on omission three.',
		};
	} finally {
		await scenario.context.close();
	}
}

async function vehicleFailureDoesNotCountReceipt(browser) {
	const scenario = await openScenario(browser, { selectVehicle: true });
	try {
		scenario.harness.omitVehicle();
		const firstOmission = await forcePoll(scenario.page, scenario.harness);
		scenario.harness.fail('vehicles');
		const failedPoll = await forcePoll(scenario.page, scenario.harness);
		scenario.harness.fail('vehicles', false);
		const secondOmission = await forcePoll(scenario.page, scenario.harness);
		const thirdOmission = await forcePoll(scenario.page, scenario.harness);

		assert(firstOmission.selection?.presence === 'missing-grace', 'first omission missed grace');
		assert(
			failedPoll.selection?.presence === 'missing-grace' && failedPoll.detailVisible,
			'vehicle-family failure advanced or discarded omission grace',
		);
		assert(
			failedPoll.selection?.sourceHealth === 'failed',
			'vehicle-family failure was not exposed on the selection health axis',
		);
		assert(
			secondOmission.selection?.presence === 'missing-grace' && secondOmission.detailVisible,
			'failed vehicle poll incorrectly counted as the second omission',
		);
		assert(
			thirdOmission.selection?.presence === 'gone' && !thirdOmission.detailVisible,
			'third successful omission did not close after an intervening failure',
		);
		assertAdvancing(scenario.harness, 'vehicles');
		return {
			frames: { firstOmission, failedPoll, secondOmission, thirdOmission },
			routes: scenario.harness.summary(),
			observation:
				'The failed vehicles request changes source health but leaves omission grace unchanged.',
		};
	} finally {
		await scenario.context.close();
	}
}

async function mixedGenerationReceipt(browser, ttlS) {
	const tripSkewMs = Math.max(2_000, Math.floor(ttlS * 1_000 * 1.25));
	const scenario = await openScenario(browser, {
		selectVehicle: true,
		baseAgeMs: 3_000,
		skewsMs: { trips: tripSkewMs },
	});
	try {
		await waitUntil(
			async () => (await domSnapshot(scenario.page)).freshness?.ageSeconds >= ttlS,
			'oldest active trips generation to reach the freshness DOM',
		);
		const mixedSuccess = await domSnapshot(scenario.page);
		scenario.harness.fail('trips');
		const retainedFailure = await forcePoll(scenario.page, scenario.harness);

		assert(
			mixedSuccess.freshness?.ageSeconds >= ttlS,
			'aggregate freshness ignored the older active trips generation',
		);
		assert(
			retainedFailure.freshness?.ageSeconds >= mixedSuccess.freshness.ageSeconds,
			'fresher vehicle settlement hid the retained failed trips generation',
		);
		assert(
			retainedFailure.freshness?.degraded === 'true',
			'retained trips failure did not degrade freshness',
		);
		assert(
			retainedFailure.edge?.state === 'selected-family-failure' &&
				retainedFailure.edge.text.length > 0,
			'per-family retained trips failure was not rendered',
		);
		assert(retainedFailure.selection?.presence === 'present', 'mixed-family failure closed detail');
		assertAdvancing(scenario.harness, 'vehicles');
		return {
			tripSkewMs,
			mixedSuccess,
			retainedFailure,
			routes: scenario.harness.summary(),
			observation:
				'The oldest active trips generation drives age while its retained failure is announced separately from healthy vehicles.',
		};
	} finally {
		await scenario.context.close();
	}
}

async function frozenStampReceipt(browser, ttlS) {
	const frozenAgeMs = (ttlS * STALE_TTL_MULTIPLIER + 10) * 1_000;
	const scenario = await openScenario(browser, { frozenAgeMs });
	try {
		const before = await domSnapshot(scenario.page);
		const vehicleBaseline = routedTransportBaseline(scenario.harness, 'vehicles');
		const after = await forcePoll(scenario.page, scenario.harness);
		const currentVehicles = routedTransportCurrent(scenario.harness, 'vehicles');
		const vehicleRevisions = currentVehicles.settlements.slice(vehicleBaseline.settlements);
		assert(
			vehicleRevisions.length === 1 &&
				vehicleRevisions[0].status === 200 &&
				vehicleRevisions[0].generatedUtc != null,
			'receipt-5 did not produce exactly one successful frozen vehicles response',
		);
		assert(
			successfulRoutedRequestsSince(vehicleBaseline, currentVehicles),
			'receipt-5 frozen vehicles response did not finish successfully in the browser',
		);
		const vehicleRevision = vehicleRevisions[0];
		assert(after.freshness?.stale === 'true', 'frozen vehicle stamp did not render stale');
		assert(after.motion?.stale === 'true', 'frozen vehicle stamp did not stale motion input');
		assert(
			before.motion?.tickKey != null &&
				vehicleRevision.generatedUtc === before.motion.tickKey &&
				after.motion?.tickKey === before.motion.tickKey,
			'frozen control unexpectedly advanced the vehicles motion tick key',
		);
		assert(after.stallVisible, 'frozen stamp did not mount the global stall seam');
		assert(after.edge?.state === 'global-stall', 'frozen stamp did not win global stall priority');
		return {
			frozenAgeMs,
			before,
			after,
			vehicleRevisionProof: {
				baselineTickKey: before.motion.tickKey,
				generatedUtc: vehicleRevision.generatedUtc,
				sampledTickKey: after.motion?.tickKey ?? null,
				requestDelta: currentVehicles.requests - vehicleBaseline.requests,
				finishedDelta: currentVehicles.finished - vehicleBaseline.finished,
				failedDelta: currentVehicles.failed - vehicleBaseline.failed,
				status: vehicleRevision.status,
			},
			routes: scenario.harness.summary(),
			observation:
				'The successfully delivered frozen vehicles revision keeps the tick fixed, crosses the 3x TTL boundary, and feeds stale=true to motion while the global stall control renders.',
		};
	} finally {
		await scenario.context.close();
	}
}

async function viteDevManifest() {
	const manifestUrl = new URL('/data/v1/stm/manifest.json', `${targetUrl.origin}/`);
	const response = await fetch(manifestUrl, { cache: 'no-store' });
	if (!response.ok) {
		throw new Error(`Vite dev manifest preflight failed (${response.status}): ${manifestUrl.href}`);
	}
	const marker = response.headers.get('x-transit-dev-preview');
	if (!marker) {
		throw new Error(
			`Target does not expose the Vite dev manifest marker at ${manifestUrl.href}; use vite dev, not preview.`,
		);
	}
	return { manifest: await response.json(), marker };
}

async function runReceipt(id, name, execute) {
	try {
		return { id, name, passed: true, ...(await execute()) };
	} catch (error) {
		return {
			id,
			name,
			passed: false,
			error: error instanceof Error ? (error.stack ?? error.message) : String(error),
		};
	}
}

const preflight = await viteDevManifest();
const manifestLiveTtlS = preflight.manifest.files?.live?.ttl_s;
const ttlS = Math.max(1, manifestLiveTtlS ?? DEFAULT_LIVE_TTL_S);
const ttlMs = ttlS * 1_000;
const staleThresholdS = ttlS * STALE_TTL_MULTIPLIER;
const launchOptions = {
	headless: true,
	...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
		? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
		: {}),
};
const browser = await chromium.launch(launchOptions);
try {
	const receipts = [
		await runReceipt(0, 'selection commits and leases trips', () =>
			selectionCommitsAndLeasesReceipt(browser),
		),
		await runReceipt(1, 'alerts failure does not stale healthy vehicle motion inputs', () =>
			alertsFailureReceipt(browser),
		),
		await runReceipt(2, 'three successful vehicle omissions close grace exactly on the third', () =>
			threeOmissionsReceipt(browser),
		),
		await runReceipt(3, 'vehicles-family failure does not advance omission grace', () =>
			vehicleFailureDoesNotCountReceipt(browser),
		),
		await runReceipt(4, 'mixed generations render oldest-active and per-family truth', () =>
			mixedGenerationReceipt(browser, ttlS),
		),
		await runReceipt(5, 'frozen stamps trip the stale control', () =>
			frozenStampReceipt(browser, ttlS),
		),
	];
	const failures = receipts.filter((receipt) => !receipt.passed);
	const receipt = {
		targetUrl: targetUrl.href,
		generatedAt: new Date().toISOString(),
		viteDevMarker: preflight.marker,
		liveTtlS: ttlS,
		freshnessContract: {
			ttl: {
				source:
					manifestLiveTtlS == null
						? `probe-fallback:${DEFAULT_LIVE_TTL_S}`
						: 'vite-dev-manifest:files.live.ttl_s',
				manifestTtlS: manifestLiveTtlS ?? null,
				fallbackTtlS: DEFAULT_LIVE_TTL_S,
				normalizedTtlS: ttlS,
				ttlMs,
			},
			stale: {
				ttlMultiplier: STALE_TTL_MULTIPLIER,
				thresholdS: staleThresholdS,
				thresholdMs: staleThresholdS * 1_000,
				comparison:
					'Math.round((sharedClock.serverNow - vehicles.generated_utc) / 1000) >= thresholdS',
			},
			successfulFixtureStamps: {
				mode: 'fulfillment-wall-clock-minus-fixed-skew',
				defaultBaseAgeMs: 5_000,
				monotonicFloorMs: FIXTURE_GENERATION_MONOTONIC_FLOOR_MS,
			},
			frozenFixtureStamps: {
				mode: 'installation-time-fixed',
				semantics:
					'Date.now() at route installation minus frozenAgeMs; the same timestamp is returned for every later successful family fulfillment.',
			},
		},
		fixtures: Object.values(FAMILY_FILES),
		knownNonLive503: {
			path: KNOWN_NON_LIVE_503_PATH,
			handling:
				'Passed through and excluded from live-family request arithmetic; the client owns its documented static-catalogue fallback.',
		},
		backgroundCadence: {
			handling:
				'Paused through the app offline lifecycle after constructor settlement, isolating each lease or manual-refresh request delta while leaving routed fetches and the refresh epoch operative.',
		},
		passed: failures.length === 0,
		receipts,
		limitations: [
			'The public DOM exposes the exact vehicles-only stale and tick-key inputs MapHero passes to the motion controller, plus grace, detail retention, selected-family health, and global stall state.',
			'MapLibre private rendered-feature state is intentionally not inspected; snap and dim are proved at the production-owned controller-input seam.',
		],
	};
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
	if (failures.length > 0) {
		throw new Error(
			`Live resilience probe failed:\n${failures.map((failure) => `${failure.id}. ${failure.name}`).join('\n')}`,
		);
	}
} finally {
	await browser.close();
}

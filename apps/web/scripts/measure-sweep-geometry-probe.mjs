import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const WIDTHS = [390, 768, 1280, 1600];
const LOCALES = [
	{ name: 'en', prefix: '' },
	{ name: 'fr', prefix: '/fr' },
];
const TOLERANCE_PX = 1;
const FIXTURE_TRIP_ID = 'm1-probe-trip';
const MISSING_TRIP_ID = 'm1-measure-probe-missing-trip';
const TRIP_FIXTURE = JSON.parse(
	readFileSync(new URL('./__fixtures__/live/trips.json', import.meta.url), 'utf8'),
);

const ACTION = {
	delete: 'DELETE',
	body: 'var(--measure-body)',
	lede: 'var(--measure-lede)',
	notice: 'var(--measure-notice)',
	display: 'var(--measure-display)',
};

function target(id, selector, action, capProperty = null) {
	return { id, selector, action, capProperty };
}

const TARGETS = {
	listing: [
		target('listing-subtitle', '.listing-header-subtitle', ACTION.body, 'maxWidth'),
		target('listing-description', '.listing-header-description', ACTION.body, 'maxWidth'),
	],
	metrics: [
		target('metrics-lede', '.metrics-lede', ACTION.delete),
		target('metrics-preamble', '.metrics-preamble', ACTION.delete),
		target('metric-prose', '.metric__prose', ACTION.delete),
		target('metric-caveats', '.metric__caveats', ACTION.delete),
	],
	status: [
		target('health-lede', '.health-lede', ACTION.delete),
		target('health-note', '.health-note', ACTION.delete),
		target('health-gate-note', '.health-note--gate', ACTION.delete),
		target('health-lane-na-reason', '.lane-na-reason', ACTION.delete),
		target('health-note-text', '.health-note-text', ACTION.delete),
		target('health-publish-run', '.publish-run-explanation', ACTION.delete),
		target('health-coverage-note', '.coverage-note', ACTION.delete),
	],
	lineReliability: [
		target(
			'reliability-display-question',
			'.reliability-band .section-subtitle__text',
			ACTION.display,
			'maxInlineSize',
		),
		target('reliability-verdict', '.verdict__sentence', ACTION.delete),
		target('reliability-heatmap-window', '.heatmap-window-note', ACTION.delete),
		target('reliability-heatmap-insight', '.heatmap-insight', ACTION.delete),
		target('reliability-direction-callout', '.direction-callout', ACTION.delete),
		target('reliability-bunching-help', '.bunching-help', ACTION.delete),
	],
};

function parseArgs(args) {
	let baseArg;
	let phase = 'after';
	let baselinePath = null;
	let error500Path = null;
	let lineId = '24';
	let stopId = '52095';

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--phase') {
			phase = args[++index];
		} else if (arg === '--baseline') {
			baselinePath = args[++index];
		} else if (arg === '--error-500-path') {
			error500Path = args[++index];
		} else if (arg === '--line-id') {
			lineId = args[++index];
		} else if (arg === '--stop-id') {
			stopId = args[++index];
		} else if (arg.startsWith('--')) {
			throw new Error(`Unknown option: ${arg}`);
		} else if (baseArg) {
			throw new Error(`Unexpected positional argument: ${arg}`);
		} else {
			baseArg = arg;
		}
	}

	if (!baseArg || !error500Path) {
		throw new Error(
			'Usage: node scripts/measure-sweep-geometry-probe.mjs <base-url> ' +
				'--error-500-path <path> [--phase before|after] [--baseline <receipt.json>] ' +
				'[--line-id <id>] [--stop-id <id>]',
		);
	}
	if (!['before', 'after'].includes(phase)) {
		throw new Error('--phase must be before or after');
	}
	if (/^https?:\/\//.test(error500Path)) {
		throw new Error('--error-500-path must be relative to the supplied base URL');
	}
	if (phase === 'after' && !baselinePath) {
		throw new Error('--phase after requires --baseline <successful-before-receipt.json>');
	}
	if (phase === 'before' && baselinePath) {
		throw new Error('--baseline is only valid with --phase after');
	}
	for (const [name, value] of [
		['--error-500-path', error500Path],
		['--line-id', lineId],
		['--stop-id', stopId],
	]) {
		if (!value) throw new Error(`${name} requires a value`);
	}

	const baseUrl = new URL(baseArg);
	if (!['http:', 'https:'].includes(baseUrl.protocol)) {
		throw new Error(`Base URL must use http or https: ${baseUrl.href}`);
	}

	return {
		baseUrl,
		phase,
		baselinePath,
		error500Path,
		lineId,
		stopId,
	};
}

function scenarios(options) {
	const linePath = `/lines/${encodeURIComponent(options.lineId)}`;
	const stopPath = `/stop/${encodeURIComponent(options.stopId)}`;
	return [
		{ id: 'lines-list', path: '/lines', targets: TARGETS.listing },
		{
			id: 'stops-list',
			path: '/stops',
			targets: [
				...TARGETS.listing,
				target('stops-index-body', '.stops-browse-head p', ACTION.delete),
			],
		},
		{
			id: 'line-schedule',
			path: `${linePath}?tab=schedule`,
			targets: [target('line-schedule-intro', '.route-schedule-intro', ACTION.delete)],
		},
		{
			id: 'line-reliability',
			path: `${linePath}?tab=reliability`,
			targets: TARGETS.lineReliability,
		},
		{
			id: 'stop-reliability',
			path: `${stopPath}?tab=reliability`,
			targets: [
				target(
					'stop-reliability-verdict',
					"[data-slot='stop-reliability-pane'] .verdict__sentence",
					ACTION.delete,
				),
			],
		},
		{
			id: 'trip-stand-down',
			path: `/trip/${MISSING_TRIP_ID}`,
			targets: [target('trip-stand-down-body', '.trip-standdown-body', ACTION.lede, 'maxWidth')],
		},
		{
			id: 'trip-populated',
			path: `/trip/${FIXTURE_TRIP_ID}`,
			targets: [
				target('trip-populated-masthead', '.masthead-lede', ACTION.lede, 'maxWidth'),
				target('trip-prediction-caveat', '.trip-prediction-caveat', ACTION.body, 'maxWidth'),
			],
		},
		{
			id: 'search-idle',
			path: '/search',
			targets: [
				target('search-masthead', '.masthead-lede', ACTION.lede, 'maxWidth'),
				target('search-idle-body', '.search-idle-body', ACTION.notice, 'maxWidth'),
			],
		},
		{ id: 'metrics-expanded', path: '/metrics', targets: TARGETS.metrics },
		{ id: 'status-expanded', path: '/status', targets: TARGETS.status },
		{
			id: 'network-expanded',
			path: '/network',
			targets: [
				target('network-live-lede', '.network-live-lede', ACTION.delete),
				target('network-verdict', '.verdict__sentence', ACTION.delete),
			],
		},
		{
			id: 'receipt-expanded',
			path: '/receipt',
			targets: [target('receipt-day-verdict', '.receipt-day-verdict', ACTION.delete)],
		},
		{
			id: 'hotspots-expanded',
			path: '/hotspots',
			targets: [target('hotspots-verdict', '.hotspots-verdict-line', ACTION.delete)],
		},
		{
			id: 'repeat-offenders-expanded',
			path: '/repeat-offenders',
			targets: [target('repeat-definition', '.offenders-def', ACTION.delete)],
		},
		{
			id: 'error-404',
			path: '/__ws4_measure_probe_missing__',
			expectedStatus: 404,
			targets: [
				target('error-404-heading', '.error-copy h1', ACTION.delete),
				target('error-404-description', '.error-copy p', ACTION.notice, 'maxWidth'),
			],
		},
		{
			id: 'error-500',
			path: options.error500Path,
			expectedStatus: 500,
			externalErrorPath: true,
			targets: [
				target(
					'error-500-heading',
					".err [data-slot='section-heading']",
					ACTION.display,
					'maxWidth',
				),
				target('error-500-body', '.err-body', ACTION.delete),
				target('error-500-detail', '.err-detail', ACTION.delete),
			],
		},
	];
}

function localizedUrl(baseUrl, locale, scenario) {
	let path = scenario.path;
	if (scenario.externalErrorPath && path.includes('{locale}')) {
		path = path.replaceAll('{locale}', locale.prefix);
		path = path.replace(/^\/{2,}/, '/');
	}
	const hasLocalePrefix =
		locale.prefix === '' || path === locale.prefix || path.startsWith(`${locale.prefix}/`);
	if (!hasLocalePrefix) {
		path = `${locale.prefix}${path.startsWith('/') ? path : `/${path}`}`;
	}
	return new URL(path, `${baseUrl.origin}/`).href;
}

function round(value) {
	return Math.round(value * 1000) / 1000;
}

function freshTripFixture() {
	const fixture = structuredClone(TRIP_FIXTURE);
	const generated = new Date();
	fixture.generated_utc = generated.toISOString();
	for (const trip of Object.values(fixture.trips)) {
		for (const [index, stop] of (trip.stops ?? []).entries()) {
			stop.eta_utc = new Date(generated.getTime() + (index + 1) * 5 * 60_000).toISOString();
		}
	}
	return fixture;
}

function isTripJson(url) {
	const pathname = url.pathname.toLowerCase();
	return (
		pathname.endsWith('.json') &&
		/(?:^|[-_/])trips?(?:[-_.]|$)/.test(pathname.split('/').at(-1) ?? '')
	);
}

async function installTripFixture(page) {
	const fixture = freshTripFixture();
	const matcher = (url) => isTripJson(url);
	const handler = (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(fixture),
		});
	await page.route(matcher, handler);
	return () => page.unroute(matcher, handler);
}

async function expandAll(page) {
	for (let pass = 0; pass < 8; pass += 1) {
		const closed = page.locator('[data-section-trigger][aria-expanded="false"]:visible');
		const count = await closed.count();
		if (count === 0) return;
		for (let index = count - 1; index >= 0; index -= 1) {
			const trigger = closed.nth(index);
			if (await trigger.isVisible()) await trigger.click();
		}
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
	}
	throw new Error('Expand-all did not converge after 8 passes');
}

async function settle(page, targets) {
	await page.evaluate(async (requiredTargets) => {
		await document.fonts.ready;
		let lastSignature = '';
		let stableFrames = 0;
		const started = performance.now();
		while (stableFrames < 3 && performance.now() - started < 10_000) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const main = document.querySelector('main')?.getBoundingClientRect();
			const geometry = [
				document.documentElement.scrollWidth,
				document.documentElement.scrollHeight,
				main?.width ?? 0,
				main?.height ?? 0,
			];
			for (const { selector } of requiredTargets) {
				for (const element of document.querySelectorAll(selector)) {
					if (element.getClientRects().length === 0) continue;
					const rect = element.getBoundingClientRect();
					geometry.push(
						rect.left,
						rect.right,
						rect.width,
						rect.height,
						element.parentElement?.clientWidth ?? 0,
						element.parentElement?.scrollWidth ?? 0,
					);
				}
			}
			const signature = geometry.map((value) => Math.round(value * 1000) / 1000).join(':');
			stableFrames = signature === lastSignature ? stableFrames + 1 : 0;
			lastSignature = signature;
		}
		if (stableFrames < 3) throw new Error('Page geometry did not settle within 10 seconds');
	}, targets);
}

async function waitForTargets(page, targets) {
	const started = Date.now();
	let missing;
	do {
		await expandAll(page);
		await settle(page, targets);
		missing = await page.evaluate((requiredTargets) => {
			const visibleCount = (selector) =>
				[...document.querySelectorAll(selector)].filter((element) => {
					const style = getComputedStyle(element);
					return (
						style.display !== 'none' &&
						style.visibility !== 'hidden' &&
						element.getClientRects().length > 0
					);
				}).length;
			return requiredTargets
				.filter(({ selector }) => visibleCount(selector) === 0)
				.map(({ id, selector }) => `${id} (${selector})`);
		}, targets);
		if (missing.length === 0) return;
		await page.waitForTimeout(100);
	} while (Date.now() - started < 20_000);
	throw new Error(`Required migrated selectors did not render: ${missing.join(', ')}`);
}

async function assertLocale(page, expectedLocale) {
	const rendered = await page.locator('html').getAttribute('lang');
	const locale = rendered?.split('-')[0] ?? null;
	if (locale !== expectedLocale) {
		throw new Error(`Locale mismatch: expected ${expectedLocale}, rendered ${locale ?? 'none'}`);
	}
}

async function navigate(page, url, scenario) {
	const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
	const actualStatus = response?.status() ?? null;
	if (scenario.expectedStatus == null) {
		if (!response?.ok()) {
			throw new Error(`Navigation failed (${actualStatus ?? 'no response'}): ${url}`);
		}
	} else if (actualStatus !== scenario.expectedStatus) {
		throw new Error(
			`Expected HTTP ${scenario.expectedStatus}, received ${actualStatus ?? 'no response'}: ${url}`,
		);
	}
	await waitForTargets(page, scenario.targets);
}

async function measureTarget(page, requiredTarget, phase) {
	return page.evaluate(
		({ requiredTarget, phase, tolerancePx }) => {
			const px = (value) => Number.parseFloat(value) || 0;
			const expectedCapPx = (element, action, capProperty) => {
				const style = getComputedStyle(element);
				const probe = document.createElement('div');
				Object.assign(probe.style, {
					position: 'fixed',
					visibility: 'hidden',
					boxSizing: 'content-box',
					padding: '0',
					border: '0',
					maxWidth: 'none',
					maxInlineSize: 'none',
					fontFamily: style.fontFamily,
					fontSize: style.fontSize,
					fontStyle: style.fontStyle,
					fontWeight: style.fontWeight,
					fontStretch: style.fontStretch,
					writingMode: style.writingMode,
				});
				probe.style[capProperty === 'maxInlineSize' ? 'inlineSize' : 'width'] = action;
				document.body.append(probe);
				const width = probe.getBoundingClientRect().width;
				probe.remove();
				return width;
			};
			const visible = [...document.querySelectorAll(requiredTarget.selector)].filter((element) => {
				const style = getComputedStyle(element);
				return (
					style.display !== 'none' &&
					style.visibility !== 'hidden' &&
					element.getClientRects().length > 0
				);
			});
			const identityCounts = new Map();

			return visible.map((element, index) => {
				const parent = element.parentElement;
				if (!parent) throw new Error(`${requiredTarget.selector}[${index}] has no parent`);
				const style = getComputedStyle(element);
				const parentStyle = getComputedStyle(parent);
				const rect = element.getBoundingClientRect();
				const contentBoxWidth =
					rect.width -
					px(style.paddingLeft) -
					px(style.paddingRight) -
					px(style.borderLeftWidth) -
					px(style.borderRightWidth);
				const parentContentBoxWidth =
					parent.clientWidth - px(parentStyle.paddingLeft) - px(parentStyle.paddingRight);
				const parentOverflowPx = parent.scrollWidth - parent.clientWidth;
				const failures = [];
				// Digit-normalized: the key is ELEMENT identity, not content pinning —
				// live-fed copy ("about 8 in 10 trips" → "9 in 10") must join across
				// the before/after phases.
				const text =
					element.textContent?.trim().replace(/\s+/g, ' ').replace(/\d+/g, '#').slice(0, 120) ?? '';
				const landmark = element.closest('[data-slot], [data-toc], [id]');
				const identityBase = [
					element.tagName.toLowerCase(),
					element.id,
					element.getAttribute('data-slot'),
					landmark?.id,
					landmark?.getAttribute('data-slot'),
					landmark?.getAttribute('data-toc'),
					text,
				].join('::');
				const identityOrdinal = identityCounts.get(identityBase) ?? 0;
				identityCounts.set(identityBase, identityOrdinal + 1);
				const identity = `${identityBase}::${identityOrdinal}`;

				if (!(contentBoxWidth > 0)) {
					failures.push(`content-box width is ${contentBoxWidth}px`);
				}
				if (contentBoxWidth - parentContentBoxWidth > tolerancePx) {
					failures.push(
						`content-box ${contentBoxWidth}px exceeds parent content-box ${parentContentBoxWidth}px`,
					);
				}
				if (parentOverflowPx > tolerancePx) {
					failures.push(
						`parent scrollWidth ${parent.scrollWidth}px exceeds clientWidth ${parent.clientWidth}px`,
					);
				}
				if (rect.left < -tolerancePx || rect.right > innerWidth + tolerancePx) {
					failures.push(`rect [${rect.left}, ${rect.right}] escapes ${innerWidth}px viewport`);
				}

				if (phase === 'after' && requiredTarget.action === 'DELETE') {
					if (style.maxWidth !== 'none' || style.maxInlineSize !== 'none') {
						failures.push(
							`DELETE retained maxWidth=${style.maxWidth}, maxInlineSize=${style.maxInlineSize}`,
						);
					}
				} else if (phase === 'after' && requiredTarget.capProperty) {
					const cap = style[requiredTarget.capProperty];
					const expected = expectedCapPx(
						element,
						requiredTarget.action,
						requiredTarget.capProperty,
					);
					const actual = Number.parseFloat(cap);
					if (
						cap === 'none' ||
						!Number.isFinite(actual) ||
						Math.abs(actual - expected) > tolerancePx
					) {
						failures.push(
							`${requiredTarget.capProperty}=${cap} does not resolve ` +
								`${requiredTarget.action}=${expected}px`,
						);
					}
				}

				return {
					index,
					identity,
					text,
					contentBoxWidth: Math.round(contentBoxWidth * 1000) / 1000,
					borderBoxWidth: Math.round(rect.width * 1000) / 1000,
					parentContentBoxWidth: Math.round(parentContentBoxWidth * 1000) / 1000,
					parentClientWidth: parent.clientWidth,
					parentScrollWidth: parent.scrollWidth,
					parentOverflowPx,
					maxWidth: style.maxWidth,
					maxInlineSize: style.maxInlineSize,
					passed: failures.length === 0,
					failures,
				};
			});
		},
		{ requiredTarget, phase, tolerancePx: TOLERANCE_PX },
	);
}

async function measureScenario(page, scenario, url, phase) {
	await navigate(page, url, scenario);
	const targets = [];
	for (const requiredTarget of scenario.targets) {
		targets.push({
			...requiredTarget,
			measurements: await measureTarget(page, requiredTarget, phase),
		});
	}
	return { id: scenario.id, url, targets };
}

function measurementKey(cell, scenario, targetEntry, measurement) {
	return [cell.width, cell.locale, scenario.id, targetEntry.id, measurement.identity].join('|');
}

function flattenMeasurements(receipt) {
	const entries = new Map();
	for (const cell of receipt.matrix ?? []) {
		for (const scenario of cell.scenarios ?? []) {
			for (const targetEntry of scenario.targets ?? []) {
				for (const measurement of targetEntry.measurements ?? []) {
					entries.set(measurementKey(cell, scenario, targetEntry, measurement), measurement);
				}
			}
		}
	}
	return entries;
}

function compareBaseline(receipt, baseline) {
	const before = flattenMeasurements(baseline);
	const after = flattenMeasurements(receipt);
	const deltas = [];
	const failures = [];
	for (const [key, measurement] of after) {
		const prior = before.get(key);
		if (!prior) {
			failures.push(`Baseline missing measurement: ${key}`);
			continue;
		}
		deltas.push({
			key,
			beforeContentBoxWidth: prior.contentBoxWidth,
			afterContentBoxWidth: measurement.contentBoxWidth,
			deltaPx: round(measurement.contentBoxWidth - prior.contentBoxWidth),
		});
	}
	for (const key of before.keys()) {
		if (!after.has(key)) failures.push(`After receipt missing baseline measurement: ${key}`);
	}
	return { deltas, failures };
}

function registryFor(routeScenarios) {
	return routeScenarios.map(({ id, targets }) => ({
		id,
		targets: targets.map(({ id: targetId, selector, action, capProperty }) => ({
			id: targetId,
			selector,
			action,
			capProperty,
		})),
	}));
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

/** Environment-conditional failure classes. Both are RECORDED verbatim but
 *  gate only comparatively (after vs before): a conditional surface absent in
 *  BOTH phases is a runtime-state gap, not a regression; a parent overflow
 *  that already existed on the baseline gates only if it GROWS. */
const ABSENT_RE = /: Required migrated selectors did not render: /;
const OVERFLOW_RE = /: parent scrollWidth (\d+(?:\.\d+)?)px exceeds clientWidth (\d+(?:\.\d+)?)px$/;

function failureKey(failure) {
	return failure.replace(OVERFLOW_RE, ': parent-overflow');
}

function overflowPx(failure) {
	const match = failure.match(OVERFLOW_RE);
	return match ? Number(match[1]) - Number(match[2]) : null;
}

function classifyFailures(allFailures) {
	const gating = [];
	const conditionalAbsences = [];
	const preexistingOverflowCandidates = [];
	for (const failure of allFailures) {
		if (ABSENT_RE.test(failure)) conditionalAbsences.push(failure);
		else if (OVERFLOW_RE.test(failure)) preexistingOverflowCandidates.push(failure);
		else gating.push(failure);
	}
	return { gating, conditionalAbsences, preexistingOverflowCandidates };
}

function validateBaseline(baseline, registry, parameters) {
	const failures = [];
	if (baseline.probe !== 'measure-sweep-geometry')
		failures.push(`probe=${baseline.probe ?? 'missing'}`);
	if (baseline.phase !== 'before') failures.push(`phase=${baseline.phase ?? 'missing'}`);
	if (baseline.passed !== true) {
		const residue = classifyFailures(baseline.failures ?? []).gating;
		if (residue.length > 0) {
			failures.push(`before receipt has non-conditional failures: ${residue[0]}`);
		}
	}
	if (baseline.tolerancePx !== TOLERANCE_PX)
		failures.push(`tolerancePx=${baseline.tolerancePx ?? 'missing'}`);
	if (!sameJson(baseline.widths, WIDTHS)) failures.push('width matrix differs');
	if (
		!sameJson(
			baseline.locales,
			LOCALES.map(({ name }) => name),
		)
	)
		failures.push('locale matrix differs');
	if (!sameJson(baseline.parameters, parameters)) failures.push('parameters differ');
	if (!sameJson(baseline.registry, registry)) failures.push('selector/action registry differs');
	if (
		!sameJson(baseline.fixtures, {
			trip: FIXTURE_TRIP_ID,
			standDown: MISSING_TRIP_ID,
		})
	) {
		failures.push('fixture contract differs');
	}
	return failures;
}

const options = parseArgs(process.argv.slice(2));
const routeScenarios = scenarios(options);
const registry = registryFor(routeScenarios);
const parameters = {
	lineId: options.lineId,
	stopId: options.stopId,
	error500Path: options.error500Path,
};
const baselineReceipt = options.baselinePath
	? JSON.parse(readFileSync(options.baselinePath, 'utf8'))
	: null;
if (baselineReceipt) {
	const baselineFailures = validateBaseline(baselineReceipt, registry, parameters);
	if (baselineFailures.length > 0) {
		throw new Error(`Invalid before receipt:\n${baselineFailures.join('\n')}`);
	}
}
const matrix = [];
const failures = [];

const browser = await chromium.launch({ headless: true });
try {
	for (const width of WIDTHS) {
		for (const locale of LOCALES) {
			const cell = { width, locale: locale.name, scenarios: [] };
			for (const scenario of routeScenarios) {
				const context = await browser.newContext({
					viewport: { width, height: 1000 },
					colorScheme: 'dark',
					reducedMotion: 'reduce',
					serviceWorkers: 'block',
				});
				const page = await context.newPage();
				const url = localizedUrl(options.baseUrl, locale, scenario);
				let removeTripFixture = null;
				try {
					if (scenario.id.startsWith('trip-')) {
						removeTripFixture = await installTripFixture(page);
					}
					try {
						const result = await measureScenario(page, scenario, url, options.phase);
						await assertLocale(page, locale.name);
						cell.scenarios.push(result);
						for (const targetEntry of result.targets) {
							for (const measurement of targetEntry.measurements) {
								for (const failure of measurement.failures) {
									failures.push(
										`${width}px/${locale.name}/${scenario.id}/${targetEntry.id}` +
											`[${measurement.index}]: ${failure}`,
									);
								}
							}
						}
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						cell.scenarios.push({ id: scenario.id, url, error: message });
						failures.push(`${width}px/${locale.name}/${scenario.id}: ${message}`);
					}
				} finally {
					if (removeTripFixture) await removeTripFixture();
					await context.close();
				}
			}
			matrix.push(cell);
		}
	}
} finally {
	await browser.close();
}

const receipt = {
	probe: 'measure-sweep-geometry',
	baseUrl: options.baseUrl.href,
	phase: options.phase,
	generatedAt: new Date().toISOString(),
	tolerancePx: TOLERANCE_PX,
	widths: WIDTHS,
	locales: LOCALES.map(({ name }) => name),
	fixtures: { trip: FIXTURE_TRIP_ID, standDown: MISSING_TRIP_ID },
	runtimeStateContract: {
		deterministic: ['trip-populated', 'trip-stand-down'],
		requiredFromPreview: [
			'line and stop reliability',
			'status',
			'network',
			'receipt',
			'hotspots',
			'repeat-offenders',
		],
	},
	parameters,
	registry,
	passed: false,
	failures,
	matrix,
};

if (baselineReceipt) {
	const comparison = compareBaseline(receipt, baselineReceipt);
	receipt.baseline = {
		path: options.baselinePath,
		deltas: comparison.deltas,
	};
	failures.push(...comparison.failures);
}

const classified = classifyFailures(failures);
receipt.conditionalAbsences = classified.conditionalAbsences;
receipt.overflowObservations = classified.preexistingOverflowCandidates;
let gatingFailures = classified.gating;
if (options.phase === 'after' && baselineReceipt) {
	const baselineByKey = new Map();
	for (const failure of baselineReceipt.failures ?? []) {
		baselineByKey.set(failureKey(failure), failure);
	}
	for (const failure of classified.conditionalAbsences) {
		// Absent in AFTER but present in BEFORE = the migration broke a render.
		if (!baselineByKey.has(failureKey(failure))) gatingFailures.push(failure);
	}
	for (const failure of classified.preexistingOverflowCandidates) {
		const baselineFailure = baselineByKey.get(failureKey(failure));
		const beforePx = baselineFailure ? overflowPx(baselineFailure) : null;
		const afterPx = overflowPx(failure);
		// New overflow, or growth beyond baseline + tolerance, gates.
		if (beforePx === null || (afterPx ?? 0) > beforePx + TOLERANCE_PX) {
			gatingFailures.push(failure);
		}
	}
} else if (options.phase === 'after') {
	gatingFailures = failures;
}
receipt.gatingFailures = gatingFailures;

receipt.passed = gatingFailures.length === 0;
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
if (!receipt.passed) process.exitCode = 1;

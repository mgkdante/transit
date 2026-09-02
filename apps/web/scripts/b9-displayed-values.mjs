import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import {
	FIXTURES,
	MARK_KINDS,
	OBSERVATION_IDS,
	compareObservations,
	expectedDomainObservationsFromFixture,
	expectedScheduleTruth,
	normalizeObservation,
	runOracleSelfCheck,
} from './b9-display-oracle.mjs';

const args = new Set(process.argv.slice(2));
const WEB_ROOT = new URL('..', import.meta.url).pathname;
const OUTPUT = new URL('../.svelte-kit/output/server/index.js', import.meta.url).pathname;
const BUILD_ROOT = join(WEB_ROOT, '.svelte-kit/cloudflare');
const WRANGLER = join(WEB_ROOT, '../data-proxy/node_modules/.bin/wrangler');
const REPLAY_PREFIX = '/v1/stm/';
const CELLS = Object.freeze([
	{
		fixture: 'rich',
		locale: 'en',
		surface: 'line',
		path: '/lines/24?tab=reliability&from=2026-08-27&to=2026-08-29',
	},
	{ fixture: 'rich', locale: 'fr', surface: 'line', path: '/fr/lines/24?tab=reliability' },
	{ fixture: 'rich', locale: 'en', surface: 'stop', path: '/stop/52095?tab=reliability' },
	{ fixture: 'rich', locale: 'fr', surface: 'stop', path: '/fr/stop/52095?tab=reliability' },
	{
		fixture: 'rich',
		locale: 'en',
		surface: 'network',
		path: '/network?from=2026-08-27&to=2026-08-29',
	},
	{ fixture: 'rich', locale: 'fr', surface: 'network', path: '/fr/network' },
	{ fixture: 'sparse', locale: 'en', surface: 'line', path: '/lines/24?tab=reliability' },
	{ fixture: 'sparse', locale: 'en', surface: 'stop', path: '/stop/52095?tab=reliability' },
	{ fixture: 'sparse', locale: 'en', surface: 'network', path: '/network' },
]);

function invariant(condition, message) {
	if (!condition) throw new Error(`B9 runner invariant: ${message}`);
}

function transcriptDifference(left, right) {
	const fields = ['cell', 'actual', 'ssr', 'hydrated', 'ledger'];
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const first = left[index];
		const second = right[index];
		if (!first || !second) return `cell ${index}: one run omitted the cell`;
		for (const field of fields) {
			const firstValue = JSON.stringify(first[field]);
			const secondValue = JSON.stringify(second[field]);
			if (firstValue !== secondValue) {
				return `${first.cell} ${field}\nrun 1: ${firstValue}\nrun 2: ${secondValue}`;
			}
		}
	}
	return 'no differing field found';
}

const observation = (id, value) => ({ id, value });
const parseNumber = (value) => {
	if (value == null) return null;
	const match = String(value)
		.replaceAll('\u2212', '-')
		.replace(/(?<=\d)[ ,](?=\d{3}\b)/gu, '')
		.replace(',', '.')
		.match(/[+-]?\d+(?:\.\d+)?/u);
	return match ? Number(match[0]) : null;
};

async function readValues(
	page,
	selector,
	valueSelector,
	absenceSelector = '[data-slot="absent-value"]',
) {
	return page
		.locator(selector)
		.evaluateAll(
			(elements, options) =>
				elements.map((element) =>
					element.querySelector(options.absenceSelector)
						? null
						: (element.querySelector(options.valueSelector)?.textContent?.trim() ?? null),
				),
			{ valueSelector, absenceSelector },
		);
}

const labelMap = (value) =>
	Object.fromEntries(
		value.split('|').map((entry) => {
			const [label, key] = entry.split('=');
			return [label, /^\d$/u.test(key) ? Number(key) : key];
		}),
	);
const SEMANTIC_LABELS = Object.freeze({
	en: labelMap(
		'AM peak=am_peak|Midday=midday|PM peak=pm_peak|Evening=evening|Night=night|AM=am_peak|Mid=midday|PM=pm_peak|Eve=evening|Weekday=weekday|Weekend=weekend|Monday=1|Tuesday=2|Wednesday=3|Thursday=4|Friday=5|Saturday=6|Sunday=7|Mon=1|Tue=2|Wed=3|Thu=4|Fri=5|Sat=6|Sun=7|Empty=empty|Many seats=many_seats|Few seats=few_seats|Standing=standing|Full=full|Early=early|On-time=on_time|Late=late|Severe=severe|Unknown=unknown',
	),
	fr: labelMap(
		'Pointe AM=am_peak|Journée=midday|Pointe PM=pm_peak|Soirée=evening|Nuit=night|AM=am_peak|Jour=midday|PM=pm_peak|Soir=evening|Semaine=weekday|Fin de semaine=weekend|Lundi=1|Mardi=2|Mercredi=3|Jeudi=4|Vendredi=5|Samedi=6|Dimanche=7|Lun=1|Mar=2|Mer=3|Jeu=4|Ven=5|Sam=6|Dim=7|Vide=empty|Plusieurs places=many_seats|Peu de places=few_seats|Debout=standing|Plein=full|En avance=early|À l’heure=on_time|En retard=late|Sévère=severe|Inconnu=unknown',
	),
});

const tierMap = (labels) =>
	Object.fromEntries(labels.map((label, index) => [label, index === 0 ? null : index - 1]));
const HEATMAP_TIERS = Object.freeze({
	line: {
		en: tierMap(['No data', 'Rarely late', 'Sometimes late', 'Often late', '◆ Very unreliable']),
		fr: tierMap([
			'Aucune donnée',
			'Rarement en retard',
			'Parfois en retard',
			'Souvent en retard',
			'◆ Très peu fiable',
		]),
	},
	stop: {
		en: tierMap([
			'No data',
			'Rarely severe',
			'Sometimes severe',
			'Often severe',
			'◆ Very unreliable',
		]),
		fr: tierMap([
			'Aucune donnée',
			'Rarement grave',
			'Parfois grave',
			'Souvent grave',
			'◆ Très peu fiable',
		]),
	},
});

async function readTable(page, root) {
	return page
		.locator(`${root} table.sr-only tbody tr`)
		.evaluateAll((rows) =>
			rows.map((row) =>
				[...row.querySelectorAll('th,td')].map((cell) => cell.textContent?.trim() ?? ''),
			),
		);
}

async function readHeaders(page, root) {
	return page
		.locator(`${root} table.sr-only thead th`)
		.evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ''));
}

const displayCell = (text) => ({ value: parseNumber(text), text: normalizeObservation(text) });

async function readSemanticTable(page, root, locale) {
	const labels = SEMANTIC_LABELS[locale];
	return {
		headers: await readHeaders(page, root),
		rows: (await readTable(page, root)).map((row) => {
			const baseLabel = row[0].split(' · ')[0];
			return [labels[baseLabel] ?? row[0], ...row.slice(1).map(displayCell)];
		}),
	};
}

async function readHeatmapTiers(page, root, surface, locale) {
	const tiers = HEATMAP_TIERS[surface][locale];
	const rows = await readTable(page, root);
	return {
		headers: await readHeaders(page, root),
		rows: rows.map((row) =>
			row.slice(1).map((value) => {
				invariant(
					Object.hasOwn(tiers, value),
					`${surface} heatmap emitted unknown AT tier ${value}`,
				);
				return { tier: tiers[value], text: normalizeObservation(value) };
			}),
		),
	};
}

async function readRankedRows(page, root, locale) {
	const labels = SEMANTIC_LABELS[locale];
	const rows = await page.locator(`${root} .dv-ranked-row`).evaluateAll((elements) =>
		elements.map((element) => {
			const main = element.querySelector('.min-w-0');
			const heading = main?.firstElementChild;
			return {
				title: heading?.firstElementChild?.textContent?.trim() ?? '',
				display: heading?.children[1]?.textContent?.trim() ?? '',
				subtitle: main?.children[1]?.textContent?.trim() ?? '',
			};
		}),
	);
	return rows.map((row) => [
		labels[row.title] ?? row.title,
		{ value: parseNumber(row.display), text: normalizeObservation(row.display) },
		{
			values: [...row.subtitle.replaceAll('\u2212', '-').matchAll(/[+-]?\d+(?:[.,]\d+)?/gu)].map(
				(match) => Number(match[0].replace(',', '.')),
			),
			text: normalizeObservation(row.subtitle),
		},
	]);
}

const shareRows = (rows, locale) => ({
	headers: [],
	rows: rows.map((row) => [SEMANTIC_LABELS[locale][row[0]] ?? row[0], displayCell(row[1])]),
});

async function readShares(page, root, locale) {
	return shareRows(await readTable(page, root), locale);
}

async function readHistogram(page, root, multiplier = 1) {
	return {
		headers: await readHeaders(page, root),
		rows: (await readTable(page, root)).map((row) => {
			const values = [...row[0].replaceAll('\u2212', '-').matchAll(/-?\d+(?:[.,]\d+)?/gu)].map(
				(match) => Number(match[0].replace(',', '.')),
			);
			return {
				lo: row[0].includes('-∞') ? null : (values[0] ?? null) * multiplier,
				hi: row[0].includes('+∞') ? null : (values.at(-1) ?? null) * multiplier,
				count: parseNumber(row[1]),
				text: row.map(normalizeObservation),
			};
		}),
	};
}

async function readCompareRows(page, root, locale) {
	const labels = SEMANTIC_LABELS[locale];
	const rows = await page.locator(`${root} li`).evaluateAll((elements) =>
		elements.map((element) => ({
			label: element.querySelector('.compare-label')?.textContent?.trim() ?? '',
			value: element.querySelector('.compare-value')?.textContent?.trim() ?? '',
			state: element.getAttribute('data-prior'),
			delta: element.querySelector('[data-slot="delta-stat"]')?.getAttribute('aria-label') ?? '',
		})),
	);
	return rows.map((row) => ({
		key: labels[row.label] ?? row.label,
		value: displayCell(row.value),
		state: row.state,
		delta: normalizeObservation(row.delta),
	}));
}

async function readText(page, selector) {
	const value = await page
		.locator(selector)
		.allInnerTexts()
		.then((rows) => rows[0]);
	return value == null ? null : normalizeObservation(value);
}

async function readMetricValue(page, root) {
	const text = await readText(page, `${root} .metric-bullet__value`);
	return text == null ? { value: null, text: '' } : displayCell(text);
}

async function collectLine(page, cell) {
	const headlineText = await readValues(
		page,
		'[data-section="verdict"] [data-slot="verdict-kpis"] > [data-slot="metric-bullet"]',
		'.metric-bullet__value',
	);
	const headline = headlineText.map(parseNumber);
	const verdictText = await page
		.locator('[data-section="verdict"] [data-slot="verdict"]')
		.first()
		.innerText();
	const observedN =
		verdictText.match(/(?:of|de)\s+(\d+)\s+(?:tracked trips|trajets suivis)/iu)?.[1] ?? null;
	const runBulletText = async (slot) =>
		(await readValues(page, `[data-slot="${slot}"]`, '.metric-bullet__value'))[0] ?? null;
	const completenessValue = await runBulletText('service-completeness');
	const cancellationValue = await runBulletText('cancellations');
	const skippedValue = await runBulletText('skipped-stops');
	const completeness = parseNumber(completenessValue);
	const cancellation = parseNumber(cancellationValue);
	const skipped = parseNumber(skippedValue);
	const completenessText = await page
		.locator('[data-slot="service-completeness"] .metric-bullet__caption')
		.allInnerTexts();
	const counts = completenessText[0]?.match(/\d+(?:[ ,]\d{3})*/gu)?.map(parseNumber) ?? [];
	const serviceCaptions = {
		completeness: await readText(
			page,
			'[data-slot="service-completeness"] .metric-bullet__caption',
		),
		cancellation: await readText(page, '[data-slot="cancellations"] .metric-bullet__caption'),
		skipped: await readText(page, '[data-slot="skipped-stops"] .metric-bullet__caption'),
	};
	const span = page.locator('[data-sub="service-span"]');
	const spanMetrics = (
		await readValues(
			page,
			'[data-sub="service-span"] [data-slot="metric-display"]',
			'.metric-value',
		)
	).map(parseNumber);
	const spanTimeline = span.locator('[data-slot="service-span-timeline"]');
	const spanText = (await span.count()) > 0 ? await span.innerText() : '';
	const clocks = await spanTimeline.locator('.dv-span-end-clock').allTextContents();
	const spanDate = spanText.match(/\d{4}-\d{2}-\d{2}/u)?.[0] ?? null;
	const weak = page.locator('[data-slot="weak-stops"]');
	if ((await weak.count()) > 0) {
		const all = weak.getByRole('radio', { name: /^(?:All|Tous)$/u });
		if ((await all.count()) > 0) await all.click();
	}
	const weakNames = await page
		.locator('[data-slot="weak-stops-list"] table tbody th')
		.allTextContents();
	const weakValues = await page
		.locator('[data-slot="weak-stops-list"] table tbody td')
		.allTextContents();
	const weakHeaders = await page
		.locator('[data-slot="weak-stops-list"] table thead th')
		.allTextContents();
	const weakHrefs = await page
		.locator('[data-slot="weak-stops-list"] table tbody a')
		.evaluateAll((links) => links.map((link) => new URL(link.href).pathname));
	const weakHeading = (await weak.count()) > 0 ? await weak.innerText() : '';
	const rawCount = parseNumber(weakHeading.match(/[·]\s*\d+\/(\d+)/u)?.[1] ?? weakNames.length);
	const delayByCrowding = await readSemanticTable(
		page,
		'[data-slot="delay-by-crowding"]',
		cell.locale,
	);
	for (let depth = 0; depth < 2; depth += 1) {
		if ((await page.locator('[data-slot="severe-share"]').count()) > 0) break;
		const closed = page.locator('[data-section="verdict"] button[aria-expanded="false"]').first();
		if ((await closed.count()) > 0) await closed.click();
	}
	invariant(
		(await page.locator('[data-slot="severe-share"]').count()) > 0,
		`severe-share control missing: ${(await page.locator('main').innerText()).slice(0, 1500)}`,
	);
	const severeText = await page.locator('[data-slot="severe-share"] .block-value').innerText();
	const severe = parseNumber(severeText);
	const grain = page.locator('[data-slot="surface-rail"] [data-slot="grain-picker"]').first();
	const week = grain.getByRole('radio', {
		name: cell.locale === 'fr' ? 'Cette semaine' : 'This week',
	});
	let histogram = null;
	if ((await week.count()) > 0 && (await week.isEnabled())) {
		await week.click();
		histogram = await readHistogram(page, '[data-slot="histogram-mark"]', 60);
		await grain
			.getByRole('radio', {
				name: cell.path.includes('from=')
					? cell.locale === 'fr'
						? 'Plage de dates'
						: 'Date range'
					: cell.locale === 'fr'
						? "Aujourd'hui"
						: 'Today',
			})
			.click();
	}
	const trendRows = await readSemanticTable(page, '[data-slot="otp-trend"]', cell.locale);
	const habitsTiers = await readHeatmapTiers(
		page,
		'[data-slot="habits-heatmap"]',
		'line',
		cell.locale,
	);
	const habits = {
		table: habitsTiers,
		bestTime: await readText(page, '[data-slot="best-time-insight"]'),
	};
	const timeRows = {
		shift: await readSemanticTable(page, '[data-slot="shift-severe-strip"]', cell.locale),
		dayType: await readSemanticTable(page, '[data-slot="peak-day-type"]', cell.locale),
		onTime: await readCompareRows(page, '[data-slot="on-time-compare"]', cell.locale),
		crosstab: await readSemanticTable(page, '[data-slot="shift-daytype-crosstab"]', cell.locale),
		weekday: await readSemanticTable(page, '[data-slot="habits-weekday"]', cell.locale),
	};
	const headwayRows = {
		dumbbell: await readSemanticTable(page, '[data-slot="headway-dumbbell"]', cell.locale),
		excess: await readSemanticTable(
			page,
			'[data-slot="shift-regularity-charts"] [data-metric="excess"]',
			cell.locale,
		),
		cov: await readSemanticTable(
			page,
			'[data-slot="shift-regularity-charts"] [data-metric="cov"]',
			cell.locale,
		),
		bunched: await readSemanticTable(
			page,
			'[data-slot="shift-regularity-charts"] [data-metric="bunched"]',
			cell.locale,
		),
		compare: await readCompareRows(page, '[data-slot="wait-compare"]', cell.locale),
		headline: await readMetricValue(page, '[data-slot="excess-wait-headline"]'),
	};
	const dowGroups = await page.locator('[data-slot="crowding-dow-cell"]').evaluateAll((elements) =>
		elements.map((element) => ({
			iso: Number(element.getAttribute('data-iso')),
			rows: [...element.querySelectorAll('table.sr-only tbody tr')].map((row) =>
				[...row.querySelectorAll('th,td')].map((tableCell) => tableCell.textContent?.trim() ?? ''),
			),
		})),
	);
	const occupancyShares = {
		active: await readShares(page, '[data-slot="crowding-mix"]', cell.locale),
		weekday: await readShares(page, '[data-slot="crowding-weekday"]', cell.locale),
		weekend: await readShares(page, '[data-slot="crowding-weekend"]', cell.locale),
		byDow: dowGroups.map((group) => [group.iso, shareRows(group.rows, cell.locale)]),
		dominant: {
			label: await readText(page, '[data-slot="dominant-band"] .metric-bullet__label'),
			value: await readMetricValue(page, '[data-slot="dominant-band"]'),
		},
	};
	const scalars = {
		otp: {
			value: headline[0] ?? null,
			text: normalizeObservation(headlineText[0] ?? ''),
			unit: '%',
		},
		avg: {
			value: headline[1] ?? null,
			text: normalizeObservation(headlineText[1] ?? ''),
			unit: 'min',
		},
		p50: {
			value: headline[2] ?? null,
			text: normalizeObservation(headlineText[2] ?? ''),
			unit: 'min',
		},
		p90: {
			value: headline[3] ?? null,
			text: normalizeObservation(headlineText[3] ?? ''),
			unit: 'min',
		},
		severe: { value: severe, text: normalizeObservation(severeText), unit: '%' },
		completeness: {
			value: completeness,
			text: normalizeObservation(completenessValue ?? ''),
			unit: '%',
		},
		cancellation: {
			value: cancellation,
			text: normalizeObservation(cancellationValue ?? ''),
			unit: '%',
		},
		skipped: { value: skipped, text: normalizeObservation(skippedValue ?? ''), unit: '%' },
	};
	return [
		observation('line.day.otp_pct', headline[0] ?? null),
		observation('line.day.avg_delay_min', headline[1] ?? null),
		observation('line.day.p50_min', headline[2] ?? null),
		observation('line.day.p90_min', headline[3] ?? null),
		observation('line.day.severe_pct', severe),
		observation('line.day.observation_count', parseNumber(observedN)),
		observation('line.day.cancellation_pct', cancellation),
		observation('line.day.skipped_pct', skipped),
		observation('line.day.completeness_pct', completeness),
		observation('line.day.scheduled_counts', {
			scheduled: counts[1] ?? null,
			delivered: counts[0] ?? null,
			silent: counts[2] ?? null,
			captions: serviceCaptions,
			scalars,
		}),
		observation('line.service_span', {
			date: spanDate,
			first: clocks[0]?.trim() ?? null,
			last: clocks[1]?.trim() ?? null,
			minutes: spanMetrics[0] ?? null,
			firstDelay: spanMetrics[1] ?? null,
			lastDelay: spanMetrics[2] ?? null,
			trips: spanMetrics[3] ?? null,
		}),
		observation('line.weak_stops.eligible_ids', {
			headers: weakHeaders.map(normalizeObservation),
			rows: weakNames.map((name, index) => {
				const numbers = [
					...(weakValues[index] ?? '').replaceAll(',', '.').matchAll(/\d+(?:\.\d+)?/gu),
				].map((match) => Number(match[0]));
				return {
					name: name.trim(),
					value: numbers[0] ?? null,
					unit: (weakValues[index] ?? '').includes('%') ? '%' : null,
					ciLo: numbers.at(-2) ?? null,
					ciHi: numbers.at(-1) ?? null,
					text: normalizeObservation(weakValues[index] ?? ''),
				};
			}),
		}),
		observation('line.weak_stops.hrefs', weakHrefs),
		observation('line.weak_stops.raw_count', rawCount),
		observation(
			'line.pane.freshness_iso',
			await page
				.locator('[data-slot="article-header"] .header__meta time')
				.first()
				.getAttribute('datetime'),
		),
		observation('line.trend.rows', trendRows),
		observation('line.habits.tiers', habits),
		observation('line.time.rows', timeRows),
		observation('line.headway.rows', headwayRows),
		observation('line.occupancy.shares', occupancyShares),
		observation('line.delay_by_crowding', delayByCrowding),
		observation('line.week.histogram', histogram),
	];
}

async function collectStop(page) {
	const periodMetrics = await page
		.locator('[data-slot="stop-reliability-pane"] [data-slot="metric-display"]')
		.evaluateAll((elements) =>
			elements.map((element) => ({
				label: element.querySelector('.label-metric')?.textContent?.trim() ?? '',
				value: element.querySelector('[data-slot="absent-value"]')
					? null
					: (element.querySelector('.metric-value')?.textContent?.trim() ?? null),
			})),
		);
	const otpMetric = periodMetrics.find((metric) => /on-time|ponctualité/iu.test(metric.label));
	const verdictText = await page
		.locator('[data-slot="stop-reliability-sections"] [data-slot="verdict"]')
		.first()
		.innerText();
	const observedN =
		verdictText.match(/\bn=(\d+)/u)?.[1] ??
		verdictText.match(/(\d+)\s+(?:arrivals|passages)/iu)?.[1];
	const summaryText = await readValues(
		page,
		'[data-slot="stop-reliability-summary"] [data-slot="metric-display"]',
		'.metric-value',
	);
	const summary = summaryText.map(parseNumber);
	const percentileText = await readValues(
		page,
		'[data-slot="stop-percentiles"] [data-slot="metric-display"]',
		'.metric-value',
	);
	const percentiles = percentileText.map(parseNumber);
	const rangeText = await readValues(
		page,
		'[data-slot="daily-range-verdict"] [data-slot="metric-display"]',
		'.metric-value',
	);
	const rangeValues = rangeText.map(parseNumber);
	const dailyRows = await readSemanticTable(page, '[data-slot="daily-trend-chart"]', 'en');
	const routeRows = await page.locator('[data-slot="stop-by-route"] a').evaluateAll((links) =>
		links.map((link) => ({
			id: new URL(link.href).pathname.split('/').at(-1),
			display:
				[...link.querySelectorAll('span')]
					.find(
						(span) =>
							span.classList.contains('shrink-0') && span.classList.contains('tabular-nums'),
					)
					?.textContent?.trim() ?? null,
		})),
	);
	const rankedRoutes = routeRows.map((row) => [row.id, parseNumber(row.display)]);
	const habitsTiers = await readHeatmapTiers(
		page,
		'[data-slot="stop-habits"]',
		'stop',
		await page.locator('html').getAttribute('lang'),
	);
	const locale = await page.locator('html').getAttribute('lang');
	const weekdayRows = (await readRankedRows(page, '[data-slot="stop-weekday"]', locale)).map(
		(row) => [row[0], row[1], row[2] ?? null],
	);
	const allTimeRows = await readRankedRows(page, '[data-slot="stop-time-of-day"]', locale);
	const stopCrowding = {
		table: await readShares(page, '[data-slot="stop-crowding"]', locale),
		dominant: {
			label: await readText(page, '[data-slot="stop-crowding"] .label-metric'),
			value: {
				value: parseNumber(await readText(page, '[data-slot="stop-crowding"] .metric-value')),
				text: (await readText(page, '[data-slot="stop-crowding"] .metric-value')) ?? '',
			},
			sublabel: await readText(page, '[data-slot="stop-crowding"] .font-mono.text-caption'),
		},
	};
	const stopScalars = {
		otp: {
			value: parseNumber(otpMetric?.value),
			text: normalizeObservation(otpMetric?.value ?? ''),
		},
		summary: summary.map((value, index) => ({
			value,
			text: normalizeObservation(summaryText[index] ?? ''),
		})),
		percentiles: percentiles.map((value, index) => ({
			value,
			text: normalizeObservation(percentileText[index] ?? ''),
		})),
		range: rangeValues.map((value, index) => ({
			value,
			text: normalizeObservation(rangeText[index] ?? ''),
		})),
	};
	return [
		observation('stop.day.otp_pct', parseNumber(otpMetric?.value)),
		observation('stop.day.avg_delay_min', summary[1] ?? null),
		observation('stop.day.p50_min', percentiles[0] ?? null),
		observation('stop.day.p90_min', percentiles[1] ?? null),
		observation('stop.day.severe_pct', summary[0] ?? null),
		observation('stop.day.observation_count', parseNumber(observedN)),
		observation('stop.daily.rows', dailyRows),
		observation('stop.range.severe_pct', rangeValues[0] ?? null),
		observation('stop.range.observations', rangeValues[2] ?? null),
		observation(
			'stop.range.below_min_n',
			(await page.locator('[data-slot="below-min-n"]').count()) > 0,
		),
		observation('stop.routes.ranked', rankedRoutes),
		observation('stop.habits.tiers', habitsTiers),
		observation('stop.weekday.rows', weekdayRows),
		observation('stop.time.rows', {
			shift: allTimeRows.filter((row) =>
				['am_peak', 'midday', 'pm_peak', 'evening', 'night'].includes(row[0]),
			),
			dayType: allTimeRows.filter((row) => ['weekday', 'weekend'].includes(row[0])),
		}),
		observation('stop.occupancy.shares', stopCrowding),
		observation('stop.display.scalars', stopScalars),
		observation(
			'stop.pane.freshness_iso',
			await page
				.locator('[data-slot="article-header"] .header__meta time')
				.first()
				.getAttribute('datetime'),
		),
	];
}

async function verifyScheduleTruth(page, fixture, actual, cell) {
	if (new URL(cell.path, 'http://b9.local').searchParams.has('from')) return;
	const truth = expectedScheduleTruth(fixture);
	if (!truth.hasData || truth.hasSchedule) return;
	const text = normalizeObservation(await page.locator('main').innerText());
	invariant(text.includes(truth.date), `schedule=false candidate ${truth.date} is not displayed`);
	invariant(
		!/(?:latest closed day|dernier jour clos)/iu.test(text),
		`schedule=false ${truth.date} received a closed-day label`,
	);
	const values = new Map(actual.map((row) => [row.id, row.value]));
	invariant(
		values.get('line.day.completeness_pct') == null,
		`schedule=false ${truth.date} fabricated completeness`,
	);
	const scheduled = values.get('line.day.scheduled_counts') ?? {};
	invariant(
		[scheduled.scheduled, scheduled.delivered, scheduled.silent].every((value) => value == null),
		`schedule=false ${truth.date} fabricated scheduled-service counts`,
	);
}

async function collectNetwork(page, locale) {
	const headlineText = await readValues(
		page,
		'[data-network-section="network-live-headline"] [data-slot="metric-display"]',
		'.metric-value',
	);
	const headline = headlineText.map(parseNumber);
	const reportingText = await readValues(
		page,
		'[data-slot="reporting-section"] [data-slot="metric-display"]',
		'.metric-value',
	);
	const reporting = reportingText.map(parseNumber);
	const statusShares = await readShares(
		page,
		'[data-network-section="network-status-mix"]',
		locale,
	);
	const occupancyShares = await readShares(
		page,
		'[data-network-section="network-occupancy-mix"]',
		locale,
	);
	const histogram = await readHistogram(page, '[data-network-section="network-delay-histogram"]');
	const completenessText =
		(
			await readValues(
				page,
				'[data-slot="completeness-section"] [data-slot="metric-display"]',
				'.metric-value',
			)
		)[0] ?? null;
	const completeness = parseNumber(completenessText);
	const delta = parseNumber(
		await page
			.locator('[data-slot="verdict-delta"]')
			.allInnerTexts()
			.then((v) => v[0]),
	);
	const shiftRows = await readRankedRows(page, '[data-slot="network-shift"]', locale);
	const dayTypeRows = await readRankedRows(
		page,
		'[data-network-section="network-weekday-weekend"]',
		locale,
	);
	const silentRoutes = await page.locator('[data-slot="silent-link"]').evaluateAll((links) =>
		links.map((link) => ({
			route: decodeURIComponent(new URL(link.href).pathname.split('/').at(-1) ?? ''),
			href: new URL(link.href).pathname,
			display:
				link.querySelector('.dv-ranked-row .tabular-nums.text-foreground')?.textContent?.trim() ??
				'',
		})),
	);
	const trendRows = await readSemanticTable(
		page,
		'[data-slot="network-history-trend-row"] figure[data-slot="trend-mark"]',
		locale,
	);
	const vehicleRows = await readSemanticTable(page, '[data-slot="vehicles-reporting-row"]', locale);
	const cancellationRows = await readSemanticTable(
		page,
		'[data-slot="network-history-cancellations-row"]',
		locale,
	);
	const occupancyGroups = await page
		.locator('[data-slot="occupancy-trend"] li')
		.evaluateAll((items) =>
			items.map((item) =>
				[...item.querySelectorAll('table.sr-only tbody tr')].map((row) =>
					[...row.querySelectorAll('th,td')].map((cell) => cell.textContent?.trim() ?? ''),
				),
			),
		);
	const freshness = page.locator('[data-slot="freshness-stamp"][data-variant="live"]').first();
	const conformance = page.locator('[data-slot="conformance-badge"]').first();
	const networkMeta = {
		freshness: (await freshness.count())
			? {
					label: await readText(
						page,
						'[data-slot="freshness-stamp"][data-variant="live"] .freshness-stamp-label',
					),
					age: await readText(
						page,
						'[data-slot="freshness-stamp"][data-variant="live"] .freshness-stamp-age',
					),
					datetime: await freshness.locator('time').getAttribute('datetime'),
					seconds: parseNumber(await freshness.getAttribute('data-age-seconds')),
				}
			: null,
		feed: (await page.locator('[data-slot="feed-age"]').count())
			? {
					label: await readText(page, '[data-slot="feed-age"] .network-feed-age-label'),
					value: await readText(page, '[data-slot="feed-age"] .network-feed-age-value'),
					aria: await page.locator('[data-slot="feed-age"]').getAttribute('aria-label'),
				}
			: null,
		conformance: (await conformance.count())
			? {
					verdict: await conformance.getAttribute('data-verdict'),
					label: await readText(page, '[data-slot="conformance-badge"] .conformance-badge-label'),
					detail: await readText(page, '[data-slot="conformance-badge"] .conformance-badge-detail'),
					title: await conformance.getAttribute('title'),
				}
			: null,
		scalars: {
			headline: headline.map((value, index) => ({
				value,
				text: normalizeObservation(headlineText[index] ?? ''),
				unit: index < 2 ? '%' : 'min',
			})),
			reporting: reporting.map((value, index) => ({
				value,
				text: normalizeObservation(reportingText[index] ?? ''),
				unit: 'count',
			})),
			completeness: {
				value: completeness,
				text: normalizeObservation(completenessText ?? ''),
				unit: '%',
			},
		},
	};
	const latestCancellation = await readText(
		page,
		'[data-network-section="network-cancellations"] [data-slot="metric-display"] .metric-value',
	);
	return [
		observation('network.live.vehicles', reporting[0] ?? null),
		observation('network.live.on_time_pct', headline[0] ?? null),
		observation('network.live.coverage_pct', headline[1] ?? null),
		observation('network.live.p50_min', headline[2] ?? null),
		observation('network.live.p90_min', headline[3] ?? null),
		observation('network.live.non_responding', reporting[1] ?? null),
		observation('network.live.status_shares', { table: statusShares, meta: networkMeta }),
		observation('network.live.occupancy_shares', occupancyShares),
		observation('network.live.histogram', histogram),
		observation(
			'network.live.silent_routes',
			silentRoutes.map((row) => [row.route, parseNumber(row.display), row.href]),
		),
		observation('network.verdict.delta_pct', delta),
		observation('network.latest.completeness_pct', completeness),
		observation('network.trend.rows', trendRows),
		observation('network.vehicles.rows', vehicleRows),
		observation('network.cancellations.rows', {
			table: cancellationRows,
			latest:
				latestCancellation == null ? { value: null, text: '' } : displayCell(latestCancellation),
		}),
		observation(
			'network.occupancy.rows',
			occupancyGroups.map((rows) => shareRows(rows, locale)),
		),
		observation('network.shift.rows', shiftRows),
		observation('network.daytype.rows', dayTypeRows),
	];
}

function verifyLedger(cell, fixture, ledger) {
	const labelPath = `labels/${cell.locale}.json`;
	const historyStatus = fixture.not_found.includes('historic/history/index.json') ? 404 : 200;
	const expected = {
		line: [
			['ssr', 'manifest.json', 200, 2],
			['ssr', 'static/routes/24.json', 200, 1],
			['ssr', 'historic/route_reliability/24.json', 200, 1],
			['ssr', labelPath, 200, 1],
			['browser', 'historic/history/index.json', historyStatus, 1],
			['browser', 'provenance.json', 200, 1],
			['browser', 'live/vehicles.json', 200, 1],
			['browser', 'live/trips.json', 200, 1],
			['browser', 'live/alerts.json', 200, 1],
			['browser', 'live/network.json', 200, 1],
		],
		stop: [
			['ssr', 'manifest.json', 200, 2],
			['ssr', 'static/stops/52095.json', 200, 1],
			['ssr', labelPath, 200, 1],
			['browser', 'historic/history/index.json', historyStatus, 1],
			['browser', 'historic/stop_reliability/52095.json', 200, 1],
			['browser', 'live/stop_departures.json', 200, 1],
			['browser', 'live/alerts.json', 200, 1],
			['browser', 'live/network.json', 200, 1],
		],
		network: [
			['ssr', 'manifest.json', 200, 2],
			['ssr', 'live/network.json', 200, 1],
			['ssr', 'historic/network_trend.json', 200, 1],
			['ssr', 'provenance.json', 200, 1],
			['ssr', labelPath, 200, 1],
			['browser', 'historic/history/index.json', historyStatus, 1],
			['browser', 'live/network.json', 200, 1],
		],
	}[cell.surface];
	const range = new URL(cell.path, 'http://b9.local');
	const selectedRefs = (index) => {
		const from = range.searchParams.get('from');
		const to = range.searchParams.get('to');
		return from && to
			? (index?.partitions ?? []).filter(
					(ref) => ref.coverage_start <= to && ref.coverage_end >= from,
				)
			: [];
	};
	if (cell.surface === 'network' && historyStatus === 200) {
		const root = fixture.files['historic/history/index.json'];
		const networkPath = root.families?.find((family) => family.family === 'network')?.index_path;
		if (networkPath) expected.push(['browser', networkPath, 200, 1]);
		for (const ref of selectedRefs(fixture.files[networkPath]))
			expected.push(['browser', ref.path, 200, 1]);
	}
	if ((cell.surface === 'line' || cell.surface === 'stop') && historyStatus === 200) {
		const root = fixture.files['historic/history/index.json'];
		const family = cell.surface === 'line' ? 'lines' : 'stops';
		const directoryPath = root.families?.find((entry) => entry.family === family)?.index_path;
		if (directoryPath) {
			expected.push(['browser', directoryPath, 200, 1]);
			const entityId = cell.surface === 'line' ? '24' : '52095';
			const entityPath = fixture.files[directoryPath]?.entities?.find(
				(entry) => entry.entity_id === entityId,
			)?.index_path;
			if (entityPath) {
				expected.push(['browser', entityPath, 200, 1]);
				const refs = selectedRefs(fixture.files[entityPath]);
				if (cell.surface === 'line' && cell.fixture === 'rich' && refs.length === 0)
					refs.push(...(fixture.files[entityPath]?.partitions ?? []).slice(-1));
				for (const ref of refs)
					expected.push([
						'browser',
						ref.path,
						200,
						cell.surface === 'line' && cell.fixture !== 'live' && range.searchParams.has('from')
							? 2
							: 1,
					]);
			}
		}
	}
	const counts = new Map();
	for (const entry of ledger) {
		invariant(entry.method === 'GET', `${cell.path} unexpected ${entry.method} ${entry.path}`);
		const key = `${entry.lane}|${entry.path}|${entry.status}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	const actual = [...counts].sort();
	const wanted = expected
		.map(([lane, path, status, count]) => [`${lane}|${path}|${status}`, count])
		.sort();
	invariant(
		JSON.stringify(actual) === JSON.stringify(wanted),
		`${cell.path} request ledger mismatch\nexpected ${JSON.stringify(wanted)}\nactual ${JSON.stringify(actual)}`,
	);
}

function verifySsr(cell, fixture, html) {
	const mainHtml = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/iu)?.[0] ?? '';
	invariant(mainHtml !== '', `${cell.path} SSR omitted main`);
	const normalized = ssrText(mainHtml);
	if (cell.surface === 'line') {
		const route = fixture.files['static/routes/24.json'];
		invariant(normalized.includes(route.long), `${cell.path} SSR omitted line identity`);
		invariant(
			!mainHtml.includes('data-slot="verdict"') && !mainHtml.includes('data-section="verdict"'),
			`${cell.path} SSR eagerly rendered lazy reliability content`,
		);
	} else if (cell.surface === 'stop') {
		const stop = fixture.files['static/stops/52095.json'];
		invariant(normalized.includes(stop.name), `${cell.path} SSR omitted stop identity`);
		invariant(
			!mainHtml.includes('data-slot="stop-reliability-sections"') && !normalized.includes('16.1%'),
			`${cell.path} SSR rendered browser-only stop reliability`,
		);
	} else {
		const network = fixture.files['live/network.json'];
		invariant(
			normalized.includes(cell.locale === 'fr' ? 'RÉSEAU' : 'NETWORK'),
			`${cell.path} SSR omitted network identity`,
		);
		if (network.on_time_pct != null)
			invariant(
				normalized.includes(`${network.on_time_pct}%`),
				`${cell.path} SSR omitted live on-time value`,
			);
	}
}

function ssrText(html) {
	return normalizeObservation(
		(html.match(/<main\b[^>]*>[\s\S]*?<\/main>/iu)?.[0] ?? html)
			.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, ' ')
			.replace(/<!--[\s\S]*?-->/gu, ' ')
			.replace(/<[^>]+>/gu, ' ')
			.replaceAll('&nbsp;', ' ')
			.replaceAll('&amp;', '&'),
	);
}

async function verifyAccessibility(page, cell) {
	invariant((await page.locator('main').isVisible()) === true, `${cell.path} main is not visible`);
	invariant(
		(await page.locator('html').getAttribute('lang')) === cell.locale,
		`${cell.path} wrong document language`,
	);
	const unlabeled = await page
		.locator('figure[data-slot$="-mark"], figure[data-slot="service-span-timeline"]')
		.evaluateAll(
			(figures) =>
				figures.filter((figure) => !(figure.getAttribute('aria-label') ?? '').trim()).length,
		);
	invariant(unlabeled === 0, `${cell.path} has ${unlabeled} unlabeled chart figures`);
	const emptyCaptions = await page
		.locator('figure[data-slot] table.sr-only')
		.evaluateAll(
			(tables) =>
				tables.filter((table) => !(table.querySelector('caption')?.textContent ?? '').trim())
					.length,
		);
	invariant(
		emptyCaptions === 0,
		`${cell.path} has ${emptyCaptions} charts without accessible text`,
	);
}

async function verifyAccessibleMirrors(page, cell) {
	const invalid = await page.locator('figure[data-slot$="-mark"]').evaluateAll((figures) =>
		figures.flatMap((figure) => {
			if (figure.getAttribute('data-slot') === 'bullet-mark') return [];
			const table = figure.querySelector('table.sr-only');
			const rows = [...(table?.querySelectorAll('tbody tr') ?? [])];
			return table?.querySelector('caption')?.textContent?.trim() &&
				rows.some((row) =>
					[...row.querySelectorAll('th,td')].some((item) => item.textContent?.trim()),
				)
				? []
				: [figure.getAttribute('data-slot')];
		}),
	);
	invariant(invalid.length === 0, `${cell.path} invalid AT mirrors: ${invalid.join(', ')}`);
}

const NETWORK_TERMINAL_SELECTOR =
	'#net-historic [data-slot="network-history-board"], #net-historic [data-slot="edge-state"]:not([data-variant="skeleton"])';

function latestDatedRow(rows) {
	return rows
		.filter((row) => /^\d{4}-\d{2}-\d{2}$/u.test(row?.date ?? ''))
		.sort((left, right) => left.date.localeCompare(right.date))
		.at(-1);
}

function expectedSurfaceState(cell, fixture) {
	if (cell.fixture === 'live') {
		const representativeDate = new URL(cell.path, 'http://b9.local').searchParams.get('to');
		invariant(representativeDate != null, `${cell.path} live range omitted its terminal date`);
		return { representativeDate, terminalSelector: null };
	}
	const rows = {
		line: fixture.files['historic/route_reliability/24.json']?.periods?.filter(
			(row) => row.grain === 'day',
		),
		stop: fixture.files['historic/stop_reliability/52095.json']?.daily,
		network: fixture.files['historic/network_trend.json']?.series,
	}[cell.surface];
	const latest = latestDatedRow(rows ?? []);
	const terminalSelector =
		cell.surface === 'network' && !(latest?.observation_count > 0)
			? NETWORK_TERMINAL_SELECTOR
			: null;
	return { representativeDate: terminalSelector ? null : (latest?.date ?? null), terminalSelector };
}

async function verifyTextSemantics(page, cell, fixture) {
	const text = normalizeObservation(await page.locator('main').innerText());
	const { representativeDate, terminalSelector } = expectedSurfaceState(cell, fixture);
	if (representativeDate)
		invariant(
			text.includes(representativeDate),
			`${cell.path} omitted the representative date ${representativeDate}`,
		);
	else
		invariant(
			terminalSelector && (await page.locator(terminalSelector).count()) > 0,
			`${cell.path} omitted its terminal state`,
		);
	if (cell.fixture !== 'rich') return;
	if (cell.surface === 'line') {
		if (!cell.path.includes('from=')) {
			invariant(/[−-]1[.,]5 min/u.test(text), `${cell.path} lost the signed minute value`);
			invariant(
				text.includes(cell.locale === 'fr' ? '77 voyages' : '77 trips'),
				`${cell.path} lost the localized plural`,
			);
		}
	}
}

async function verifyControls(page, cell) {
	if (cell.fixture !== 'rich') return;
	if (cell.surface === 'line') {
		const weak = page.locator('[data-slot="weak-stops"]');
		for (const [name, count] of [
			[/^5$/u, 5],
			[/^10$/u, 10],
			[/^(?:All|Tous)$/u, 15],
		]) {
			await page.evaluate((phase) => (window.__b9Phase = phase), `weak-${count}`);
			await weak.getByRole('radio', { name }).click();
			invariant(
				(await weak.locator('table tbody tr').count()) === count,
				`${cell.path} weak-stop ${name} did not truncate to ${count}`,
			);
		}
		const grain = page.locator('[data-slot="surface-rail"] [data-slot="grain-picker"]').first();
		await page.evaluate(() => (window.__b9Phase = 'week'));
		await grain
			.getByRole('radio', { name: cell.locale === 'fr' ? 'Cette semaine' : 'This week' })
			.click();
		await page.locator('[data-slot="histogram-mark"]').waitFor({ state: 'attached' });
		await page.evaluate(() => (window.__b9Phase = 'range'));
		await grain
			.getByRole('radio', { name: cell.locale === 'fr' ? 'Plage de dates' : 'Date range' })
			.click();
		const dates = page.locator(
			'[data-slot="surface-rail"] [data-slot="date-range"] input[type="date"]',
		);
		invariant((await dates.count()) === 2, `${cell.path} date-range controls did not mount`);
		await dates.nth(0).fill('2026-08-28');
		await dates.nth(1).fill('2026-08-29');
		const rangeKpis = await readValues(
			page,
			'[data-section="verdict"] [data-slot="verdict-kpis"] > [data-slot="metric-bullet"]',
			'.metric-bullet__value',
		);
		invariant(
			rangeKpis[2] == null && rangeKpis[3] == null,
			`${cell.path} multi-day percentiles did not stand down`,
		);
		await grain
			.getByRole('radio', { name: cell.locale === 'fr' ? "Aujourd'hui" : 'Today' })
			.click();
	} else if (cell.surface === 'stop') {
		const grain = page.locator('[data-slot="surface-rail"] [data-slot="grain-picker"]').first();
		await grain.getByRole('radio', { name: cell.locale === 'fr' ? 'Semaine' : 'Week' }).click();
		invariant(
			(await page.locator('[data-slot="stop-percentiles"]').count()) === 0,
			`${cell.path} week percentiles did not stand down`,
		);
		await grain.getByRole('radio', { name: cell.locale === 'fr' ? 'Jour' : 'Day' }).click();
		await page.locator('[data-slot="stop-percentiles"]').waitFor({ state: 'attached' });
	}
}

const MARK_SELECTORS = Object.freeze({
	trend: ['[data-slot="trend-mark"]', '.dv-trendmark-otp, .dv-trendmark-retard'],
	histogram: ['[data-slot="histogram-mark"]', 'rect.dv-histmark-bar'],
	'dot-strip': ['[data-slot="dot-strip-mark"]', 'circle[class*="dv-stripmark-"]'],
	'magnitude-bars': ['[data-slot="magnitude-bars-mark"]', 'rect[class*="dv-barmark-"]'],
	dumbbell: ['[data-slot="dumbbell-mark"]', 'rect.dv-dumbbell-conn'],
	line: ['[data-slot="line-mark"]', '.dv-line-spline'],
	sparkline: ['[data-slot="sparkline-mark"]', '.dv-sparkline-spline'],
	bullet: ['[data-slot="bullet-mark"]', 'rect[class*="dv-bullet--"]'],
	heatmap: ['[data-slot="heatmap-mark"]', 'rect.dv-heatmap-cell'],
	'stacked-share': ['[data-slot="stacked-share-mark"]', 'rect.dv-share-seg'],
	'service-span': ['[data-slot="service-span-timeline"]', 'rect.dv-span-bar'],
});

const MARK_SIGNATURES = Object.freeze({
	trend: {
		domain: [
			[0, 100],
			[0, 8],
		],
		unit: ['%', 'min'],
		axis: ['On-time', '0', '20', '40', '60', '80', '100', 'Avg delay', '0', '2', '4', '6', '8'],
	},
	histogram: {
		domain: [-300, 1800],
		unit: 's',
		axis: ['Delay (min)', '-5', '-1', '0', '1', '5', '10', '30'],
	},
	'dot-strip': {
		domain: [0, 100],
		unit: '%',
		axis: [
			'Severe delay by time of day (%)',
			'0',
			'20',
			'40',
			'60',
			'80',
			'100',
			'AM peak',
			'PM peak',
		],
	},
	'magnitude-bars': {
		domain: [0, 100],
		unit: '%',
		axis: ['Severe-delay share', '0', '20', '40', '60', '80', '100', 'Weekday', 'Weekend'],
	},
	dumbbell: {
		domain: [0, 35],
		unit: 'min',
		axis: [
			'Headway (min)',
			'0',
			'5',
			'10',
			'15',
			'20',
			'25',
			'30',
			'35',
			'AM peak',
			'Midday',
			'PM peak',
		],
	},
	line: {
		domain: [0, 100],
		unit: '%',
		axis: [
			'Shift',
			'AM',
			'Mid',
			'PM',
			'Eve',
			'Night',
			'On-time',
			'0',
			'20',
			'40',
			'60',
			'80',
			'100',
		],
	},
	sparkline: { domain: [4, 8], unit: 'count', axis: [] },
	bullet: { domain: [0, 100], unit: '%', axis: ['On-time', '0', '100'] },
	heatmap: {
		domain: [0, 1],
		unit: 'relative',
		axis: [
			'Mon',
			'Tue',
			'Wed',
			'Thu',
			'Fri',
			'Sat',
			'Sun',
			'Hour of day',
			'00:00',
			'03:00',
			'06:00',
			'09:00',
			'12:00',
			'15:00',
			'18:00',
			'21:00',
			'◆',
			'◆',
			'◆',
		],
	},
	'stacked-share': { domain: [0, 100], unit: '%', axis: [] },
	'service-span': {
		domain: [0, 1800],
		unit: 'min',
		axis: ['00h', '06h', '12h', '18h', '24h', '30h'],
	},
});

async function verifyGeometry(page, seen) {
	for (const [kind, [rootSelector, markSelector]] of Object.entries(MARK_SELECTORS)) {
		if (seen.has(kind) || (await page.locator(rootSelector).count()) === 0) continue;
		const root = page.locator(rootSelector).first();
		await root.scrollIntoViewIfNeeded();
		const frame = root.locator('[data-slot="chart-frame"]').first();
		if ((await frame.count()) > 0) await frame.scrollIntoViewIfNeeded();
		await page.waitForTimeout(400);
		const mark = root.locator(markSelector).first();
		invariant((await mark.count()) > 0, `${kind} representative mark did not render`);
		const box = await mark.boundingBox();
		invariant(
			box && box.width > 0 && box.height > 0,
			`${kind} representative mark has zero geometry`,
		);
		const signature = MARK_SIGNATURES[kind];
		const axis = (await root.locator('svg text').allTextContents())
			.map((value) => value.trim())
			.filter((value) => kind !== 'trend' || !/^[A-Z][a-z]{2} \d{1,2}$/u.test(value));
		invariant(
			JSON.stringify(axis) === JSON.stringify(signature.axis),
			`${kind} domain/unit signature drift: ${JSON.stringify(axis)}`,
		);
		if (kind === 'stacked-share') {
			const frameBox = await frame.boundingBox();
			const widths = await root
				.locator('rect.dv-share-seg')
				.evaluateAll((rects) => rects.map((rect) => rect.getBoundingClientRect().width));
			invariant(
				frameBox && widths.reduce((sum, width) => sum + width, 0) / frameBox.width > 0.95,
				'stacked-share no longer spans its 0-100 domain',
			);
		}
		if (kind === 'sparkline') {
			const frameBox = await root.boundingBox();
			invariant(
				frameBox && box.height / frameBox.height > 0.25,
				'sparkline no longer uses its [4,8] representative domain',
			);
		}
		seen.set(kind, { domain: signature.domain, unit: signature.unit });
	}
	if ((await page.locator('[data-slot="histogram-mark"]').count()) > 0) {
		const figure = page.locator('[data-slot="histogram-mark"]').first();
		const counts = await figure
			.locator('table tbody tr')
			.evaluateAll((rows) =>
				rows.flatMap((row) =>
					(row.querySelector('th')?.textContent ?? '').includes('∞')
						? []
						: [Number(row.querySelector('td')?.textContent ?? Number.NaN)],
				),
			);
		const boxes = (
			await figure.locator('rect.dv-histmark-bar').evaluateAll((rects) =>
				rects.map((rect) => {
					const box = rect.getBoundingClientRect();
					return { x: box.x, width: box.width, height: box.height };
				}),
			)
		).sort((a, b) => a.x - b.x);
		invariant(
			boxes.length === counts.length && boxes.length > 2,
			`histogram bin geometry/count mismatch (${boxes.length} bars, ${counts.length} rows)`,
		);
		const ratios = boxes.map((box, index) => (box.width * box.height) / counts[index]);
		const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
		invariant(
			Math.max(...ratios.map((value) => Math.abs(value - mean) / mean)) < 0.08,
			'histogram is not bin-width x density geometry',
		);
		invariant(
			new Set(boxes.map((box) => Math.round(box.width))).size > 1,
			'histogram collapsed true bin widths',
		);
	}
	if ((await page.locator('[data-slot="service-span-timeline"]').count()) > 0) {
		const clocks = await page
			.locator('[data-slot="service-span-timeline"] .dv-span-end-clock')
			.allTextContents();
		invariant(
			clocks[0] === '05:00' && clocks[1] === '01:30',
			'service-span representative does not cross midnight',
		);
	}
	if ((await page.locator('[data-slot="weak-stops"] [data-slot="ci-whisker"]').count()) > 0) {
		const whisker = page.locator('[data-slot="weak-stops"] [data-slot="ci-whisker"]').first();
		invariant(
			(await whisker.locator('line').count()) === 3,
			'magnitude CI whisker is not a line plus two caps',
		);
	}
}

async function freePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	invariant(address && typeof address === 'object', 'could not reserve a loopback port');
	const port = address.port;
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return port;
}

function jsonHeaders(fixture) {
	return {
		'Access-Control-Expose-Headers': 'Date, Age',
		'Access-Control-Allow-Origin': '*',
		'Cache-Control': 'no-store',
		'Content-Type': 'application/json; charset=utf-8',
		Date: new Date(fixture.frozen_utc).toUTCString(),
		Age: '0',
	};
}

async function startReplay(fixtures = FIXTURES, initialKey = Object.keys(fixtures)[0]) {
	const state = { active: initialKey, ledger: [], outbound: [] };
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		const relative = url.pathname.startsWith(REPLAY_PREFIX)
			? decodeURIComponent(url.pathname.slice(REPLAY_PREFIX.length))
			: null;
		const fixture = fixtures[state.active];
		const found = relative == null ? null : fixture.files[relative];
		const declaredMissing = relative != null && fixture.not_found.includes(relative);
		const status = found ? 200 : declaredMissing ? 404 : 599;
		state.ledger.push({
			lane: 'ssr',
			method: request.method,
			path: relative ?? url.pathname,
			status,
		});
		response.writeHead(status === 599 ? 404 : status, jsonHeaders(fixture));
		const capturedBody = fixture.raw_files?.[relative];
		response.end(
			typeof capturedBody === 'string'
				? capturedBody
				: JSON.stringify(
						found ?? { error: declaredMissing ? 'not found' : 'unknown fixture path' },
					),
		);
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	invariant(address && typeof address === 'object', 'replay did not bind');
	return {
		base: `http://127.0.0.1:${address.port}/v1`,
		origin: `http://127.0.0.1:${address.port}`,
		fixtures,
		state,
		close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
	};
}

function runChild(command, commandArgs, options) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, commandArgs, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		child.stdout.on('data', (chunk) => (output += chunk));
		child.stderr.on('data', (chunk) => (output += chunk));
		child.once('error', reject);
		child.once('exit', (code) => {
			if (code === 0) resolve(output);
			else reject(new Error(`B9 ${options.label} exited ${code}\n${output}`));
		});
	});
}

async function ensureBuild() {
	if (process.env.B9_REUSE_BUILD === '1') {
		invariant(existsSync(OUTPUT), 'B9_REUSE_BUILD=1 without built output');
		return false;
	}
	await runChild('bun', ['run', 'build'], { cwd: WEB_ROOT, label: 'build' });
	invariant(existsSync(OUTPUT), 'build completed without server output');
	return true;
}

async function startPreview(replayBase) {
	const port = await freePort();
	const output = [];
	const stateDir = mkdtempSync(join(tmpdir(), 'transit-b9-miniflare-'));
	const configPath = join(stateDir, 'wrangler.toml');
	writeFileSync(configPath, 'name = "transit-b9-preview"\n');
	const version = await runChild(WRANGLER, ['--version'], {
		cwd: WEB_ROOT,
		label: 'wrangler version',
	});
	invariant(/4\.115\.0/u.test(version), `unexpected wrangler version ${version.trim()}`);
	const child = spawn(
		WRANGLER,
		[
			'dev',
			join(WEB_ROOT, '.svelte-kit/cloudflare/_worker.js'),
			'--config',
			configPath,
			'--assets',
			join(WEB_ROOT, '.svelte-kit/cloudflare'),
			'--local',
			'--persist-to',
			stateDir,
			'--ip',
			'127.0.0.1',
			'--port',
			String(port),
			'--compatibility-date',
			'2025-01-01',
			'--compatibility-flag',
			'nodejs_compat',
			'--var',
			`PUBLIC_V1_BASE:${replayBase}`,
			'--var',
			'PUBLIC_V1_PROVIDER:stm',
			'--log-level',
			'error',
			'--show-interactive-dev-session=false',
		],
		{
			cwd: WEB_ROOT,
			env: process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	let childError = null;
	child.once('error', (error) => (childError = error));
	child.stdout.on('data', (chunk) => output.push(String(chunk)));
	child.stderr.on('data', (chunk) => output.push(String(chunk)));
	const origin = `http://127.0.0.1:${port}`;
	for (let attempt = 0; attempt < 80; attempt += 1) {
		if (childError) {
			rmSync(stateDir, { recursive: true, force: true });
			throw childError;
		}
		if (child.exitCode != null) {
			rmSync(configPath, { force: true });
			rmSync(stateDir, { recursive: true, force: true });
			throw new Error(`B9 preview stopped\n${output.join('')}`);
		}
		try {
			const response = await fetch(origin, { redirect: 'manual' });
			if (response.status > 0) return { child, origin, output, configPath, stateDir };
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	child.kill('SIGTERM');
	rmSync(configPath, { force: true });
	rmSync(stateDir, { recursive: true, force: true });
	throw new Error(`B9 preview did not become ready\n${output.join('')}`);
}

async function stopPreview(preview) {
	if (preview.child.exitCode == null) {
		preview.child.kill('SIGTERM');
		await Promise.race([
			new Promise((resolve) => preview.child.once('exit', resolve)),
			new Promise((resolve) => setTimeout(resolve, 2_000)),
		]);
		if (preview.child.exitCode == null) preview.child.kill('SIGKILL');
	}
	rmSync(preview.configPath, { force: true });
	rmSync(preview.stateDir, { recursive: true, force: true });
}

function freezeClockScript(iso) {
	return `(() => {
		const NativeDate = Date;
		const frozen = NativeDate.parse(${JSON.stringify(iso)});
		class FrozenDate extends NativeDate {
			constructor(...values) { super(...(values.length ? values : [frozen])); }
			static now() { return frozen; }
		}
		FrozenDate.parse = NativeDate.parse;
		FrozenDate.UTC = NativeDate.UTC;
		Object.defineProperty(window, 'Date', { value: FrozenDate });
	})();`;
}

function svgGuardScript() {
	return `(() => {
		const attrs = ${JSON.stringify(['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'transform', 'points'])};
		const bad = /(?:NaN|Infinity)/;
		window.__b9SvgViolations = [];
		const setAttribute = Element.prototype.setAttribute;
		Element.prototype.setAttribute = function(name, value) {
			if (this.namespaceURI === 'http://www.w3.org/2000/svg' && attrs.includes(name) && bad.test(String(value)))
				window.__b9SvgViolations.push({ phase: window.__b9Phase, attr: name, value: String(value), root: this.closest('figure')?.getAttribute('data-slot'), html: this.outerHTML.slice(0, 500), stack: new Error().stack });
			return setAttribute.call(this, name, value);
		};
		const check = (node) => {
			if (!(node instanceof Element) || node.namespaceURI !== 'http://www.w3.org/2000/svg') return;
			for (const attr of attrs) if (bad.test(node.getAttribute(attr) ?? ''))
				window.__b9SvgViolations.push({ attr, value: node.getAttribute(attr), html: node.outerHTML.slice(0, 500) });
		};
		new MutationObserver((records) => records.forEach((record) => {
			check(record.target); record.addedNodes.forEach((node) => { check(node); node.querySelectorAll?.('svg *').forEach(check); });
		})).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: attrs });
	})();`;
}

function builtAssetPaths() {
	return new Set(
		readdirSync(BUILD_ROOT, { recursive: true })
			.map(String)
			.filter((path) => statSync(join(BUILD_ROOT, path)).isFile())
			.map((path) => `/${path}`),
	);
}

async function installNetworkBoundary(context, pageOrigin, replay, cell) {
	const assets = builtAssetPaths();
	const document = new URL(cell.path, pageOrigin);
	await context.route('**/*', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (!['http:', 'https:'].includes(url.protocol)) {
			await route.continue();
			return;
		}
		if (url.origin === pageOrigin) {
			const exactDocument =
				request.isNavigationRequest() &&
				url.pathname === document.pathname &&
				url.search === document.search;
			if (exactDocument || assets.has(decodeURIComponent(url.pathname))) {
				await route.continue();
				return;
			}
			replay.state.outbound.push(`same-origin:${request.method()}:${url.pathname}${url.search}`);
			await route.abort('blockedbyclient');
			return;
		}
		if (url.origin === replay.origin && url.pathname.startsWith(REPLAY_PREFIX)) {
			const fixture = replay.fixtures[replay.state.active];
			const relative = decodeURIComponent(url.pathname.slice(REPLAY_PREFIX.length));
			const found = fixture.files[relative];
			const declaredMissing = fixture.not_found.includes(relative);
			const status = found ? 200 : declaredMissing ? 404 : 599;
			replay.state.ledger.push({
				lane: 'browser',
				method: request.method(),
				path: relative,
				status,
			});
			await route.fulfill({
				status: status === 599 ? 404 : status,
				headers: jsonHeaders(fixture),
				body:
					fixture.raw_files?.[relative] ??
					JSON.stringify(
						found ?? { error: declaredMissing ? 'not found' : 'unknown fixture path' },
					),
			});
			return;
		}
		replay.state.outbound.push(request.url());
		await route.abort('blockedbyclient');
	});
}

async function settleSurface(page, cell, fixture) {
	const selector = {
		line: '[data-section="verdict"]',
		stop: '[data-slot="stop-reliability-sections"]',
		network: '[data-network-section="network-live-headline"]',
	}[cell.surface];
	await page.locator(selector).waitFor({ state: 'attached', timeout: 30_000 });
	const expected = expectedSurfaceState(cell, fixture);
	const needsRichNetwork = cell.fixture === 'rich' && cell.surface === 'network';
	const expectedNetworkFreshnessSeconds =
		cell.surface === 'network'
			? Math.max(
					0,
					Math.round(
						(Date.parse(fixture.frozen_utc) -
							Date.parse(fixture.files['live/network.json'].generated_utc)) /
							1000,
					),
				)
			: null;
	await page.waitForFunction(
		({ representativeDate, terminalSelector, needsNetworkDetails, networkFreshnessSeconds }) => {
			const main = document.querySelector('main');
			if (!main || main.querySelector('[data-slot="edge-state"][data-variant="skeleton"]')) {
				return false;
			}
			if (representativeDate && !main.textContent?.includes(representativeDate)) return false;
			if (terminalSelector && !main.querySelector(terminalSelector)) return false;
			if (
				networkFreshnessSeconds != null &&
				!main.querySelector(
					`[data-slot="freshness-stamp"][data-variant="live"][data-age-seconds="${networkFreshnessSeconds}"]`,
				)
			)
				return false;
			if (
				needsNetworkDetails &&
				[
					'[data-slot="completeness-section"]:not(:has([data-slot="absent-value"]))',
					'[data-slot="verdict-delta"]',
					'[data-slot="network-shift"]',
					'[data-network-section="network-weekday-weekend"]',
				].some((required) => !main.querySelector(required))
			) {
				return false;
			}
			return true;
		},
		{
			...expected,
			needsNetworkDetails: needsRichNetwork,
			networkFreshnessSeconds: expectedNetworkFreshnessSeconds,
		},
		{ timeout: 30_000 },
	);
	await page.evaluate(() => document.fonts.ready);
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
}

async function runGate({ fixtures = FIXTURES, cells = CELLS, runs = 2, synthetic = true } = {}) {
	const selfCheck = runRunnerSelfCheck();
	const built = await ensureBuild();
	const replay = await startReplay(fixtures, cells[0]?.fixture);
	const displayFailures = new Map();
	const geometrySeen = new Map();
	const transcripts = [];
	let observationCount = 0;
	let requestCount = 0;
	let preview;
	let browser;
	try {
		const bundled = chromium.executablePath();
		const executablePath = existsSync(bundled)
			? bundled
			: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(
					existsSync,
				);
		browser = await chromium.launch({ headless: true, executablePath });
		for (let run = 0; run < runs; run += 1) {
			preview = await startPreview(replay.base);
			const transcript = [];
			for (const cell of cells) {
				replay.state.active = cell.fixture;
				replay.state.ledger = [];
				replay.state.outbound = [];
				const fixture = fixtures[cell.fixture];
				const context = await browser.newContext({
					bypassCSP: true,
					locale: cell.locale === 'fr' ? 'fr-CA' : 'en-CA',
					serviceWorkers: 'block',
					viewport: { width: 1440, height: 1000 },
				});
				await context.addInitScript({ content: freezeClockScript(fixture.frozen_utc) });
				await context.addInitScript({ content: svgGuardScript() });
				await installNetworkBoundary(context, preview.origin, replay, cell);
				const page = await context.newPage();
				const errors = [];
				page.on('pageerror', (error) => errors.push(String(error)));
				page.on('console', (message) => {
					if (message.type() === 'error')
						errors.push(`${message.text()} @ ${JSON.stringify(message.location())}`);
				});
				const response = await page.goto(`${preview.origin}${cell.path}`, {
					waitUntil: 'domcontentloaded',
					timeout: 15_000,
				});
				invariant(response?.ok(), `${cell.path} returned ${response?.status()}`);
				const ssrHtml = await response.text();
				await settleSurface(page, cell, fixture);
				verifySsr(cell, fixture, ssrHtml);
				await verifyAccessibility(page, cell);
				await verifyTextSemantics(page, cell, fixture);
				let actual;
				try {
					actual =
						cell.surface === 'line'
							? await collectLine(page, cell)
							: cell.surface === 'stop'
								? await collectStop(page)
								: await collectNetwork(page, cell.locale);
				} catch (error) {
					throw new Error(
						`${String(error)}\nbrowser errors ${JSON.stringify(errors)}\nreplay ledger ${JSON.stringify(replay.state.ledger)}`,
						{ cause: error },
					);
				}
				const initialHydrated = normalizeObservation(await page.locator('main').innerText());
				await verifyAccessibleMirrors(page, cell);
				observationCount += actual.length;
				try {
					invariant(
						JSON.stringify(actual.map((row) => row.id)) ===
							JSON.stringify(OBSERVATION_IDS[cell.surface]),
						`${cell.surface} collector observation contract changed`,
					);
					compareObservations(
						expectedDomainObservationsFromFixture(fixture, cell.surface, cell.locale, cell.path),
						actual,
						`${cell.fixture}/${cell.locale}/${cell.surface}`,
					);
				} catch (error) {
					displayFailures.set(`${cell.fixture}/${cell.locale}/${cell.surface}`, String(error));
				}
				if (cell.surface === 'line') {
					try {
						await verifyScheduleTruth(page, fixture, actual, cell);
					} catch (error) {
						const key = `${cell.fixture}/${cell.locale}/${cell.surface}`;
						displayFailures.set(
							key,
							[displayFailures.get(key), String(error)].filter(Boolean).join('\n'),
						);
					}
				}
				if (run === 0 && cell.fixture === 'rich' && cell.locale === 'en') {
					await verifyGeometry(page, geometrySeen);
				}
				await verifyControls(page, cell);
				const expected404 = replay.state.ledger.some((entry) => entry.status === 404);
				const svgViolations = await page.evaluate(() => window.__b9SvgViolations ?? []);
				const geometryErrors = errors.filter((error) =>
					/(?:NaN|Infinity).*(?:svg|attribute)|attribute.*(?:NaN|Infinity)/iu.test(error),
				);
				if (geometryErrors.length > 0 || svgViolations.length > 0) {
					const key = `${cell.fixture}/${cell.locale}/${cell.surface}`;
					const message = `non-finite SVG geometry: ${JSON.stringify(svgViolations[0]) ?? geometryErrors[0]}`;
					displayFailures.set(key, [displayFailures.get(key), message].filter(Boolean).join('\n'));
				}
				const unexpectedErrors = errors.filter(
					(error) =>
						!geometryErrors.includes(error) &&
						!(expected404 && /Failed to load resource:.*404 \(Not Found\)/u.test(error)),
				);
				invariant(
					unexpectedErrors.length === 0,
					`${cell.path} browser errors: ${unexpectedErrors.join(' | ')}`,
				);
				invariant(
					replay.state.outbound.length === 0,
					`${cell.path} outbound: ${replay.state.outbound}`,
				);
				invariant(
					replay.state.ledger.some(
						(entry) => entry.lane === 'ssr' && entry.path === 'manifest.json',
					),
					`${cell.path} preview ignored runtime PUBLIC_V1_BASE`,
				);
				invariant(
					replay.state.ledger.every((entry) => entry.status !== 599),
					`${cell.path} unknown replay request: ${JSON.stringify(replay.state.ledger)}`,
				);
				verifyLedger(cell, fixture, replay.state.ledger);
				requestCount += replay.state.ledger.length;
				transcript.push({
					cell: `${cell.fixture}/${cell.locale}/${cell.surface}`,
					actual,
					ssr: ssrText(ssrHtml),
					hydrated: initialHydrated,
					ledger: replay.state.ledger
						.map((entry) => `${entry.lane}|${entry.path}|${entry.status}`)
						.sort(),
				});
				await context.close();
			}
			transcripts.push(transcript);
			await stopPreview(preview);
			preview = undefined;
		}
		if (synthetic) {
			const identical = JSON.stringify(transcripts[0]) === JSON.stringify(transcripts[1]);
			invariant(
				identical,
				`two normalized synthetic runs were not identical\n${transcriptDifference(transcripts[0], transcripts[1])}`,
			);
			invariant(
				JSON.stringify([...geometrySeen.keys()].sort()) === JSON.stringify([...MARK_KINDS].sort()),
				`mark branch coverage mismatch: ${JSON.stringify([...geometrySeen.keys()].sort())}`,
			);
		}
		if (displayFailures.size > 0) {
			const evidence = {
				cells: cells.length,
				runs,
				observations: observationCount,
				requests: requestCount,
				marks: geometrySeen.size,
				...selfCheck,
			};
			throw new Error(
				`B9 displayed-value gate RED ${JSON.stringify(evidence)}\n${[...displayFailures].map(([cell, error]) => `\n[${cell}]\n${error}`).join('\n')}`,
			);
		}
		return {
			built,
			cells: cells.length,
			runs,
			observations: observationCount,
			requests: requestCount,
			marks: geometrySeen.size,
			...selfCheck,
		};
	} finally {
		await browser?.close();
		if (preview) await stopPreview(preview);
		await replay.close();
	}
}

function manifestGeneration(manifest) {
	return JSON.stringify({
		provider: manifest.provider,
		dataset: manifest.dataset_version,
		publish: manifest.publish_generation_id,
		tiers: Object.fromEntries(
			['live', 'static', 'historic'].map((tier) => [
				tier,
				[
					'generated_utc',
					'dataset_version',
					'publish_generation_id',
					'collection_generation_id',
				].map((field) => manifest.files?.[tier]?.[field] ?? null),
			]),
		),
	});
}

function manifestClosure(manifest) {
	const files = manifest.files;
	const paths = [
		manifest.labels?.en,
		`${files?.static?.routes_prefix}24.json`,
		`${files?.static?.stops_prefix}52095.json`,
		files?.live?.vehicles,
		files?.live?.trips,
		files?.live?.stop_departures,
		files?.live?.alerts,
		files?.live?.network,
		`${files?.historic?.route_reliability_prefix}24.json`,
		`${files?.historic?.stop_reliability_prefix}52095.json`,
		files?.historic?.network_trend,
		files?.historic?.provenance,
		files?.historic?.receipts_index,
		'historic/history/index.json',
	];
	invariant(
		paths.every((path) => typeof path === 'string' && !path.includes('undefined')),
		'live manifest lacks a required three-page path',
	);
	return [...new Set(paths)];
}

let liveFetchSequence = 0;
async function fetchLiveJson(base, path) {
	liveFetchSequence += 1;
	const response = await fetch(`${base}/${path}?b9_capture=${Date.now()}-${liveFetchSequence}`, {
		headers: { 'Cache-Control': 'no-cache' },
		signal: AbortSignal.timeout(12_000),
	});
	if (response.status === 404 && path === 'historic/history/index.json')
		return { path, status: 404 };
	invariant(response.ok, `live capture ${path} returned ${response.status}`);
	const raw = await response.text();
	return { path, status: response.status, raw, value: JSON.parse(raw) };
}

async function captureLive(tempDir) {
	const publicBase = (process.env.B9_LIVE_BASE ?? 'https://data.yesid.dev/v1').replace(/\/$/u, '');
	const base = `${publicBase}/stm`;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const firstRow = await fetchLiveJson(base, 'manifest.json');
		const first = firstRow.value;
		const captured = await Promise.all(
			manifestClosure(first).map((path) => fetchLiveJson(base, path)),
		);
		const byPath = new Map(captured.map((row) => [row.path, row]));
		const captureOnce = async (path) => {
			if (!path || byPath.has(path)) return byPath.get(path);
			const row = await fetchLiveJson(base, path);
			captured.push(row);
			byPath.set(path, row);
			return row;
		};
		const root = byPath.get('historic/history/index.json')?.value;
		const selections = {};
		for (const edge of root?.families ?? []) {
			if (!['network', 'lines', 'stops'].includes(edge.family)) continue;
			const familyIndex = await captureOnce(edge.index_path);
			invariant(
				familyIndex?.value?.collection_generation_id === edge.collection_generation_id,
				`live ${edge.family} root identity mismatch`,
			);
			let collection = familyIndex;
			if (edge.family !== 'network') {
				const entityId = edge.family === 'lines' ? '24' : '52095';
				const entity = familyIndex?.value?.entities?.find((entry) => entry.entity_id === entityId);
				collection = await captureOnce(entity?.index_path);
				invariant(
					collection?.value?.collection_generation_id === entity?.collection_generation_id,
					`live ${edge.family}/${entityId} collection identity mismatch`,
				);
			}
			const ref = collection?.value?.partitions?.at(-1);
			invariant(
				ref?.path && ref.coverage_start && ref.coverage_end,
				`live ${edge.family} has no finite partition`,
			);
			const partition = await captureOnce(ref.path);
			invariant(
				partition?.value?.collection_generation_id == null ||
					partition.value.collection_generation_id === collection.value.collection_generation_id,
				`live ${edge.family} partition identity mismatch`,
			);
			selections[edge.family] = { from: ref.coverage_start, to: ref.coverage_end };
		}
		const last = (await fetchLiveJson(base, 'manifest.json')).value;
		if (manifestGeneration(first) !== manifestGeneration(last)) continue;
		const files = first.files;
		const tierByPath = new Map([
			[first.labels?.en, 'static'],
			[`${files.static.routes_prefix}24.json`, 'static'],
			[`${files.static.stops_prefix}52095.json`, 'static'],
			[files.live.vehicles, 'live'],
			[files.live.trips, 'live'],
			[files.live.stop_departures, 'live'],
			[files.live.alerts, 'live'],
			[files.live.network, 'live'],
			[`${files.historic.route_reliability_prefix}24.json`, 'historic'],
			[`${files.historic.stop_reliability_prefix}52095.json`, 'historic'],
			[files.historic.network_trend, 'historic'],
			[files.historic.provenance, 'historic'],
			[files.historic.receipts_index, 'historic'],
		]);
		let tierDrift = false;
		for (const row of captured)
			if (row.value?.publish_generation_id != null && tierByPath.has(row.path)) {
				const tier = tierByPath.get(row.path);
				const generatedUtc = files[tier]?.generated_utc;
				if (row.value.publish_generation_id !== `${first.provider}@${generatedUtc}`) {
					tierDrift = true;
					break;
				}
			}
		if (tierDrift) continue;
		const fixture = {
			name: 'live',
			frozen_utc: first.files.live.generated_utc,
			files: Object.fromEntries([
				['manifest.json', first],
				...captured.filter((row) => row.status === 200).map((row) => [row.path, row.value]),
			]),
			raw_files: Object.fromEntries([
				['manifest.json', firstRow.raw],
				...captured.filter((row) => row.status === 200).map((row) => [row.path, row.raw]),
			]),
			not_found: captured.filter((row) => row.status === 404).map((row) => row.path),
			selections,
		};
		writeFileSync(join(tempDir, 'capture.json'), JSON.stringify(fixture));
		return fixture;
	}
	throw new Error('B9 live capture drifted across both bounded attempts');
}

async function runLive() {
	const tempDir = mkdtempSync(join(tmpdir(), 'transit-b9-live-'));
	try {
		const fixture = await captureLive(tempDir);
		const cells = ['line', 'stop', 'network'].map((surface) => {
			const { from, to } =
				fixture.selections[surface === 'line' ? 'lines' : surface === 'stop' ? 'stops' : 'network'];
			const prefix =
				surface === 'line'
					? '/lines/24?tab=reliability&'
					: surface === 'stop'
						? '/stop/52095?tab=reliability&'
						: '/network?';
			return { fixture: 'live', locale: 'en', surface, path: `${prefix}from=${from}&to=${to}` };
		});
		return await runGate({ fixtures: { live: fixture }, cells, runs: 1, synthetic: false });
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function runReadyDateSelfCheck() {
	const cell = {
		fixture: 'live',
		locale: 'en',
		surface: 'line',
		path: '/lines/24?tab=reliability&from=2026-09-01&to=2026-09-02',
	};
	const state = expectedSurfaceState(cell, { files: {} });
	invariant(
		state.representativeDate === '2026-09-02',
		`live readiness expected ${JSON.stringify(state.representativeDate)} instead of 2026-09-02`,
	);
	invariant(!JSON.stringify(state).includes('2026-08-29'), 'live readiness retained August 29');
	return { representativeDate: state.representativeDate };
}

function runRunnerSelfCheck() {
	return { ...runOracleSelfCheck(), ...runReadyDateSelfCheck() };
}

const result = args.has('--self-check')
	? runRunnerSelfCheck()
	: args.has('--live')
		? await runLive()
		: await runGate();
console.log(`B9 displayed-value gate PASS ${JSON.stringify(result)}`);

import rich from './__fixtures__/b9/rich.json' with { type: 'json' };
import sparse from './__fixtures__/b9/sparse.json' with { type: 'json' };

export const FIXTURES = Object.freeze({ rich, sparse });
export const SURFACES = Object.freeze(['line', 'stop', 'network']);
export const MARK_KINDS = Object.freeze(
	'trend histogram dot-strip magnitude-bars dumbbell line sparkline bullet heatmap stacked-share service-span'.split(
		' ',
	),
);

const CLOCK_NORMALIZATION_ALLOWLIST = Object.freeze([
	{
		id: 'frozen-freshness-now',
		pattern: /\b(?:just now|à l'instant)\b/gu,
		replacement: '<fresh-now>',
	},
	{
		id: 'ephemeral-loopback-port',
		pattern: /http:\/\/127\.0\.0\.1:\d+/gu,
		replacement: 'http://127.0.0.1:<port>',
	},
	{
		id: 'ssr-relative-freshness-minute',
		pattern: /\b(?:\d+ minutes? ago|il y a \d+ minutes?)\b/giu,
		replacement: '<fresh-minutes>',
	},
]);

function invariant(condition, message) {
	if (!condition) throw new Error(`B9 oracle invariant: ${message}`);
}

export function normalizeObservation(value) {
	let normalized = String(value)
		.replace(/[\t\n\r ]+/gu, ' ')
		.trim();
	for (const rule of CLOCK_NORMALIZATION_ALLOWLIST) {
		normalized = normalized.replace(rule.pattern, rule.replacement);
	}
	return normalized;
}

function stable(value) {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, stable(value[key])]),
		);
	}
	return value;
}

export function compareObservations(expected, actual, label = 'observations') {
	const toMap = (rows, side) => {
		const out = new Map();
		for (const row of rows) {
			invariant(row && typeof row.id === 'string' && row.id !== '', `${label} ${side} id`);
			invariant(!out.has(row.id), `${label} duplicate ${side} observation ${row.id}`);
			out.set(row.id, stable(row.value));
		}
		return out;
	};
	const want = toMap(expected, 'expected');
	const got = toMap(actual, 'actual');
	const missing = [...want.keys()].filter((key) => !got.has(key));
	const extra = [...got.keys()].filter((key) => !want.has(key));
	const wrong = [...want.keys()].flatMap((key) => {
		if (!got.has(key)) return [];
		const left = JSON.stringify(want.get(key));
		const right = JSON.stringify(got.get(key));
		return left === right ? [] : [`${key}: expected ${left}, got ${right}`];
	});
	if (missing.length || extra.length || wrong.length) {
		throw new Error(
			`B9 ${label} mismatch` +
				(missing.length ? `\nmissing: ${missing.join(', ')}` : '') +
				(extra.length ? `\nextra: ${extra.join(', ')}` : '') +
				(wrong.length ? `\nwrong:\n${wrong.join('\n')}` : ''),
		);
	}
	return { observations: want.size };
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round = (value, digits = 1) => {
	const factor = 10 ** digits;
	return Math.round((value + Number.EPSILON) * factor) / factor;
};
const pct = (numerator, denominator, digits = 1) =>
	numerator != null && denominator > 0 ? round((100 * numerator) / denominator, digits) : null;
const verdictCount = (otp, n, onTime) => {
	if (!(n > 0)) return null;
	if (n < 30) return n;
	const successes = onTime ?? Math.round((otp / 100) * n);
	const z2 = 1.959963984540054 ** 2;
	const center = (successes / n + z2 / (2 * n)) / (1 + z2 / n);
	const margin =
		(1.959963984540054 *
			Math.sqrt(((successes / n) * (1 - successes / n)) / n + z2 / (4 * n * n))) /
		(1 + z2 / n);
	const band = (value) => (value >= 80 ? 2 : value >= 60 ? 1 : 0);
	return margin * 2 >= 0.3 ||
		band(Math.round(100 * (center - margin))) !== band(Math.round(100 * (center + margin)))
		? n
		: null;
};
const latestDated = (rows) =>
	rows
		.filter((row) => typeof row.date === 'string')
		.slice()
		.sort((a, b) => a.date.localeCompare(b.date))
		.at(-1) ?? null;
const montrealClock = (iso) =>
	typeof iso === 'string'
		? new Intl.DateTimeFormat('en-CA', {
				timeZone: 'America/Toronto',
				hour: '2-digit',
				minute: '2-digit',
				hourCycle: 'h23',
			}).format(new Date(iso))
		: null;
const observation = (id, value) => ({ id, value });
const OCCUPANCY = Object.freeze(['empty', 'many_seats', 'few_seats', 'standing', 'full']);
const STATUS = Object.freeze(['early', 'on_time', 'late', 'severe', 'unknown']);
const SHIFTS = Object.freeze(['am_peak', 'midday', 'pm_peak', 'evening', 'night']);
const DAY_TYPES = Object.freeze(['weekday', 'weekend']);

const TABLE_COPY = Object.freeze({
	en: {
		x: 'x',
		group: 'group',
		row: 'row',
		day: 'Day of week',
		shift: 'Shift',
		dayType: 'Day type',
		weekday: 'Weekday',
		weekend: 'Weekend',
		otp: 'On-time',
		avg: 'Avg delay',
		avgStop: 'Average delay',
		severe: 'Severe-delay share',
		scheduled: 'Scheduled gap',
		observed: 'Observed gap',
		excess: 'Excess wait',
		cov: 'Spread (CoV)',
		bunched: 'Clumped (bunched)',
		bin: 'bin (min)',
		trips: 'trips',
		crowdingBand: 'Crowding band',
		networkOtp: 'On-time %',
		networkDelay: 'Slowest 10% (min)',
		canceled: '% canceled trip-days',
	},
	fr: {
		x: 'axe x',
		group: 'groupe',
		row: 'ligne',
		day: 'Jour de la semaine',
		shift: 'Période',
		dayType: 'Type de jour',
		weekday: 'Semaine',
		weekend: 'Fin de semaine',
		otp: 'Ponctualité',
		avg: 'Retard moyen',
		avgStop: 'Retard moyen',
		severe: 'Part des retards graves',
		scheduled: 'Intervalle prévu',
		observed: 'Intervalle observé',
		excess: 'Attente excédentaire',
		cov: 'Régularité (CV)',
		bunched: 'Bus collés',
		bin: 'intervalle (min)',
		trips: 'voyages',
		crowdingBand: "Niveau d'occupation",
		networkOtp: 'Ponctualité %',
		networkDelay: '10 % les plus lents (min)',
		canceled: '% de jours-voyages annulés',
	},
});

const TIER_TEXT = Object.freeze({
	line: {
		en: ['Rarely late', 'Sometimes late', 'Often late', '◆ Very unreliable'],
		fr: ['Rarement en retard', 'Parfois en retard', 'Souvent en retard', '◆ Très peu fiable'],
	},
	stop: {
		en: ['Rarely severe', 'Sometimes severe', 'Often severe', '◆ Very unreliable'],
		fr: ['Rarement grave', 'Parfois grave', 'Souvent grave', '◆ Très peu fiable'],
	},
});

const noDataText = (locale) => (locale === 'fr' ? 'Aucune donnée' : 'No data');
const cell = (value, suffix = '', absent = '') => ({
	value,
	text: value == null ? absent : `${value}${suffix}`,
});
const table = (headers, rows, suffixes = [], absent = '') => ({
	headers: rows.length ? headers : [],
	rows: rows.map(([key, ...values]) => [
		key,
		...values.map((value, index) => cell(value, suffixes[index] ?? '', absent)),
	]),
});
const shareTable = (rows) => table([], rows, ['%']);
const heatmapTable = (tiers, surface, locale) => ({
	headers: tiers.length
		? [
				TABLE_COPY[locale].day,
				...Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`),
			]
		: [],
	rows: tiers.map((row) =>
		row.map((tier) => ({
			tier,
			text: tier == null ? noDataText(locale) : TIER_TEXT[surface][locale][tier],
		})),
	),
});

function histogramTable(rows, locale, seconds = false) {
	const rangeTo = locale === 'fr' ? 'à' : 'to';
	const fmt = (value) =>
		new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { maximumFractionDigits: 1 }).format(
			seconds ? value / 60 : value,
		);
	return {
		headers: rows?.length ? [TABLE_COPY[locale].bin, TABLE_COPY[locale].trips] : [],
		rows: (rows ?? []).map((row) => {
			const lo = finite(row.lo ?? row.lo_sec ?? row.lo_min ?? row[0]);
			const hi = finite(row.hi ?? row.hi_sec ?? row.hi_min ?? row[1]);
			const count = finite(row.count ?? row[2]);
			return {
				lo,
				hi,
				count,
				text: [
					`${lo == null ? '-∞' : fmt(lo)} ${rangeTo} ${hi == null ? '+∞' : fmt(hi)} min`,
					`${count}`,
				],
			};
		}),
	};
}

const FULL_WEEKDAYS = Object.freeze({
	en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
	fr: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
});
const OCCUPANCY_LABELS = Object.freeze({
	en: {
		empty: 'Empty',
		many_seats: 'Many seats',
		few_seats: 'Few seats',
		standing: 'Standing',
		full: 'Full',
	},
	fr: {
		empty: 'Vide',
		many_seats: 'Plusieurs places',
		few_seats: 'Peu de places',
		standing: 'Debout',
		full: 'Plein',
	},
});
const PRIOR_COPY = Object.freeze({
	en: {
		onTime: 'on-time',
		wait: 'wait',
		prior: 'vs prior day',
		noise: 'within noise',
		none: 'no prior day',
		pts: 'pts',
		pt: 'pt',
	},
	fr: {
		onTime: 'ponctualité',
		wait: 'attente',
		prior: 'p/r à la veille',
		noise: 'écart non significatif',
		none: 'pas de veille',
		pts: 'pts',
		pt: 'pt',
	},
});
const COMPARE_LABELS = Object.freeze({
	en: {
		am_peak: 'AM peak',
		midday: 'Midday',
		pm_peak: 'PM peak',
		evening: 'Evening',
		night: 'Night',
		weekday: 'Weekday',
		weekend: 'Weekend',
	},
	fr: {
		am_peak: 'Pointe AM',
		midday: 'Journée',
		pm_peak: 'Pointe PM',
		evening: 'Soirée',
		night: 'Nuit',
		weekday: 'Semaine',
		weekend: 'Fin de semaine',
	},
});

function bestTimeText(habits, locale) {
	const matrix = habits?.matrix ?? [];
	let worst = null;
	const means = [];
	for (let row = 0; row < 7; row += 1) {
		const values = (matrix[row] ?? []).flatMap((value, hour) => {
			const n = finite(value);
			if (n != null && (worst == null || n > worst.value)) worst = { row, hour, value: n };
			return n == null ? [] : [n];
		});
		means[row] = values.length
			? values.reduce((sum, value) => sum + value, 0) / values.length
			: null;
	}
	if (worst == null) return null;
	let calm = null;
	for (let row = 0; row < 7; row += 1)
		if (row !== worst.row && means[row] != null && (calm == null || means[row] < calm.value))
			calm = { row, value: means[row] };
	const day = FULL_WEEKDAYS[locale][worst.row];
	const hour = `${String(worst.hour).padStart(2, '0')}:00`;
	if (locale === 'fr')
		return `Sur cette ligne, les retards récurrents culminent le ${day} vers ${hour}.${calm == null ? '' : ` Le ${FULL_WEEKDAYS.fr[calm.row]} est habituellement sa journée la plus calme.`}`;
	return `On this line, repeat delays peak on ${day} around ${hour}.${calm == null ? '' : ` ${FULL_WEEKDAYS.en[calm.row]} is usually its calmest day.`}`;
}

function proportionDelta(row) {
	const current = finite(row.otp_pct);
	const prior = finite(row.prior_otp_pct);
	if (current == null || prior == null) return { delta: null, state: 'absent' };
	const delta = Math.round(current - prior);
	const n1 = finite(row.observation_count);
	const n2 = finite(row.prior_observation_count);
	if (!(n1 > 0 && n2 > 0)) return { delta, state: 'noise' };
	const k1 = finite(row.on_time) ?? Math.round((current / 100) * n1);
	const p1 = k1 / n1;
	const k2 = finite(row.prior_on_time);
	const p2 =
		k2 == null ? Math.min(Math.max(p1, (prior - 0.5) / 100), (prior + 0.5) / 100) : k2 / n2;
	const pooled = (k1 + p2 * n2) / (n1 + n2);
	const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
	return {
		delta,
		state:
			n1 >= 30 && n2 >= 30 && se > 0 && Math.abs((p1 - p2) / se) >= 1.96 && delta !== 0
				? 'change'
				: 'noise',
	};
}

function meanDelta(row) {
	const current = finite(row.observed_min);
	const prior = finite(row.prior_observed_min);
	if (current == null || prior == null) return { delta: null, state: 'absent' };
	const delta = round(current - prior);
	const n1 = finite(row.observation_count);
	const n2 = finite(row.prior_observation_count);
	const cov = finite(row.cov);
	if (!(n1 >= 7 && n2 >= 7 && cov > 0)) return { delta, state: 'noise' };
	const se = ((Math.abs(current) + Math.abs(prior)) / 2) * cov * Math.sqrt(1 / n1 + 1 / n2);
	return {
		delta,
		state: se > 0 && Math.abs((current - prior) / se) >= 1.96 && delta !== 0 ? 'change' : 'noise',
	};
}

function compareDisplay(row, key, locale, type) {
	const result = type === 'onTime' ? proportionDelta(row) : meanDelta(row);
	const copy = PRIOR_COPY[locale];
	const noun = copy[type];
	const ariaNoun = `${COMPARE_LABELS[locale][key] ?? key} ${noun}`;
	const value = type === 'onTime' ? finite(row.otp_pct) : finite(row.observed_min);
	const text =
		value == null
			? noDataText(locale)
			: type === 'onTime'
				? `${value}%`
				: `${value.toFixed(1)} min`;
	let delta;
	if (result.state === 'absent') delta = `${ariaNoun} ${copy.none}`;
	else if (result.state === 'noise') delta = `${ariaNoun} ${copy.noise}`;
	else {
		const shown =
			type === 'onTime'
				? `${result.delta > 0 ? '+' : ''}${result.delta} ${Math.abs(result.delta) === 1 ? copy.pt : copy.pts}`
				: `${result.delta > 0 ? '+' : ''}${result.delta.toFixed(1)} min`;
		delta = `change ${shown} ${ariaNoun} ${copy.prior}`;
	}
	return { key, value: { value, text }, state: result.state, delta };
}

const countText = (value, locale) =>
	new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', { maximumFractionDigits: 0 }).format(
		value,
	);
const relativeSeconds = (seconds, locale) => {
	if (Math.abs(seconds) < 5) return locale === 'fr' ? 'maintenant' : 'now';
	const units = [
		['year', 31_536_000],
		['month', 2_592_000],
		['week', 604_800],
		['day', 86_400],
		['hour', 3_600],
		['minute', 60],
		['second', 1],
	];
	const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size);
	return new Intl.RelativeTimeFormat(locale === 'fr' ? 'fr-CA' : 'en-CA', {
		numeric: 'auto',
	}).format(-Math.round(seconds / size), unit);
};

function conformanceDisplay(conformance, locale) {
	if (conformance == null) return null;
	const verdict =
		conformance.status === 'conformant'
			? 'conformant'
			: conformance.status === 'out_of_norm'
				? 'out_of_norm'
				: 'unknown';
	const members = conformance.unknown_members ?? [];
	const preview =
		members.length > 3
			? `${members.slice(0, 3).join(', ')}, +${members.length - 3}`
			: members.join(', ');
	const label =
		verdict === 'conformant'
			? locale === 'fr'
				? 'Flux conforme'
				: 'Feed compliant'
			: verdict === 'out_of_norm'
				? locale === 'fr'
					? 'Flux hors-norme'
					: 'Feed out-of-norm'
				: conformance.status;
	const detail =
		verdict === 'out_of_norm' && members.length
			? locale === 'fr'
				? `· ${members.length} champ${members.length > 1 ? 's' : ''} non modélisé${members.length > 1 ? 's' : ''} (${preview})`
				: `· ${members.length} unmodelled field${members.length > 1 ? 's' : ''} (${preview})`
			: null;
	const title =
		verdict === 'out_of_norm'
			? locale === 'fr'
				? `Le flux contient des champs hors du modèle standard (${members.join(', ')}) : ${countText(conformance.extra_row_count ?? 0, locale)} ligne(s) conservée(s) telles quelles, jamais supprimées.`
				: `The feed carries fields beyond the standard model (${members.join(', ')}): ${countText(conformance.extra_row_count ?? 0, locale)} row(s) captured verbatim, never dropped.`
			: locale === 'fr'
				? 'Le flux GTFS le plus récent ne contient que des champs que le pipeline modélise.'
				: 'The latest GTFS feed only carries fields the pipeline models.';
	return {
		verdict,
		label: label.toLocaleUpperCase(locale === 'fr' ? 'fr-CA' : 'en-CA'),
		detail,
		title,
	};
}

function shareRows(values, keys) {
	if (values == null) return [];
	const total = keys.reduce((sum, key) => sum + Math.max(0, finite(values[key]) ?? 0), 0);
	return total > 0
		? keys.flatMap((key) => {
				const value = Math.max(0, finite(values[key]) ?? 0);
				return value > 0 ? [[key, Math.round((value / total) * 100)]] : [];
			})
		: [];
}

function dominantShare(values, keys) {
	if (values == null) return null;
	const bands = keys.map((key) => [key, Math.max(0, finite(values[key]) ?? 0)]);
	const total = bands.reduce((sum, [, value]) => sum + value, 0);
	if (total <= 0) return null;
	const dominant = bands.reduce((best, row) => (row[1] > best[1] ? row : best));
	return [dominant[0], Math.round((dominant[1] / total) * 100)];
}

function heatmapTiers(habits) {
	const matrix = habits?.matrix ?? [];
	if (!matrix.some((row) => row.some((value) => finite(value) != null))) return [];
	return Array.from({ length: 7 }, (_, row) =>
		Array.from({ length: 24 }, (_, column) => {
			const value = finite(matrix[row]?.[column]);
			if (value == null) return null;
			return Math.min(3, Math.floor(Math.min(1, Math.max(0, value)) * 4));
		}),
	);
}

function meanMix(rows) {
	const present = rows.filter((row) => row.mix != null);
	if (present.length === 0) return null;
	const weighted = present.every((row) => finite(row.n) > 0);
	const denominator = weighted ? present.reduce((sum, row) => sum + row.n, 0) : present.length;
	return Object.fromEntries(
		OCCUPANCY.map((key) => [
			key,
			present.reduce((sum, row) => sum + (finite(row.mix[key]) ?? 0) * (weighted ? row.n : 1), 0) /
				denominator,
		]),
	);
}

const ids = (value) => Object.freeze(value.trim().split(/\s+/u));
export const OBSERVATION_IDS = Object.freeze({
	line: ids(`line.day.otp_pct line.day.avg_delay_min line.day.p50_min line.day.p90_min
		line.day.severe_pct line.day.observation_count line.day.cancellation_pct line.day.skipped_pct
		line.day.completeness_pct line.day.scheduled_counts line.service_span line.weak_stops.eligible_ids
		line.weak_stops.hrefs line.weak_stops.raw_count line.pane.freshness_iso line.trend.rows
		line.habits.tiers line.time.rows line.headway.rows line.occupancy.shares
		line.delay_by_crowding line.week.histogram`),
	stop: ids(`stop.day.otp_pct stop.day.avg_delay_min stop.day.p50_min stop.day.p90_min
		stop.day.severe_pct stop.day.observation_count stop.daily.rows stop.range.severe_pct
		stop.range.observations stop.range.below_min_n stop.routes.ranked stop.habits.tiers
		stop.weekday.rows stop.time.rows stop.occupancy.shares stop.display.scalars stop.pane.freshness_iso`),
	network: ids(`network.live.vehicles network.live.on_time_pct network.live.coverage_pct
		network.live.p50_min network.live.p90_min network.live.non_responding network.live.status_shares
		network.live.occupancy_shares network.live.histogram network.live.silent_routes
		network.verdict.delta_pct network.latest.completeness_pct network.trend.rows
		network.vehicles.rows network.cancellations.rows network.occupancy.rows
		network.shift.rows network.daytype.rows`),
});

function rawFile(fixture, path) {
	const value = fixture.files[path];
	invariant(value && typeof value === 'object', `${fixture.name} missing raw ${path}`);
	return value;
}

function routeFile(fixture) {
	return rawFile(fixture, 'historic/route_reliability/24.json');
}

export function expectedScheduleTruth(fixture) {
	const route = routeFile(fixture);
	const date = latestDated((route.periods ?? []).filter((row) => row.grain === 'day'))?.date;
	const receiptsPath = fixture.files['manifest.json'].files.historic.receipts_index;
	const receipts = fixture.files[receiptsPath];
	const availability = (receipts?.available ?? []).find((row) => row.date === date);
	invariant(
		typeof date === 'string' && availability != null,
		'latest route day lacks receipt availability truth',
	);
	return { date, hasData: availability.has_data, hasSchedule: availability.has_schedule === true };
}

function stopFile(fixture) {
	return rawFile(fixture, 'historic/stop_reliability/52095.json');
}

function networkFile(fixture) {
	return rawFile(fixture, 'live/network.json');
}

function networkTrend(fixture) {
	return rawFile(fixture, 'historic/network_trend.json');
}

function retainedLineDays(fixture, view) {
	if (!view.includes('from=')) return [];
	const params = new URLSearchParams(view.split('?')[1] ?? '');
	const from = params.get('from');
	const to = params.get('to');
	const path = Object.keys(fixture.files).find((candidate) =>
		/^historic\/history\/lines\/3234\/generations\/[0-9a-f]{64}\/\d{4}-\d{2}\.json$/u.test(
			candidate,
		),
	);
	return path
		? (rawFile(fixture, path).days ?? []).filter(
				(row) => (!from || from <= row.date) && (!to || row.date <= to),
			)
		: [];
}

function retainedStopDays(fixture, view) {
	if (!view.includes('from=')) return null;
	const params = new URLSearchParams(view.split('?')[1] ?? '');
	const from = params.get('from');
	const to = params.get('to');
	return Object.keys(fixture.files)
		.filter((candidate) =>
			/^historic\/history\/stops\/3532303935\/generations\/[0-9a-f]{64}\/\d{4}-\d{2}\.json$/u.test(
				candidate,
			),
		)
		.flatMap((path) => rawFile(fixture, path).days ?? [])
		.filter((row) => (!from || from <= row.date) && (!to || row.date <= to));
}

function stopOccupancyMix(raw, retained) {
	if (retained == null) return raw.occupancy_mix;
	return Object.fromEntries(
		OCCUPANCY.map((key) => [
			key,
			retained.reduce((sum, row) => sum + (finite(row.occupancy?.[key]) ?? 0), 0),
		]),
	);
}

function sumField(rows, group, field) {
	return rows.reduce((sum, row) => sum + (finite(row[group]?.[field]) ?? 0), 0);
}

function lineOracle(fixture, locale, view) {
	const raw = routeFile(fixture);
	const retained = retainedLineDays(fixture, view);
	const observationN = sumField(retained, 'delay', 'observation_count');
	const delayN = sumField(retained, 'delay', 'in_clamp_observation_count');
	const day = retained.length
		? {
				date: retained.at(-1).date,
				otp_pct: pct(sumField(retained, 'delay', 'on_time_count'), observationN, 0),
				on_time: sumField(retained, 'delay', 'on_time_count'),
				avg_delay_min: delayN
					? round(sumField(retained, 'delay', 'sum_delay_seconds') / delayN / 60)
					: null,
				p50_min:
					retained.length === 1
						? round(retained[0].delay_percentiles?.p50_delay_seconds / 60)
						: null,
				p90_min:
					retained.length === 1
						? round(retained[0].delay_percentiles?.p90_delay_seconds / 60)
						: null,
				severe_pct: pct(sumField(retained, 'delay', 'severe_count'), delayN),
				observation_count: sumField(retained, 'delay', 'observation_count'),
			}
		: latestDated((raw.periods ?? []).filter((row) => row.grain === 'day'));
	const cancellation = retained.length
		? Object.fromEntries(
				[
					'canceled_trip_days',
					'total_trip_days',
					'scheduled_trip_days',
					'delivered_trip_days',
					'silent_trip_days',
				].map((field) => [field, sumField(retained, 'cancellation', field)]),
			)
		: latestDated(raw.cancellations ?? []);
	const skipped = retained.length
		? {
				skipped_stop_count: sumField(retained, 'skipped_stops', 'skipped_stop_count'),
				stop_time_update_count: sumField(retained, 'skipped_stops', 'stop_time_update_count'),
			}
		: latestDated(raw.skipped_stops ?? []);
	const retainedSpan = retained.at(-1)?.service_span;
	const span = retainedSpan
		? {
				date: retained.at(-1).date,
				first_trip_utc: retainedSpan.first_trip_utc,
				last_trip_utc: retainedSpan.last_trip_utc,
				service_span_min: round(
					(Date.parse(retainedSpan.last_trip_utc) - Date.parse(retainedSpan.first_trip_utc)) /
						60_000,
					0,
				),
				first_trip_delay_min: round(retainedSpan.first_trip_delay_seconds / 60),
				last_trip_delay_min: round(retainedSpan.last_trip_delay_seconds / 60),
				trip_count: retainedSpan.trip_count,
			}
		: view.includes('from=')
			? null
			: latestDated(raw.service_spans ?? []);
	const hasSpanPair =
		typeof span?.first_trip_utc === 'string' && typeof span?.last_trip_utc === 'string';
	const windowedStops =
		(raw.weak_stops_by_grain ?? []).find((row) => row.grain === 'day')?.stops ?? [];
	const eligibleStops = windowedStops.map((row) => {
		const n = finite(row.observation_count);
		const severe = finite(row.severe_pct);
		const lower = finite(row.wilson_lo);
		const upper = finite(row.wilson_hi);
		const notSevere = severe == null ? null : 100 - severe;
		invariant(
			n >= 30 &&
				severe != null &&
				lower != null &&
				upper != null &&
				lower <= upper &&
				notSevere >= lower - 0.2 &&
				notSevere <= upper + 0.2,
			'invalid weak-stop publisher row',
		);
		return row;
	});
	const independentlyRanked = eligibleStops
		.slice()
		.sort(
			(a, b) =>
				a.wilson_lo - b.wilson_lo ||
				(finite(b.avg_delay_min) ?? 0) - (finite(a.avg_delay_min) ?? 0) ||
				a.id.localeCompare(b.id),
		);
	invariant(
		independentlyRanked.every((row, index) => row.id === eligibleStops[index]?.id),
		'weak-stop publisher order does not match Wilson, delay, and id ranking',
	);
	const histogram =
		latestDated((raw.periods ?? []).filter((row) => row.grain === 'week'))?.delay_histogram ?? null;
	const trendRows = (raw.periods ?? [])
		.filter((row) => row.grain === 'day')
		.slice()
		.sort((a, b) => a.date.localeCompare(b.date));
	const recentTrendRows = trendRows.slice(-14);
	const windowedBreakdown = (raw.periods_by_grain ?? []).find((row) => row.grain === 'day');
	const breakdown = windowedBreakdown ?? {
		by_shift: (raw.periods ?? []).filter((row) => SHIFTS.includes(row.grain)),
		by_daytype: (raw.periods ?? []).filter((row) => DAY_TYPES.includes(row.grain)),
		by_shift_daytype: [],
		day_of_week: raw.day_of_week ?? [],
	};
	const orderRows = (rows, order) =>
		(rows ?? []).slice().sort((a, b) => order.indexOf(a.grain) - order.indexOf(b.grain));
	const byShift = orderRows(breakdown.by_shift, SHIFTS);
	const byDayType = orderRows(breakdown.by_daytype, DAY_TYPES);
	const trendSource = view.includes('from=')
		? recentTrendRows.map((row) => [
				row.date,
				finite(row.observation_count) > 0 && finite(row.on_time) != null
					? (row.on_time / row.observation_count) * 100
					: finite(row.otp_pct),
				finite(row.avg_delay_min),
			])
		: byShift.map((row) => [row.grain, finite(row.otp_pct), finite(row.avg_delay_min)]);
	const displayedTrend = trendSource.filter((row) => row[1] != null).length >= 2 ? trendSource : [];
	const crosstab = new Map(
		(breakdown.by_shift_daytype ?? []).map((row) => [`${row.shift}|${row.day_type}`, row]),
	);
	const crosstabRows = SHIFTS.map((shift) => [
		shift,
		...DAY_TYPES.map((dayType) => {
			const row = crosstab.get(`${shift}|${dayType}`);
			return finite(row?.observation_count) >= 30 ? finite(row?.otp_pct) : null;
		}),
	]);
	const timeRows = {
		shift: byShift
			.filter((row) => finite(row.severe_pct) != null)
			.map((row) => [row.grain, row.severe_pct]),
		dayType: byDayType
			.filter((row) => finite(row.severe_pct) != null)
			.map((row) => [row.grain, row.severe_pct]),
		onTime: [...byShift, ...byDayType]
			.filter((row) => finite(row.otp_pct) != null && windowedBreakdown != null)
			.map((row) => [row.grain, row.otp_pct]),
		crosstab: crosstabRows.some((row) => row.slice(1).some((value) => value != null))
			? crosstabRows
			: [],
		weekday: Array.from({ length: 7 }, (_, index) => {
			const iso = index + 1;
			return [
				iso,
				finite(
					(breakdown.day_of_week ?? []).find((row) => row.day_of_week_iso === iso)?.avg_delay_min,
				),
			];
		}),
	};
	const windowedHeadway = (raw.headway_by_grain ?? []).find((row) => row.grain === 'day');
	const headwayRows = windowedHeadway?.headway ?? raw.headway ?? [];
	const primaryHeadway = headwayRows.some((row) => row.direction_id == null && row.day_type == null)
		? headwayRows.filter((row) => row.direction_id == null && row.day_type == null)
		: headwayRows;
	const headwayMetric = (field) =>
		primaryHeadway.some((row) => finite(row[field]) != null)
			? primaryHeadway.map((row) => [row.shift, finite(row[field])])
			: [];
	const headwayDisplay = {
		dumbbell: primaryHeadway.some(
			(row) => finite(row.scheduled_min) != null && finite(row.observed_min) != null,
		)
			? primaryHeadway.map((row) => [
					row.shift,
					finite(row.scheduled_min),
					finite(row.observed_min),
				])
			: [],
		excess: headwayMetric('excess_wait_min'),
		cov: headwayMetric('cov'),
		bunched: headwayMetric('bunched_pct'),
		compare:
			windowedHeadway == null
				? []
				: primaryHeadway
						.filter((row) => finite(row.observed_min) != null)
						.map((row) => compareDisplay(row, row.shift, locale, 'wait')),
		headline: (() => {
			const values = primaryHeadway.flatMap((row) => {
				const value = finite(row.excess_wait_min);
				return value == null ? [] : [value];
			});
			if (values.length === 0) return { value: null, text: '' };
			const value = values.reduce((sum, item) => sum + item, 0) / values.length;
			return { value: round(value), text: `${value.toFixed(1)} min` };
		})(),
	};
	const byDow = raw.occupancy_by_dow ?? [];
	const activeMix =
		(raw.occupancy_by_grain ?? []).find((row) => row.grain === 'day')?.mix ?? raw.occupancy_mix;
	const occupancyShares = {
		active: shareRows(activeMix, OCCUPANCY),
		weekday: shareRows(
			meanMix(byDow.filter((row) => row.day_of_week_iso >= 1 && row.day_of_week_iso <= 5)),
			OCCUPANCY,
		),
		weekend: shareRows(
			meanMix(byDow.filter((row) => row.day_of_week_iso >= 6 && row.day_of_week_iso <= 7)),
			OCCUPANCY,
		),
		byDow: byDow.length
			? Array.from({ length: 7 }, (_, index) => {
					const iso = index + 1;
					return [iso, shareRows(byDow.find((row) => row.day_of_week_iso === iso)?.mix, OCCUPANCY)];
				})
			: [],
	};
	const activeTotal = OCCUPANCY.reduce(
		(sum, key) => sum + Math.max(0, finite(activeMix?.[key]) ?? 0),
		0,
	);
	const dominantCode =
		activeTotal > 0
			? OCCUPANCY.reduce((best, key) =>
					(finite(activeMix[key]) ?? 0) > (finite(activeMix[best]) ?? 0) ? key : best,
				)
			: null;
	const dominant =
		dominantCode == null
			? { label: null, value: { value: null, text: '' } }
			: {
					label: OCCUPANCY_LABELS[locale][dominantCode],
					value: {
						value: Math.round(((finite(activeMix[dominantCode]) ?? 0) / activeTotal) * 100),
						text: `${Math.round(((finite(activeMix[dominantCode]) ?? 0) / activeTotal) * 100)}%`,
					},
				};
	const onTimeDisplays =
		windowedBreakdown == null
			? []
			: [...byShift, ...byDayType]
					.filter((row) => finite(row.otp_pct) != null)
					.map((row) => compareDisplay(row, row.grain, locale, 'onTime'));
	const serviceCaptions = {
		completeness:
			retained.length && finite(cancellation?.scheduled_trip_days) > 0
				? locale === 'fr'
					? `${countText(cancellation.delivered_trip_days, locale)} sur ${countText(cancellation.scheduled_trip_days, locale)} jours-trajets prévus assurés${cancellation.silent_trip_days == null ? '' : ` · ${countText(cancellation.silent_trip_days, locale)} silencieux`}`
					: `${countText(cancellation.delivered_trip_days, locale)} of ${countText(cancellation.scheduled_trip_days, locale)} scheduled trip-days delivered${cancellation.silent_trip_days == null ? '' : ` · ${countText(cancellation.silent_trip_days, locale)} silent`}`
				: null,
		cancellation:
			finite(cancellation?.total_trip_days) > 0
				? locale === 'fr'
					? `${countText(cancellation.canceled_trip_days, locale)} annulés sur ${countText(cancellation.total_trip_days, locale)} jours-trajets`
					: `${countText(cancellation.canceled_trip_days, locale)} of ${countText(cancellation.total_trip_days, locale)} trip-days canceled`
				: null,
		skipped:
			finite(skipped?.stop_time_update_count) > 0
				? locale === 'fr'
					? `${countText(skipped.skipped_stop_count, locale)} ignorés sur ${countText(skipped.stop_time_update_count, locale)} mises à jour d'arrêt`
					: `${countText(skipped.skipped_stop_count, locale)} of ${countText(skipped.stop_time_update_count, locale)} stop updates skipped`
				: null,
	};
	const scalar = (value, unit, fixed = false) => ({
		value,
		text:
			value == null ? '' : `${fixed ? value.toFixed(1) : value}${unit === 'min' ? ' min' : '%'}`,
		unit,
	});
	const cancellationPct = pct(
		finite(cancellation?.canceled_trip_days),
		finite(cancellation?.total_trip_days),
	);
	const skippedPct = pct(
		finite(skipped?.skipped_stop_count),
		finite(skipped?.stop_time_update_count),
	);
	const completenessPct = retained.length
		? pct(finite(cancellation?.delivered_trip_days), finite(cancellation?.scheduled_trip_days))
		: null;
	const scalars = {
		otp: scalar(finite(day?.otp_pct), '%'),
		avg: scalar(finite(day?.avg_delay_min), 'min', true),
		p50: scalar(finite(day?.p50_min), 'min', true),
		p90: scalar(finite(day?.p90_min), 'min', true),
		severe: scalar(finite(day?.severe_pct), '%'),
		completeness: scalar(completenessPct, '%', true),
		cancellation: scalar(cancellationPct, '%', true),
		skipped: scalar(skippedPct, '%', true),
	};
	const delayByCrowdingRows = OCCUPANCY.map((band) => [
		band,
		finite((raw.delay_by_crowding ?? []).find((row) => row.band === band)?.avg_delay_min),
	]);
	const c = TABLE_COPY[locale];
	return [
		observation('line.day.otp_pct', finite(day?.otp_pct)),
		observation('line.day.avg_delay_min', finite(day?.avg_delay_min)),
		observation('line.day.p50_min', finite(day?.p50_min)),
		observation('line.day.p90_min', finite(day?.p90_min)),
		observation('line.day.severe_pct', finite(day?.severe_pct)),
		observation(
			'line.day.observation_count',
			verdictCount(finite(day?.otp_pct), finite(day?.observation_count), finite(day?.on_time)),
		),
		observation('line.day.cancellation_pct', cancellationPct),
		observation('line.day.skipped_pct', skippedPct),
		observation('line.day.completeness_pct', completenessPct),
		observation(
			'line.day.scheduled_counts',
			retained.length && (finite(cancellation?.scheduled_trip_days) ?? 0) > 0
				? {
						scheduled: finite(cancellation?.scheduled_trip_days),
						delivered: finite(cancellation?.delivered_trip_days),
						silent: finite(cancellation?.silent_trip_days),
						captions: serviceCaptions,
						scalars,
					}
				: { scheduled: null, delivered: null, silent: null, captions: serviceCaptions, scalars },
		),
		observation('line.service_span', {
			date: span?.date ?? null,
			first: hasSpanPair ? montrealClock(span.first_trip_utc) : null,
			last: hasSpanPair ? montrealClock(span.last_trip_utc) : null,
			minutes: finite(span?.service_span_min),
			firstDelay: finite(span?.first_trip_delay_min),
			lastDelay: finite(span?.last_trip_delay_min),
			trips: finite(span?.trip_count),
		}),
		observation('line.weak_stops.eligible_ids', {
			headers: eligibleStops.length
				? locale === 'fr'
					? ['Arrêts affichés', 'Taux de retard grave']
					: ['Stops shown', 'Severe-delay rate']
				: [],
			rows: eligibleStops.map((row) => {
				const ciLo = round(100 - row.wilson_hi);
				const ciHi = round(100 - row.wilson_lo);
				return {
					name: row.name ?? row.id,
					value: row.severe_pct,
					unit: '%',
					ciLo,
					ciHi,
					text: `${row.severe_pct}%\u00a0(${locale === 'fr' ? 'IC 95 %' : '95% CI'} ${ciLo}%–${ciHi}%)`,
				};
			}),
		}),
		observation(
			'line.weak_stops.hrefs',
			eligibleStops.map(
				(row) => `${locale === 'fr' ? '/fr' : ''}/stop/${encodeURIComponent(row.id)}`,
			),
		),
		observation('line.weak_stops.raw_count', windowedStops.length),
		observation('line.pane.freshness_iso', raw.generated_utc),
		observation('line.trend.rows', table([c.x, `${c.otp}%`, `${c.avg} min`], displayedTrend)),
		observation('line.habits.tiers', {
			table: heatmapTable(heatmapTiers(raw.habits), 'line', locale),
			bestTime: bestTimeText(raw.habits, locale),
		}),
		observation('line.time.rows', {
			shift: table([c.group, '%'], timeRows.shift),
			dayType: table([c.dayType, c.severe], timeRows.dayType, ['%']),
			onTime: onTimeDisplays,
			crosstab: table([c.shift, c.weekday, c.weekend], timeRows.crosstab, ['', ''], '·'),
			weekday: table([c.day, c.avg], timeRows.weekday, [''], '·'),
		}),
		observation('line.headway.rows', {
			dumbbell: table([c.row, c.scheduled, c.observed], headwayDisplay.dumbbell),
			excess: table([c.shift, c.excess], headwayDisplay.excess, [' min']),
			cov: table([c.shift, c.cov], headwayDisplay.cov),
			bunched: table([c.shift, c.bunched], headwayDisplay.bunched, ['%']),
			compare: headwayDisplay.compare,
			headline: headwayDisplay.headline,
		}),
		observation('line.occupancy.shares', {
			active: shareTable(occupancyShares.active),
			weekday: shareTable(occupancyShares.weekday),
			weekend: shareTable(occupancyShares.weekend),
			byDow: occupancyShares.byDow.map(([iso, rows]) => [iso, shareTable(rows)]),
			dominant,
		}),
		observation(
			'line.delay_by_crowding',
			delayByCrowdingRows.some((row) => row[1] != null)
				? table([c.crowdingBand, c.avg], delayByCrowdingRows, [' min'])
				: table([], []),
		),
		observation(
			'line.week.histogram',
			histogram == null ? null : histogramTable(histogram, locale, true),
		),
	];
}

function stopOracle(fixture, locale, view) {
	const raw = stopFile(fixture);
	const retained = retainedStopDays(fixture, view);
	const day = (raw.periods ?? []).find((row) => row.grain === 'day') ?? null;
	const allDaily = (raw.daily ?? []).filter(
		(row) => finite(row.observation_count) != null && finite(row.severe_count) != null,
	);
	const window = new URL(view || '/', 'http://b9.local');
	const from = window.searchParams.get('from');
	const to = window.searchParams.get('to');
	const daily =
		from && to ? allDaily.filter((row) => row.date >= from && row.date <= to) : allDaily;
	const totals = daily.reduce(
		(acc, row) => ({
			observations: acc.observations + row.observation_count,
			severe: acc.severe + row.severe_count,
		}),
		{ observations: 0, severe: 0 },
	);
	const latestDaily = latestDated(allDaily);
	const rankedRoutes = (raw.by_route ?? [])
		.filter((row) => finite(row.avg_delay_min) != null)
		.slice()
		.sort((a, b) => b.avg_delay_min - a.avg_delay_min)
		.map((row) => [row.route, row.avg_delay_min]);
	const displayedDaily =
		daily.filter((row) => finite(row.severe_pct) != null).length >= 2
			? daily
					.slice()
					.sort((a, b) => a.date.localeCompare(b.date))
					.map((row) => [row.date, finite(row.severe_pct), finite(row.avg_delay_min)])
			: [];
	const weekdayRows = (raw.day_of_week ?? [])
		.filter((row) => finite(row.avg_delay_min) != null)
		.slice()
		.sort((a, b) => b.avg_delay_min - a.avg_delay_min)
		.map((row) => {
			const severe = finite(row.observation_count) >= 5 ? finite(row.severe_pct) : null;
			return [
				row.day_of_week_iso,
				{ value: row.avg_delay_min, text: `${row.avg_delay_min.toFixed(1)} min` },
				{
					values: severe == null ? [] : [severe],
					text:
						severe == null
							? locale === 'fr'
								? 'Retard moyen'
								: 'Avg delay'
							: `${locale === 'fr' ? 'Part des retards graves' : 'Severe-delay share'} ${severe.toFixed(1)}%`,
				},
			];
		});
	const timeRank = (keys) =>
		(raw.periods ?? [])
			.filter((row) => keys.includes(row.grain) && finite(row.severe_pct) != null)
			.slice()
			.sort((a, b) => b.severe_pct - a.severe_pct || keys.indexOf(a.grain) - keys.indexOf(b.grain))
			.map((row) => [
				row.grain,
				{ value: row.severe_pct, text: `${row.severe_pct.toFixed(1)}%` },
				{
					values: [],
					text: locale === 'fr' ? 'Part des retards graves' : 'Severe-delay share',
				},
			]);
	const occupancyMix = stopOccupancyMix(raw, retained);
	const occupancyRows = shareRows(occupancyMix, OCCUPANCY);
	const stopDominant = dominantShare(occupancyMix, OCCUPANCY);
	const localeNumber = (value) =>
		new Intl.NumberFormat(locale === 'fr' ? 'fr' : 'en', { maximumFractionDigits: 1 }).format(
			value,
		);
	const rangeAvg = totals.observations
		? round(
				daily.reduce(
					(sum, row) => sum + (finite(row.avg_delay_min) ?? 0) * row.observation_count,
					0,
				) / totals.observations,
			)
		: null;
	const stopScalars = {
		otp: {
			value: finite(day?.otp_pct),
			text: finite(day?.otp_pct) == null ? '' : `${Math.round(day.otp_pct)}%`,
		},
		summary: [
			{
				value: pct(finite(latestDaily?.severe_count), finite(latestDaily?.observation_count)),
				text:
					finite(latestDaily?.observation_count) > 0
						? `${localeNumber((100 * latestDaily.severe_count) / latestDaily.observation_count)}%`
						: '',
			},
			{
				value: finite(latestDaily?.avg_delay_min),
				text:
					finite(latestDaily?.avg_delay_min) == null
						? ''
						: `${localeNumber(latestDaily.avg_delay_min)} min`,
			},
		],
		percentiles: [
			{
				value: finite(day?.p50_min),
				text: finite(day?.p50_min) == null ? '' : `${day.p50_min.toFixed(1)} min`,
			},
			{
				value: finite(day?.p90_min),
				text: finite(day?.p90_min) == null ? '' : `${day.p90_min.toFixed(1)} min`,
			},
		],
		range: [
			{
				value: totals.observations >= 30 ? pct(totals.severe, totals.observations) : null,
				text:
					totals.observations >= 30 ? `${pct(totals.severe, totals.observations).toFixed(1)}%` : '',
			},
			{ value: rangeAvg, text: rangeAvg == null ? '' : `${rangeAvg.toFixed(1)} min` },
			{
				value: totals.observations,
				text: totals.observations > 0 ? countText(totals.observations, locale) : '',
			},
		],
	};
	const c = TABLE_COPY[locale];
	return [
		observation('stop.day.otp_pct', finite(day?.otp_pct)),
		observation('stop.day.avg_delay_min', finite(latestDaily?.avg_delay_min)),
		observation('stop.day.p50_min', finite(day?.p50_min)),
		observation('stop.day.p90_min', finite(day?.p90_min)),
		observation(
			'stop.day.severe_pct',
			pct(finite(latestDaily?.severe_count), finite(latestDaily?.observation_count)),
		),
		observation(
			'stop.day.observation_count',
			finite(day?.otp_pct) == null ? null : finite(day?.observation_count),
		),
		observation(
			'stop.daily.rows',
			table([c.x, `${c.severe}%`, `${c.avgStop} min`], displayedDaily),
		),
		observation(
			'stop.range.severe_pct',
			totals.observations >= 30 ? pct(totals.severe, totals.observations) : null,
		),
		observation('stop.range.observations', totals.observations),
		observation('stop.range.below_min_n', totals.observations > 0 && totals.observations < 30),
		observation('stop.routes.ranked', rankedRoutes),
		observation('stop.habits.tiers', heatmapTable(heatmapTiers(raw.habits), 'stop', locale)),
		observation('stop.weekday.rows', weekdayRows),
		observation('stop.time.rows', {
			shift: timeRank(SHIFTS),
			dayType: timeRank(DAY_TYPES),
		}),
		observation('stop.occupancy.shares', {
			table: shareTable(occupancyRows),
			dominant:
				stopDominant == null
					? { label: null, value: { value: null, text: '' }, sublabel: null }
					: {
							label: OCCUPANCY_LABELS[locale][stopDominant[0]].toLocaleUpperCase(
								locale === 'fr' ? 'fr-CA' : 'en-CA',
							),
							value: { value: stopDominant[1], text: `${stopDominant[1]}%` },
							sublabel: locale === 'fr' ? 'Occupation la plus fréquente' : 'Most common loading',
						},
		}),
		observation('stop.display.scalars', stopScalars),
		observation('stop.pane.freshness_iso', raw.generated_utc),
	];
}

function retainedNetworkDays(fixture, view) {
	const path = Object.keys(fixture.files).find((candidate) =>
		/^historic\/history\/network\/generations\/[0-9a-f]{64}\/\d{4}-\d{2}\.json$/u.test(candidate),
	);
	if (!path) return [];
	const params = new URLSearchParams(view.split('?')[1] ?? '');
	const from = params.get('from');
	const to = params.get('to');
	return (rawFile(fixture, path).days ?? []).filter(
		(row) => (!from || from <= row.date) && (!to || row.date <= to),
	);
}

function networkOracle(fixture, locale, view) {
	const live = networkFile(fixture);
	const trend = networkTrend(fixture);
	const retained = view.includes('from=') ? retainedNetworkDays(fixture, view) : [];
	const series =
		retained.length > 0
			? retained
					.slice()
					.sort((a, b) => a.date.localeCompare(b.date))
					.map((row) => ({
						date: row.date,
						otp_pct: pct(row.delay?.on_time_count, row.delay?.observation_count, 0),
						avg_delay_min:
							finite(row.delay?.in_clamp_observation_count) > 0
								? round(row.delay.sum_delay_seconds / row.delay.in_clamp_observation_count / 60)
								: null,
						p90_min:
							finite(row.delay_percentiles?.p90_delay_seconds) != null
								? round(row.delay_percentiles.p90_delay_seconds / 60)
								: null,
						vehicles: finite(row.vehicles),
						cancellation_rate: pct(
							row.cancellation?.canceled_trip_days,
							row.cancellation?.total_trip_days,
							2,
						),
						service_completeness_rate: pct(
							row.cancellation?.delivered_trip_days,
							row.cancellation?.scheduled_trip_days,
							2,
						),
						occupancy_mix: row.occupancy ?? null,
					}))
			: (trend.series ?? []);
	const latest = series.at(-1) ?? null;
	const prior = series.at(-2) ?? null;
	const rankRows = (rows) =>
		(rows ?? [])
			.filter((row) => finite(row.otp_pct) != null || finite(row.severe_pct) != null)
			.slice()
			.sort((a, b) => {
				const aOtp = finite(a.otp_pct);
				const bOtp = finite(b.otp_pct);
				if ((aOtp != null) !== (bOtp != null)) return aOtp != null ? -1 : 1;
				return aOtp != null && bOtp != null
					? aOtp - bOtp
					: (finite(b.severe_pct) ?? 0) - (finite(a.severe_pct) ?? 0);
			})
			.map((row) => {
				const otp = finite(row.otp_pct);
				const avg = finite(row.avg_delay_min);
				const severe = finite(row.severe_pct);
				const absent =
					locale === 'fr'
						? 'Aucune donnée ·\u00a0pas assez de mesures'
						: 'No data ·\u00a0not enough readings yet';
				const avgText = avg == null ? noDataText(locale) : `${avg} min`;
				const severeText = severe == null ? noDataText(locale) : `${severe.toFixed(1)}%`;
				return [
					row.grain,
					{ value: otp, text: otp == null ? absent : `${otp}%` },
					{
						values: [avg, severe].filter((value) => value != null),
						text: `${locale === 'fr' ? 'retard moyen' : 'avg delay'} ${avgText} · ${locale === 'fr' ? 'sévère' : 'severe'} ${severeText}`,
					},
				];
			});
	const p90Available = series.some((row) => finite(row.p90_min) != null);
	const avgAvailable = series.some((row) => finite(row.avg_delay_min) != null);
	const delayField = p90Available ? 'p90_min' : avgAvailable ? 'avg_delay_min' : 'p90_min';
	const minimumPoints = retained.length ? 1 : 2;
	const primaryCount = series.filter((row) => finite(row.otp_pct) != null).length;
	const delayCount = series.filter((row) => finite(row[delayField]) != null).length;
	const retardOnly =
		retained.length > 0 && primaryCount < minimumPoints && delayCount >= minimumPoints;
	const trendRows =
		primaryCount >= minimumPoints || retardOnly
			? series.map((row) =>
					retardOnly
						? [row.date, finite(row[delayField])]
						: [row.date, finite(row.otp_pct), finite(row[delayField])],
				)
			: [];
	const vehicleRows =
		series.filter((row) => finite(row.vehicles) != null).length >= 2
			? series.map((row) => [row.date, finite(row.vehicles)])
			: [];
	const cancellationRows =
		series.filter((row) => finite(row.cancellation_rate) != null).length >= 2
			? series.map((row) => [row.date, finite(row.cancellation_rate)])
			: [];
	const ageSeconds = Math.max(
		0,
		Math.round((Date.parse(fixture.frozen_utc) - Date.parse(live.generated_utc)) / 1000),
	);
	const feedSeconds =
		finite(live.feed_freshness_s) == null ? null : live.feed_freshness_s + ageSeconds;
	const networkMeta = {
		freshness: {
			label: locale === 'fr' ? 'EN DIRECT' : 'LIVE',
			age: normalizeObservation(relativeSeconds(ageSeconds, locale)),
			datetime: live.generated_utc,
			seconds: ageSeconds,
		},
		feed:
			feedSeconds == null
				? null
				: {
						label: locale === 'fr' ? 'FLUX' : 'FEED',
						value: normalizeObservation(relativeSeconds(feedSeconds, locale)),
						aria: `${locale === 'fr' ? 'Flux du travailleur mis à jour' : 'Worker feed updated'} ${relativeSeconds(feedSeconds, locale)}`,
					},
		conformance: conformanceDisplay(fixture.files['provenance.json']?.conformance, locale),
		scalars: {
			headline: [
				{
					value: finite(live.on_time_pct),
					text: finite(live.on_time_pct) == null ? '' : `${live.on_time_pct}%`,
					unit: '%',
				},
				{
					value: finite(live.coverage_pct),
					text: finite(live.coverage_pct) == null ? '' : `${live.coverage_pct}%`,
					unit: '%',
				},
				{
					value: finite(live.delay_p50_min),
					text: finite(live.delay_p50_min) == null ? '' : `${live.delay_p50_min} min`,
					unit: 'min',
				},
				{
					value: finite(live.delay_p90_min),
					text: finite(live.delay_p90_min) == null ? '' : `${live.delay_p90_min} min`,
					unit: 'min',
				},
			],
			reporting: [
				{
					value: finite(live.vehicles_in_service),
					text: countText(live.vehicles_in_service, locale),
					unit: 'count',
				},
				{
					value: finite(live.non_responding),
					text: countText(live.non_responding, locale),
					unit: 'count',
				},
			],
			completeness: {
				value:
					finite(latest?.service_completeness_rate) == null
						? null
						: round(latest.service_completeness_rate),
				text:
					finite(latest?.service_completeness_rate) == null
						? ''
						: `${latest.service_completeness_rate.toFixed(1)}%`,
				unit: '%',
			},
		},
	};
	const latestCancellation =
		series.findLast((row) => finite(row.cancellation_rate) != null)?.cancellation_rate ?? null;
	return [
		observation('network.live.vehicles', finite(live.vehicles_in_service)),
		observation('network.live.on_time_pct', finite(live.on_time_pct)),
		observation('network.live.coverage_pct', finite(live.coverage_pct)),
		observation('network.live.p50_min', finite(live.delay_p50_min)),
		observation('network.live.p90_min', finite(live.delay_p90_min)),
		observation('network.live.non_responding', finite(live.non_responding)),
		observation('network.live.status_shares', {
			table: shareTable(shareRows(live.status_dist, STATUS)),
			meta: networkMeta,
		}),
		observation(
			'network.live.occupancy_shares',
			shareTable(shareRows(live.occupancy_mix, OCCUPANCY)),
		),
		observation('network.live.histogram', histogramTable(live.delay_histogram ?? [], locale)),
		observation(
			'network.live.silent_routes',
			(live.non_responding_by_route ?? [])
				.slice()
				.sort((a, b) => b.count - a.count || a.route_id.localeCompare(b.route_id))
				.map((row) => [
					row.route_id,
					row.count,
					`${locale === 'fr' ? '/fr' : ''}/lines/${encodeURIComponent(row.route_id)}`,
				]),
		),
		observation(
			'network.verdict.delta_pct',
			finite(latest?.otp_pct) != null && finite(prior?.otp_pct) != null
				? round(latest.otp_pct - prior.otp_pct, 0)
				: null,
		),
		observation(
			'network.latest.completeness_pct',
			finite(latest?.service_completeness_rate) == null
				? null
				: round(latest.service_completeness_rate),
		),
		observation(
			'network.trend.rows',
			table(
				retardOnly
					? [TABLE_COPY[locale].x, `${TABLE_COPY[locale].networkDelay} min`]
					: [
							TABLE_COPY[locale].x,
							`${TABLE_COPY[locale].networkOtp}%`,
							`${TABLE_COPY[locale].networkDelay} min`,
						],
				trendRows,
			),
		),
		observation('network.vehicles.rows', table([], vehicleRows, [''], '·')),
		observation('network.cancellations.rows', {
			table: table(
				cancellationRows.length ? [TABLE_COPY[locale].x, `${TABLE_COPY[locale].canceled}%`] : [],
				cancellationRows,
			),
			latest:
				latestCancellation == null
					? { value: null, text: '' }
					: { value: round(latestCancellation), text: `${latestCancellation.toFixed(1)}%` },
		}),
		observation(
			'network.occupancy.rows',
			series.flatMap((row) => {
				const shares = shareRows(row.occupancy_mix, OCCUPANCY);
				return shares.length ? [shareTable(shares)] : [];
			}),
		),
		observation('network.shift.rows', rankRows(trend.by_shift)),
		observation('network.daytype.rows', rankRows(trend.by_daytype)),
	];
}

export function expectedDomainObservationsFromFixture(fixture, surface, locale = 'en', view = '') {
	invariant(fixture != null, 'missing fixture');
	invariant(SURFACES.includes(surface), `unknown surface ${surface}`);
	const rows =
		surface === 'line'
			? lineOracle(fixture, locale, view)
			: surface === 'stop'
				? stopOracle(fixture, locale, view)
				: networkOracle(fixture, locale, view);
	invariant(
		JSON.stringify(rows.map((row) => row.id)) === JSON.stringify(OBSERVATION_IDS[surface]),
		`${surface} observation contract expansion`,
	);
	return rows;
}

export function expectedDomainObservations(fixtureName, surface, locale = 'en', view = '') {
	const fixture = FIXTURES[fixtureName];
	invariant(fixture != null, `unknown fixture ${fixtureName}`);
	return expectedDomainObservationsFromFixture(fixture, surface, locale, view);
}

function expectLiteral(actual, expected, id) {
	const left = JSON.stringify(stable(actual));
	const right = JSON.stringify(stable(expected));
	invariant(left === right, `${id}: expected ${right}, got ${left}`);
}

function proveNegativeControl(family) {
	const actual = [observation(`${family}.value`, 17), observation(`${family}.absence`, null)];
	compareObservations(structuredClone(actual), actual, `${family} self-check baseline`);
	for (const [kind, mutate] of [
		['wrong', (rows) => (rows[0].value = 18)],
		['missing', (rows) => rows.pop()],
		['extra', (rows) => rows.push(observation(`${family}.extra`, 1))],
		['duplicate', (rows) => rows.push(structuredClone(rows[0]))],
	]) {
		const corrupted = structuredClone(actual);
		mutate(corrupted);
		let rejected = false;
		try {
			compareObservations(actual, corrupted, `${family} ${kind} negative control`);
		} catch (error) {
			rejected = /mismatch|duplicate/u.test(String(error));
		}
		invariant(rejected, `${family} ${kind} negative control was not rejected`);
	}
}

export function runOracleSelfCheck() {
	const retainedStopFixture = structuredClone(FIXTURES.rich);
	retainedStopFixture.files['historic/stop_reliability/52095.json'].occupancy_mix = {
		empty: 0,
		many_seats: 14,
		few_seats: 46,
		standing: 40,
		full: 0,
	};
	retainedStopFixture.files[
		'historic/history/stops/3532303935/generations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/2026-08.json'
	] = {
		days: [
			{
				date: '2026-08-29',
				occupancy: {
					empty: 0,
					many_seats: 13,
					few_seats: 47,
					standing: 40,
					full: 0,
				},
			},
		],
	};
	expectLiteral(
		expectedDomainObservationsFromFixture(
			retainedStopFixture,
			'stop',
			'en',
			'?from=2026-08-29&to=2026-08-29',
		).find((row) => row.id === 'stop.occupancy.shares')?.value.dominant.value.value,
		47,
		'selected stop history occupancy replaces current mix',
	);
	retainedStopFixture.files[
		'historic/history/stops/3532303935/generations/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/2026-08.json'
	].days[0].occupancy = {
		empty: 0,
		many_seats: 462,
		few_seats: 464,
		standing: 74,
		full: 0,
	};
	expectLiteral(
		expectedDomainObservationsFromFixture(
			retainedStopFixture,
			'stop',
			'en',
			'?from=2026-08-29&to=2026-08-29',
		).find((row) => row.id === 'stop.occupancy.shares')?.value.dominant.label,
		'FEW SEATS',
		'stop dominant occupancy is selected before display rounding',
	);
	const noSpanFixture = structuredClone(FIXTURES.rich);
	noSpanFixture.files[
		'historic/history/lines/3234/generations/527864c22a3853a65c42ec69d86e009cd7a9fe782b9614e0abbda550d300ea43/2026-08.json'
	].days.find((day) => day.date === '2026-08-29').service_span = null;
	expectLiteral(
		expectedDomainObservationsFromFixture(
			noSpanFixture,
			'line',
			'en',
			'?from=2026-08-29&to=2026-08-29',
		).find((row) => row.id === 'line.service_span')?.value,
		{
			date: null,
			first: null,
			last: null,
			minutes: null,
			firstDelay: null,
			lastDelay: null,
			trips: null,
		},
		'selected line range never falls back to unselected current service span',
	);
	const oneDayNetworkFixture = structuredClone(FIXTURES.rich);
	const networkPartitionPath = Object.keys(oneDayNetworkFixture.files).find((candidate) =>
		/^historic\/history\/network\/generations\/[0-9a-f]{64}\/\d{4}-\d{2}\.json$/u.test(candidate),
	);
	invariant(networkPartitionPath != null, 'rich fixture lacks retained network partition');
	oneDayNetworkFixture.files[networkPartitionPath].days = [
		{
			date: '2026-08-29',
			cancellation: { canceled_trip_days: 1, total_trip_days: 200 },
		},
	];
	expectLiteral(
		expectedDomainObservationsFromFixture(
			oneDayNetworkFixture,
			'network',
			'en',
			'?from=2026-08-29&to=2026-08-29',
		).find((row) => row.id === 'network.cancellations.rows')?.value,
		{
			table: { headers: [], rows: [] },
			latest: { value: 0.5, text: '0.5%' },
		},
		'single retained cancellation keeps latest while chart remains absent',
	);
	expectLiteral(
		expectedDomainObservations('rich', 'line', 'en', '?from=2026-08-27&to=2026-08-29').find(
			(row) => row.id === 'line.day.completeness_pct',
		)?.value,
		93,
		'hand line completeness 93/100',
	);
	expectLiteral(
		expectedDomainObservations('rich', 'line').find((row) => row.id === 'line.day.completeness_pct')
			?.value,
		null,
		'current line completeness stands down',
	);
	expectLiteral(
		expectedDomainObservations('rich', 'network').find(
			(row) => row.id === 'network.verdict.delta_pct',
		)?.value,
		7,
		'hand network delta 79-72',
	);
	expectLiteral(
		expectedDomainObservations('rich', 'stop').find((row) => row.id === 'stop.range.severe_pct')
			?.value,
		16.1,
		'hand stop pooled severe 29/180',
	);
	expectLiteral(
		expectedDomainObservations('rich', 'line')[11]
			?.value.rows.slice(0, 2)
			.map(({ name, value, unit, ciLo, ciHi }) => ({ name, value, unit, ciLo, ciHi })),
		[
			{ name: 'B9 Stop 01', value: 50, unit: '%', ciLo: 40.4, ciHi: 59.6 },
			{ name: 'B9 Stop 02', value: 48, unit: '%', ciLo: 38.5, ciHi: 57.7 },
		],
		'hand publisher Wilson order and accessible severe-scale mirror',
	);
	expectLiteral(
		routeFile(FIXTURES.rich)
			.weak_stops_by_grain[0].stops.slice(1, 4)
			.map((row) => [row.id, row.wilson_lo, row.avg_delay_min]),
		[
			['b9-02', 42.3, 12],
			['b9-03', 42.3, 11],
			['b9-04', 42.3, 11],
		],
		'hand weak-stop equal-Wilson higher-delay then id tie-break',
	);
	const weekHistogram = expectedDomainObservations('rich', 'line').find(
		(row) => row.id === 'line.week.histogram',
	)?.value;
	const onTimeBin = weekHistogram.rows.find((bin) => bin.lo === 0 && bin.hi === 120);
	expectLiteral(onTimeBin.count / (onTimeBin.hi - onTimeBin.lo), 2 / 3, 'hand density');
	expectLiteral(
		expectedScheduleTruth(FIXTURES.rich),
		{ date: '2026-08-29', hasData: true, hasSchedule: true },
		'rich schedule truth',
	);
	expectLiteral(
		expectedScheduleTruth(FIXTURES.sparse),
		{ date: '2026-08-29', hasData: true, hasSchedule: false },
		'sparse schedule truth',
	);
	for (const family of SURFACES) proveNegativeControl(family);
	return {
		families: SURFACES.length,
		markKinds: MARK_KINDS.length,
		normalizationRules: CLOCK_NORMALIZATION_ALLOWLIST.length,
	};
}

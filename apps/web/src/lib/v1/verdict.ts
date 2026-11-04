import { verdictCopy } from './verdict.copy';
import type { Locale } from '#lib/i18n/index.ts';
import { wilsonBoundsProportion } from '#lib/v1/stats.ts';

export type VerdictStatus = 'reliable' | 'patchy' | 'unreliable' | 'tentative' | 'absent';

export interface VerdictResult {
	readonly status: VerdictStatus;
	readonly ban: string | null;
	readonly sentence: string;
}

export interface VerdictHeadline {
	readonly otpPct: number | null;
	readonly observationCount: number | null;
	readonly onTime: number | null;
	readonly wilsonLo?: number | null;
	readonly wilsonHi?: number | null;
}

export interface ReliabilityWindow {
	readonly grain?: string;
	readonly date?: string | null;
	readonly otp_pct?: number | null;
	readonly observation_count?: number | null;
	readonly on_time?: number | null;
	readonly wilson_lo?: number | null;
	readonly wilson_hi?: number | null;
}

export interface ReliabilityVerdictFile {
	readonly periods?: readonly ReliabilityWindow[];
	readonly series?: readonly ReliabilityWindow[];
	readonly weekly?: readonly ReliabilityWindow[];
	readonly monthly?: readonly ReliabilityWindow[];
	readonly daily?: readonly {
		readonly date: string;
		readonly observation_count: number;
		readonly severe_count: number;
	}[];
}

export interface VerdictWindow {
	readonly grain?: string;
	readonly selectedDate?: string;
	readonly from?: string;
	readonly to?: string;
	readonly aggregate?: VerdictHeadline;
}

export interface ReliabilityVerdict extends VerdictHeadline {
	readonly status: VerdictStatus;
	readonly grain: string;
	readonly interval: { readonly lo: number; readonly hi: number } | null;
	readonly hedge: string;
}

export function selectHeadlinePeriod<T extends ReliabilityWindow>(
	periods: readonly T[],
	grain = 'day',
	selectedDate?: string,
): T | null {
	const calendar = ['day', 'week', 'month'].flatMap((g) => periods.filter((p) => p.grain === g));
	const matches = calendar.filter((p) => p.grain === grain);
	if (!matches.length) return calendar[0] ?? null;
	if (selectedDate) {
		const exact = matches.find((p) => p.date === selectedDate);
		if (exact) return exact;
	}
	return matches.reduce((best, p) => {
		if (p.date == null) return best.date == null ? p : best;
		return best.date == null || p.date >= best.date ? p : best;
	});
}

export function selectVerdictWindow<T extends ReliabilityWindow>(
	windows: readonly T[],
	grain?: string,
	selectedDate?: string,
): T | null {
	if (grain === 'day' || grain === 'week' || grain === 'month') {
		const matches = windows.filter((window) => window.grain === grain);
		return selectedDate
			? (matches.find((window) => window.date === selectedDate) ?? null)
			: selectHeadlinePeriod(matches, grain);
	}
	for (const candidate of ['day', 'week', 'month']) {
		const latest = selectHeadlinePeriod(
			windows.filter((window) => window.grain === candidate),
			candidate,
		);
		if (latest?.observation_count != null && latest.observation_count >= VERDICT_MIN_N)
			return latest;
	}
	return selectHeadlinePeriod(
		windows.filter((window) => window.grain === 'day'),
		'day',
	);
}

export function reliabilityVerdict(
	file: ReliabilityVerdictFile | null | undefined,
	window: VerdictWindow = {},
	copy: VerdictCopy = verdictCopy.en,
): ReliabilityVerdict {
	const windows = file?.periods ?? [
		...(file?.series ?? []).map((p) => ({ ...p, grain: 'day' })),
		...(file?.weekly ?? []).map((p) => ({ ...p, grain: 'week' })),
		...(file?.monthly ?? []).map((p) => ({ ...p, grain: 'month' })),
	];
	const headlineWindow = selectVerdictWindow(windows, window.grain, window.selectedDate);
	let headline: VerdictHeadline = {
		otpPct: headlineWindow?.otp_pct ?? null,
		observationCount: headlineWindow?.observation_count ?? null,
		onTime: headlineWindow?.on_time ?? null,
		wilsonLo: headlineWindow?.wilson_lo ?? null,
		wilsonHi: headlineWindow?.wilson_hi ?? null,
	};
	if (window.from && window.to) {
		headline = { otpPct: null, observationCount: null, onTime: null };
		const from = window.from < window.to ? window.from : window.to;
		const to = window.from < window.to ? window.to : window.from;
		const dailyWindows: readonly ReliabilityWindow[] =
			file?.daily == null
				? windows
				: file.daily.map((day) => ({
						...day,
						grain: 'day',
						on_time: day.observation_count - day.severe_count,
						otp_pct:
							day.observation_count > 0
								? (100 * (day.observation_count - day.severe_count)) / day.observation_count
								: null,
					}));
		const days = [
			...new Map(
				dailyWindows
					.filter((p) => p.grain === 'day' && p.date != null && p.date >= from && p.date <= to)
					.map((p) => [p.date, p]),
			).values(),
		];
		const complete =
			days.length > 0 && days.every((p) => p.observation_count != null && p.on_time != null);
		const n = complete ? days.reduce((n, p) => n + p.observation_count!, 0) : null;
		const on = complete ? days.reduce((n, p) => n + p.on_time!, 0) : null;
		const rates = days.flatMap((p) => (p.otp_pct == null ? [] : [p.otp_pct]));
		if (days.length > 0)
			headline =
				days.length === 1
					? {
							otpPct: days[0].otp_pct ?? null,
							observationCount: days[0].observation_count ?? null,
							onTime: days[0].on_time ?? null,
							wilsonLo: days[0].wilson_lo ?? null,
							wilsonHi: days[0].wilson_hi ?? null,
						}
					: {
							otpPct:
								n != null && n > 0 && on != null
									? Math.round((on / n) * 100)
									: rates.length
										? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
										: null,
							observationCount: n,
							onTime: on,
						};
	}
	headline = window.aggregate ?? headline;
	const grain = window.from && window.to ? 'day' : (headlineWindow?.grain ?? 'day');
	return {
		...headline,
		otpPct: headline.otpPct == null ? null : Math.round(headline.otpPct),
		...classify(headline),
		grain,
		hedge: selectVerdict(headline, window.from && window.to ? 'range' : grain, 'en', copy).sentence,
	};
}

export function isProblemVerdict(status: VerdictStatus | null): boolean {
	return status === 'patchy' || status === 'unreliable';
}

export function verdictRank(status: VerdictStatus | null): number {
	return status === 'unreliable' ? 0 : status === 'patchy' ? 1 : status === 'reliable' ? 2 : 99;
}

export interface VerdictSentenceArgs {
	readonly window: string;
	readonly onTen: number | '<1' | '>9';
	readonly lateTen: number | '<1' | '>9';
	readonly hedge: string;
}

export interface VerdictCopy {
	readonly windowPhrase: {
		readonly day: string;
		readonly week: string;
		readonly month: string;
		readonly range: string;
	};
	readonly reliable: (a: VerdictSentenceArgs) => string;
	readonly patchy: (a: VerdictSentenceArgs) => string;
	readonly unreliable: (a: VerdictSentenceArgs) => string;
	readonly tentative: (a: {
		readonly window: string;
		readonly otp: number;
		readonly n: number;
		readonly lo: number;
		readonly hi: number;
	}) => string;
	readonly tooFew: (window: string, n: number) => string;
	readonly unknownCount: (window: string) => string;
	readonly absent: string;
	readonly hedgeCI: (otp: number, lo: number, hi: number) => string;
}

export const VERDICT_MIN_N = 30;
export const VERDICT_RELIABLE_FLOOR = 80;
export const VERDICT_PATCHY_FLOOR = 60;

export function wilsonInterval(onTime: number, n: number): { lo: number; hi: number } {
	const b = wilsonBoundsProportion(onTime, n);
	return { lo: b?.[0] ?? 0, hi: b?.[1] ?? 1 };
}

type Mode = 'day' | 'week' | 'month' | 'range';
const asMode = (m: string): Mode => (m === 'week' || m === 'month' || m === 'range' ? m : 'day');

function classify(headline: VerdictHeadline): Pick<ReliabilityVerdict, 'status' | 'interval'> {
	const otp = headline.otpPct;
	const n = headline.observationCount;
	if (otp == null || !Number.isFinite(otp)) return { status: 'absent', interval: null };
	if (n == null || !Number.isFinite(n) || n < VERDICT_MIN_N)
		return { status: 'tentative', interval: null };
	// Published bounds are percentages rounded to one decimal. Compare them as supplied:
	// an 80.0 lower bound qualifies, even when its unrounded value could be 79.95.
	let lo = headline.wilsonLo;
	let hi = headline.wilsonHi;
	if (headline.onTime != null || lo == null || hi == null) {
		const bounds = wilsonInterval(headline.onTime ?? Math.round((otp / 100) * n), n);
		lo = bounds.lo * 100;
		hi = bounds.hi * 100;
	}
	const shownPct = Math.round(otp);
	return {
		status:
			lo >= VERDICT_RELIABLE_FLOOR && shownPct >= VERDICT_RELIABLE_FLOOR
				? 'reliable'
				: hi < VERDICT_RELIABLE_FLOOR
					? shownPct >= VERDICT_PATCHY_FLOOR
						? 'patchy'
						: 'unreliable'
					: 'tentative',
		interval: { lo: Math.round(lo), hi: Math.round(hi) },
	};
}

export function selectVerdict(
	headline: VerdictHeadline | ReliabilityVerdict,
	mode: string,
	_locale: Locale,
	verdict: VerdictCopy,
): VerdictResult {
	const v = verdict;
	const window = v.windowPhrase[asMode(mode)];
	const otp = headline.otpPct;

	if (otp == null || !Number.isFinite(otp))
		return { status: 'absent', ban: null, sentence: v.absent };

	const otpInt = Math.round(otp);
	const n = headline.observationCount;
	const hasCounts = n != null && n > 0 && headline.onTime != null;
	const onShare = hasCounts ? headline.onTime / n : otp / 100;
	let onTen: VerdictSentenceArgs['onTen'];
	let lateTen: VerdictSentenceArgs['lateTen'];
	if (hasCounts && headline.onTime === 0) {
		onTen = 0;
		lateTen = 10;
	} else if (hasCounts && headline.onTime >= n) {
		onTen = 10;
		lateTen = 0;
	} else if (onShare < 0.1) {
		onTen = '<1';
		lateTen = '>9';
	} else if (onShare > 0.9) {
		onTen = '>9';
		lateTen = '<1';
	} else {
		onTen = hasCounts ? 10 - Math.round(((n - headline.onTime) / n) * 10) : Math.round(otp / 10);
		lateTen = 10 - onTen;
	}
	if (n == null || !Number.isFinite(n) || n < VERDICT_MIN_N) {
		return {
			status: 'tentative',
			ban: null,
			sentence: n == null ? v.unknownCount(window) : v.tooFew(window, n),
		};
	}
	// Keep the source interval when a shared verdict already rounded the displayed percentage.
	const result = 'status' in headline ? headline : classify(headline);
	if (result.status === 'absent') return { status: 'absent', ban: null, sentence: v.absent };
	const { lo: loPct, hi: hiPct } = result.interval!;

	if (result.status === 'tentative') {
		return {
			status: 'tentative',
			ban: `${otpInt}%`,
			sentence: v.tentative({ window, otp: otpInt, n, lo: loPct, hi: hiPct }),
		};
	}
	const band = result.status;
	return {
		status: band,
		ban: `${otpInt}%`,
		sentence: v[band]({ window, onTen, lateTen, hedge: v.hedgeCI(otpInt, loPct, hiPct) }),
	};
}

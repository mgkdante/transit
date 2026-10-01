import type { Locale } from '$lib/i18n';
import { wilsonBoundsProportion } from '$lib/v1/stats';

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
	readonly absent: string;
	readonly hedgeSimple: (otp: number) => string;
	readonly hedgeCI: (otp: number, lo: number, hi: number) => string;
}

export const VERDICT_MIN_N = 30;
export const VERDICT_RELIABLE_FLOOR = 80;
export const VERDICT_PATCHY_FLOOR = 60;
const VERDICT_WIDE_CI = 0.3;

export function wilsonInterval(onTime: number, n: number): { lo: number; hi: number } {
	const b = wilsonBoundsProportion(onTime, n);
	return { lo: b?.[0] ?? 0, hi: b?.[1] ?? 1 };
}

type Mode = 'day' | 'week' | 'month' | 'range';
const asMode = (m: string): Mode => (m === 'week' || m === 'month' || m === 'range' ? m : 'day');

const bandOf = (otp: number): 'reliable' | 'patchy' | 'unreliable' =>
	otp >= VERDICT_RELIABLE_FLOOR
		? 'reliable'
		: otp >= VERDICT_PATCHY_FLOOR
			? 'patchy'
			: 'unreliable';

export function selectVerdict(
	headline: VerdictHeadline,
	mode: string,
	_locale: Locale,
	verdict: VerdictCopy,
): VerdictResult {
	const v = verdict;
	const window = v.windowPhrase[asMode(mode)];
	const otp = headline.otpPct;

	if (otp == null) return { status: 'absent', ban: null, sentence: v.absent };

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
	const band = bandOf(otp);

	if (n == null || n <= 0) {
		return {
			status: band,
			ban: `${otpInt}%`,
			sentence: v[band]({ window, onTen, lateTen, hedge: v.hedgeSimple(otpInt) }),
		};
	}
	if (n < VERDICT_MIN_N) {
		return { status: 'absent', ban: null, sentence: v.tooFew(window, n) };
	}
	const numer = headline.onTime ?? Math.round((otp / 100) * n);
	const [lo, hi] = wilsonBoundsProportion(numer, n) ?? [0, 1];
	const loPct = Math.round(lo * 100);
	const hiPct = Math.round(hi * 100);

	if (hi - lo >= VERDICT_WIDE_CI || bandOf(loPct) !== bandOf(hiPct)) {
		return {
			status: 'tentative',
			ban: `${otpInt}%`,
			sentence: v.tentative({ window, otp: otpInt, n, lo: loPct, hi: hiPct }),
		};
	}
	return {
		status: band,
		ban: `${otpInt}%`,
		sentence: v[band]({ window, onTen, lateTen, hedge: v.hedgeCI(otpInt, loPct, hiPct) }),
	};
}

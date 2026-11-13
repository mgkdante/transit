import { wilsonBounds } from './stats';
import { describe, it, expect } from 'vitest';
import {
	verdictForWindow,
	retainedDelayHeadline,
	wilsonInterval,
	isProblemVerdict,
	type VerdictHeadline,
	type ReliabilityWindow,
} from './verdict';
import { StopReliabilitySchema } from './schemas/stop_reliability';
import { NetworkTrendSchema } from './schemas/network_trend';
import { verdictCopy } from './verdict.copy';
import { stopReliabilityCopy } from '#lib/features/stops/reliability/stops-reliability.copy.ts';

const h = (
	otpPct: number | null,
	observationCount: number | null = null,
	onTime: number | null = null,
) => ({
	otpPct,
	observationCount,
	onTime,
});

const reading = (headline: VerdictHeadline, grain = 'day') => ({
	periods: [
		{
			grain,
			otp_pct: headline.otpPct,
			observation_count: headline.observationCount,
			on_time: headline.onTime,
			wilson_lo: headline.wilsonLo,
			wilson_hi: headline.wilsonHi,
		},
	],
});

describe('wilsonInterval', () => {
	it('is wider at small n and narrows as n grows', () => {
		const small = wilsonInterval(8, 10);
		const large = wilsonInterval(800, 1000);
		expect(small.hi - small.lo).toBeGreaterThan(large.hi - large.lo);
		expect(small.lo).toBeGreaterThanOrEqual(0);
		expect(small.hi).toBeLessThanOrEqual(1);
	});
	it('never collapses to zero width at 0/n or n/n (the Wald failure)', () => {
		expect(wilsonInterval(0, 25).hi).toBeGreaterThan(0);
		expect(wilsonInterval(25, 25).lo).toBeLessThan(1);
	});
});

describe('verdictForWindow — value bands (with a confident large n)', () => {
	const N = 4000;

	it('≥80% reads reliable, with a Wilson hedge', () => {
		const v = verdictForWindow(reading(h(85, N, 3400), 'week'), { grain: 'week' }, 'en');
		expect(v.status).toBe('reliable');
		expect(v.ban).toBe('85%');
		expect(v.sentence).toContain('Ran reliably this week');
		expect(v.sentence).toContain('95% CI:');
	});
	it('60–80% reads patchy', () => {
		expect(verdictForWindow(reading(h(72, N, 2880), 'week'), { grain: 'week' }, 'en').status).toBe(
			'patchy',
		);
	});
	it('<60% reads unreliable', () => {
		const v = verdictForWindow(reading(h(48, N, 1920), 'week'), { grain: 'week' }, 'en');
		expect(v.status).toBe('unreliable');
		expect(v.sentence).toContain('Ran unreliably');
	});
	it('is two-sided: on-time + late natural frequencies add to ten', () => {
		const v = verdictForWindow(reading(h(78, N, 3120), 'week'), { grain: 'week' }, 'en');
		expect(v.sentence).toContain('8 in 10');
		expect(v.sentence).toContain('2 in 10');
	});
	it('does not round a nonzero minority up to one in ten', () => {
		const v = verdictForWindow(reading(h(96, 10000, 9600), 'week'), { grain: 'week' }, 'en');
		expect(v.sentence).toContain('>9 in 10');
		expect(v.sentence).toContain('<1 in 10');
	});
	it('a genuinely perfect window still reads "0 in 10 late" (a TRUE zero stays honest)', () => {
		const v = verdictForWindow(reading(h(100, 5000, 5000), 'week'), { grain: 'week' }, 'en');
		expect(v.sentence).toContain('10 in 10');
		expect(v.sentence).toContain('0 in 10');
	});
});

describe('verdictForWindow — n-aware confidence pipeline', () => {
	it('n<30 is tentative with a hedge and no percentage badge', () => {
		const v = verdictForWindow(reading(h(90, 12, 11), 'day'), { grain: 'day' }, 'en');
		expect(v.status).toBe('tentative');
		expect(v.ban).toBeNull();
		expect(v.sentence).toContain('Not enough delay observations');
		expect(v.sentence).toContain('12');
	});
	it('a wide interval entirely below 80 remains a problem and keeps its hedge', () => {
		const v = verdictForWindow(reading(h(50, 30, 15), 'week'), { grain: 'week' }, 'en');
		expect(v.status).toBe('unreliable');
		expect(isProblemVerdict(v.status)).toBe(true);
		expect(v.sentence).toContain('95% CI:');
	});
	it('no percentage at all → absent', () => {
		const v = verdictForWindow(reading(h(null), 'day'), { grain: 'day' }, 'en');
		expect(v.status).toBe('absent');
		expect(v.ban).toBeNull();
	});
});

describe('verdictForWindow — graceful pre-republish degradation (no denominator)', () => {
	it('hedges when the denominator is unknown', () => {
		const v = verdictForWindow(reading(h(82, null, null), 'month'), { grain: 'month' }, 'en');
		expect(v.status).toBe('tentative');
		expect(v.ban).toBeNull();
		expect(v.sentence).toContain('Not enough delay observations');
		expect(v.sentence).not.toContain('95% sure');
	});
	it('stays tentative without an exact numerator or a published interval', () => {
		const v = verdictForWindow(reading(h(85, 1000, null), 'week'), { grain: 'week' }, 'en');
		expect(v.status).toBe('tentative');
		expect(v.sentence).toContain('1000');
		expect(v.sentence).not.toContain('95% CI:');
	});
	it('reads tentative when the Wilson interval crosses 80 (80% at n=1000)', () => {
		const v = verdictForWindow(reading(h(80, 1000, 800), 'week'), { grain: 'week' }, 'en');
		expect(v.status).toBe('tentative');
	});
});

describe('verdictForWindow — FR canonical voice', () => {
	it('renders the FR reliable sentence + hedge', () => {
		const v = verdictForWindow(reading(h(85, 4000, 3400), 'week'), { grain: 'week' }, 'fr');
		expect(v.status).toBe('reliable');
		expect(v.sentence).toContain('Service fiable cette semaine');
		expect(v.sentence).toContain('IC 95 % :');
	});
	it('FR absent voice', () => {
		expect(verdictForWindow(reading(h(null), 'day'), { grain: 'day' }, 'fr').sentence).toContain(
			'Aucun relevé de retard',
		);
	});
});

describe('verdictForWindow — natural-frequency boundaries', () => {
	it('uses real counts when the published percentage rounds to an endpoint', () => {
		expect(
			verdictForWindow(reading(h(100, 5000, 4999), 'week'), { grain: 'week' }, 'en').sentence,
		).toContain('<1 in 10');
		expect(
			verdictForWindow(reading(h(0, 5000, 1), 'week'), { grain: 'week' }, 'en').sentence,
		).toContain('<1 in 10');
	});
});

describe('one reliability verdict', () => {
	it.each([
		[81, 2000, 79.2, 82.6, 'tentative'],
		[80, 1_000_000, 79.6, 79.8, 'patchy'],
		[79, 5000, 77.5, 79.9, 'patchy'],
		[81, 5000, 80, 82.2, 'reliable'],
		[81, 5000, 79.9, 82.2, 'tentative'],
		[81, 5000, 80, 80, 'reliable'],
	] as const)(
		'%s percent at n=%s with published bounds %s to %s is %s',
		(otp_pct, observation_count, wilson_lo, wilson_hi, status) => {
			const point = { date: '2026-11-02', otp_pct, observation_count, wilson_lo, wilson_hi };
			for (const file of [{ periods: [{ ...point, grain: 'day' }] }, { series: [point] }]) {
				const result = verdictForWindow(file);
				expect(result.status).toBe(status);
				expect(result.interval).toEqual({ lo: Math.round(wilson_lo), hi: Math.round(wilson_hi) });
				expect(verdictForWindow(reading(result), {}, 'en').status).toBe(status);
				expect(verdictForWindow(reading(result), {}, 'fr').status).toBe(status);
			}
		},
	);
	it('carries published bounds through an explicit single-day selection', () => {
		const result = verdictForWindow(
			{
				series: [
					{
						date: '2026-11-02',
						otp_pct: 80,
						observation_count: 1_000_000,
						wilson_lo: 79.6,
						wilson_hi: 79.8,
					},
				],
			},
			{ from: '2026-11-02', to: '2026-11-02' },
		);
		expect(result.status).toBe('patchy');
	});
	it('keeps the observation floor and absent verdict ahead of published bounds', () => {
		const point = {
			grain: 'day',
			otp_pct: 90,
			observation_count: 29,
			wilson_lo: 85,
			wilson_hi: 95,
		};
		expect(verdictForWindow({ periods: [point] })).toMatchObject({
			status: 'tentative',
			interval: null,
		});
		expect(verdictForWindow({ periods: [{ ...point, observation_count: null }] }).status).toBe(
			'tentative',
		);
		expect(
			verdictForWindow({ periods: [{ ...point, otp_pct: null, observation_count: 1000 }] }).status,
		).toBe('absent');
	});
	it('prefers exact counts and never borrows a selected period interval for an aggregate', () => {
		const point = {
			grain: 'day',
			otp_pct: 81,
			observation_count: 5000,
			on_time: 4100,
			wilson_lo: 79.9,
			wilson_hi: 83,
		};
		expect(verdictForWindow({ periods: [point] }).status).toBe('reliable');
		expect(verdictForWindow({ periods: [point] }, { aggregate: h(81, 5000) }).status).toBe(
			'tentative',
		);
	});
	it.each([
		{},
		{ wilson_lo: 79.9 },
		{ wilson_hi: 83 },
		{ wilson_lo: null, wilson_hi: null },
	] as const)('stays tentative when no complete published interval exists: %j', (bounds) => {
		const result = verdictForWindow({
			periods: [{ grain: 'day', otp_pct: 85, observation_count: 1000, ...bounds }],
		});
		expect(result).toMatchObject({ status: 'tentative', interval: null });
		for (const locale of ['en', 'fr'] as const) {
			const sentence = verdictForWindow(reading(result), {}, locale);
			expect(sentence.status).toBe('tentative');
			expect(sentence.sentence).toContain('1000');
			expect(sentence.sentence).not.toMatch(/95/);
		}
	});
	it.each([
		[90, 70],
		[-1, 90],
		[70, 101],
	] as const)(
		'rejects schema-accepted unusable published bounds %s to %s',
		(wilson_lo, wilson_hi) => {
			const point = {
				grain: 'day',
				date: '2026-11-02',
				otp_pct: 85,
				observation_count: 1000,
				wilson_lo,
				wilson_hi,
			};
			const generated_utc = '2026-11-02T00:00:00Z';
			for (const file of [
				StopReliabilitySchema.parse({ id: 'probe', generated_utc, periods: [point] }),
				NetworkTrendSchema.parse({ generated_utc, series: [point] }),
			]) {
				const result = verdictForWindow(file);
				expect(result).toMatchObject({ status: 'tentative', interval: null });
				expect(verdictForWindow(reading(result), {}, 'en').sentence).not.toContain('95% CI:');
			}
		},
	);
	it.each([NaN, Infinity, -Infinity])('never uses non-finite published bounds: %s', (invalid) => {
		for (const bounds of [
			{ wilson_lo: invalid, wilson_hi: 90 },
			{ wilson_lo: 80, wilson_hi: invalid },
		]) {
			expect(
				verdictForWindow({
					periods: [{ grain: 'day', otp_pct: 85, observation_count: 1000, ...bounds }],
				}),
			).toMatchObject({ status: 'tentative', interval: null });
		}
	});
	it('keeps an upper bound exactly 80 tentative when the lower bound is below it', () => {
		const point = {
			grain: 'day',
			date: '2026-11-02',
			otp_pct: 80,
			observation_count: 1000,
			wilson_lo: 79.9,
			wilson_hi: 80,
		};
		const generated_utc = '2026-11-02T00:00:00Z';
		for (const file of [
			StopReliabilitySchema.parse({ id: 'probe', generated_utc, periods: [point] }),
			NetworkTrendSchema.parse({ generated_utc, series: [point] }),
		]) {
			expect(verdictForWindow(file)).toMatchObject({
				status: 'tentative',
				interval: { lo: 80, hi: 80 },
			});
		}
	});
	it('keeps exact counts authoritative even when published bounds are invalid', () => {
		expect(
			verdictForWindow({
				periods: [
					{
						grain: 'day',
						otp_pct: 85,
						observation_count: 1000,
						on_time: 850,
						wilson_lo: 90,
						wilson_hi: 70,
					},
				],
			}),
		).toMatchObject({ status: 'reliable', interval: { lo: 83, hi: 87 } });
	});
	it('uses exact intervals before choosing the shown whole-percent problem band', () => {
		const published = verdictForWindow({
			periods: [{ grain: 'day', otp_pct: 80, observation_count: 1_000_000, on_time: 796_000 }],
		});
		const selected = verdictForWindow(
			{},
			{
				from: '2026-10-01',
				to: '2026-10-31',
				aggregate: { otpPct: 79.6, observationCount: 1_000_000, onTime: 796_000 },
			},
		);
		expect(published).toMatchObject({ otpPct: 80, status: 'patchy' });
		expect(selected).toMatchObject({ otpPct: 80, status: 'patchy' });
		expect(verdictForWindow(reading(selected), {}, 'en').status).toBe('patchy');
	});
	it('never calls a shown percentage below 80 reliable, even if published counts disagree', () => {
		const result = verdictForWindow({
			periods: [{ grain: 'day', otp_pct: 79, observation_count: 5000, on_time: 4100 }],
		});
		expect(result).toMatchObject({ otpPct: 79, status: 'tentative' });
		expect(verdictForWindow(reading(result), {}, 'en').status).toBe('tentative');
	});
	it.each([
		[85, 100, 'tentative', false],
		[55, 200, 'unreliable', true],
		[65, 40, 'patchy', true],
		[70, 40, 'tentative', false],
		[79, 5000, 'tentative', false],
		[81, 5000, 'tentative', false],
		[79, 10000, 'patchy', true],
		[81, 10000, 'reliable', false],
		[80, 1000, 'tentative', false],
	] as const)('judges percentage %s at n=%s as %s, problem=%s', (otp, n, status, problem) => {
		const result = verdictForWindow({
			periods: [
				{ grain: 'day', otp_pct: otp, observation_count: n, on_time: Math.round((otp * n) / 100) },
			],
		});
		expect(result.status).toBe(status);
		expect(isProblemVerdict(result.status)).toBe(problem);
		expect(verdictForWindow(reading(result), {}, 'en').status).toBe(status);
		expect(result.hedge).toContain('95% CI:');
	});
	it('keeps an interval crossing 60 in the hedge of a flagged verdict', () => {
		const result = verdictForWindow({
			periods: [{ grain: 'day', otp_pct: 55, observation_count: 200, on_time: 110 }],
		});
		expect(result.status).toBe('unreliable');
		expect(result.interval).toEqual({ lo: 48, hi: 62 });
		expect(result.hedge).toContain('48–62%');
		expect(verdictForWindow(reading(result), {}, 'fr').sentence).toContain('48–62 %');
	});
	it('keeps an explicitly selected grain and never borrows an unavailable window', () => {
		const file = {
			periods: [
				{ grain: 'day', date: '2026-11-02', otp_pct: 85, observation_count: 4000 },
				{ grain: 'week', date: '2026-10-27', otp_pct: 40, observation_count: 29 },
			],
		};
		expect(verdictForWindow(file, { grain: 'week' })).toMatchObject({
			status: 'tentative',
			otpPct: 40,
			observationCount: 29,
			grain: 'week',
		});
		expect(verdictForWindow(file, { grain: 'month' })).toMatchObject({
			status: 'absent',
			otpPct: null,
		});
		expect(verdictForWindow(file, { from: '2026-01-01', to: '2026-01-02' })).toMatchObject({
			status: 'absent',
			otpPct: null,
		});
	});
	it('judges an explicit stop window from its additive prediction counts', () => {
		const file = {
			periods: [{ grain: 'day', date: '2026-11-02', otp_pct: 99, observation_count: 4000 }],
			daily: [
				{ date: '2026-10-01', observation_count: 100, severe_count: 0 },
				{ date: '2026-10-02', observation_count: 900, severe_count: 450 },
			],
		};
		expect(verdictForWindow(file, { from: '2026-10-01', to: '2026-10-02' })).toMatchObject({
			otpPct: 55,
			observationCount: 1000,
			onTime: 550,
			status: 'unreliable',
		});
	});
	it('returns a hedge sentence with the observation count for a tentative day', () => {
		const result = verdictForWindow({
			periods: [{ grain: 'day', otp_pct: 85, observation_count: 12 }],
		});
		expect(result.hedge).toEqual(expect.any(String));
		expect(result.hedge).toContain('12');
	});
	it('uses the latest qualifying window at the finest grain, then the latest day when none qualifies', () => {
		const day = { grain: 'day', date: '2026-11-02', otp_pct: 20, observation_count: 12 };
		const week = {
			grain: 'week',
			date: '2026-10-27',
			otp_pct: 85,
			observation_count: 4000,
			on_time: 3400,
		};
		const month = {
			grain: 'month',
			date: '2026-10-01',
			otp_pct: 72,
			observation_count: 4000,
			on_time: 2880,
		};
		expect(verdictForWindow({ periods: [day, week, month] })).toMatchObject({
			grain: 'week',
			otpPct: 85,
			observationCount: 4000,
			status: 'reliable',
		});
		expect(
			verdictForWindow({ periods: [day, { ...week, observation_count: 29 }, month] }),
		).toMatchObject({ grain: 'month', otpPct: 72, observationCount: 4000, status: 'patchy' });
		expect(verdictForWindow({ periods: [day, { ...week, observation_count: 29 }] })).toMatchObject({
			grain: 'day',
			otpPct: 20,
			observationCount: 12,
			status: 'tentative',
		});
		expect(
			verdictForWindow({
				periods: [{ ...day, date: '2026-11-01', observation_count: 4000 }, day, week],
			}),
		).toMatchObject({ grain: 'week', otpPct: 85 });
	});
	it.each([
		[85, 4000, 'reliable'],
		[72, 4000, 'patchy'],
		[48, 4000, 'unreliable'],
		[85, 29, 'tentative'],
		[85, null, 'tentative'],
		[80, 1000, 'tentative'],
	] as const)(
		'classifies %s at n=%s identically for route, stop and network files',
		(otp, n, status) => {
			const period = {
				date: '2026-11-02',
				otp_pct: otp,
				observation_count: n,
				on_time: n == null ? null : Math.round((n * otp) / 100),
			};
			for (const file of [{ periods: [{ ...period, grain: 'day' }] }, { series: [period] }]) {
				const result = verdictForWindow(file);
				expect(result.status).toBe(status);
				expect(result.otpPct).toBe(otp);
				expect(result.observationCount).toBe(n);
				expect(verdictForWindow(reading(result), {}, 'en').status).toBe(status);
			}
		},
	);
	it('skips an unqualified latest day and uses the qualifying week', () => {
		expect(
			verdictForWindow({
				periods: [
					{ grain: 'month', otp_pct: 99 },
					{ grain: 'week', otp_pct: 72, observation_count: 4000 },
					{ grain: 'day', date: '2026-11-02', otp_pct: null },
					{ grain: 'day', date: '2026-11-01', otp_pct: 85 },
				],
			}).otpPct,
		).toBe(72);
		expect(
			verdictForWindow({
				periods: [
					{ grain: 'month', otp_pct: 99 },
					{ grain: 'week', otp_pct: 72, observation_count: 4000 },
				],
			}).otpPct,
		).toBe(72);
	});
	it('pools a selected range by counts and never averages percentages', () => {
		const result = verdictForWindow(
			{
				periods: [
					{ grain: 'day', date: '2026-11-01', otp_pct: 100, observation_count: 10, on_time: 10 },
					{ grain: 'day', date: '2026-11-02', otp_pct: 50, observation_count: 90, on_time: 45 },
				],
			},
			{ from: '2026-11-01', to: '2026-11-02' },
		);
		expect(result.otpPct).toBe(55);
		expect(result.observationCount).toBe(100);
		expect(result.grain).toBe('day');
	});
	it('filters only confident patchy or unreliable verdicts as problems', () => {
		expect(isProblemVerdict('patchy')).toBe(true);
		expect(isProblemVerdict('unreliable')).toBe(true);
		for (const status of ['reliable', 'tentative', 'absent', null] as const)
			expect(isProblemVerdict(status)).toBe(false);
	});
});

describe('Verdict consistency at the public interface', () => {
	it.each([
		[85, 230, 'tentative', [], 85, { on_time: 195, wilson_lo: 79.6, wilson_hi: 88.9 }],
		[80, 1_000_000, 'patchy', [], 80, { on_time: 797_000, wilson_lo: 79.6, wilson_hi: 79.8 }],
		[85, 4000, 'reliable', [], 85],
		[79.6, 1_000_000, 'patchy', [], 80],
		[59.6, 1_000_000, 'patchy', [], 60],
		[85, 100, 'tentative', [], 85],
		[55, 200, 'unreliable', [], 55],
		[65, 40, 'patchy', [], 65],
		[70, 40, 'tentative', [], 70],
		[79, 5000, 'tentative', [], 79],
		[81, 5000, 'tentative', [], 81],
		[79, 10000, 'patchy', [], 79],
		[81, 10000, 'reliable', [], 81],
		[72, 4000, 'patchy', [], 72],
		[48, 4000, 'unreliable', [], 48],
		[85, 29, 'tentative', [], 85],
		[85, null, 'tentative', [], 85],
		[80, 1000, 'tentative', [], 80],
		[
			20,
			12,
			'reliable',
			[{ grain: 'week', date: '2026-10-27', otp_pct: 85, observation_count: 4000 }],
			85,
		],
		[
			20,
			12,
			'patchy',
			[
				{ grain: 'week', date: '2026-10-27', otp_pct: 85, observation_count: 29 },
				{ grain: 'month', date: '2026-10-01', otp_pct: 72, observation_count: 4000 },
			],
			72,
		],
		[
			null,
			null,
			'patchy',
			[
				{ grain: 'week', date: '2026-10-27', otp_pct: 85, observation_count: 29 },
				{ grain: 'month', date: '2026-10-01', otp_pct: 72, observation_count: 4000 },
			],
			72,
		],
	] as const)(
		'%s percent with n=%s produces %s for every file shape and locale',
		(otp_pct, observation_count, status, otherWindows, headlinePct, published = undefined) => {
			const on_time =
				published?.on_time ??
				(otp_pct == null || observation_count == null
					? null
					: Math.round((otp_pct * observation_count) / 100));
			const bounds = wilsonBounds(on_time, observation_count);
			const point = {
				date: '2026-11-02',
				otp_pct,
				observation_count,
				wilson_lo: published?.wilson_lo ?? bounds?.[0],
				wilson_hi: published?.wilson_hi ?? bounds?.[1],
			};
			const periods = [
				...(otp_pct == null ? [] : [{ ...point, grain: 'day', on_time }]),
				...otherWindows.map((window) => {
					const on_time = Math.round((window.otp_pct * window.observation_count) / 100);
					const bounds = wilsonBounds(on_time, window.observation_count);
					return { ...window, on_time, wilson_lo: bounds?.[0], wilson_hi: bounds?.[1] };
				}),
			];
			const publishedPoint = (point: ReliabilityWindow) => ({
				date: point.date,
				otp_pct: point.otp_pct,
				observation_count: point.observation_count,
				wilson_lo: point.wilson_lo,
				wilson_hi: point.wilson_hi,
			});
			const files = [
				{ periods },
				{
					periods: periods
						.map(publishedPoint)
						.map((point, i) => ({ ...point, grain: periods[i].grain })),
				},
				{
					series: otp_pct == null ? [] : [point],
					weekly: periods.filter((p) => p.grain === 'week').map(publishedPoint),
					monthly: periods.filter((p) => p.grain === 'month').map(publishedPoint),
				},
			];
			for (const locale of ['en', 'fr'] as const)
				for (const file of files) {
					const verdict = verdictForWindow(file, {}, locale);
					expect(verdict.status).toBe(status);
					expect(verdict.otpPct).toBe(headlinePct);
					expect(isProblemVerdict(verdict.status)).toBe(
						status === 'patchy' || status === 'unreliable',
					);
					expect(verdict.sentence.length).toBeGreaterThan(0);
					if (observation_count === 29) expect(verdict.hedge).toContain('29');
				}
		},
	);
});

describe('finished Verdict for the selected Window', () => {
	it.each(['en', 'fr'] as const)(
		'uses headline grain or explicit history wording in %s',
		(locale) => {
			const file = reading({ ...h(85, 4000), wilsonLo: 84, wilsonHi: 86 }, 'week');
			const automatic = verdictForWindow(file, {}, locale);
			expect(automatic).toMatchObject({
				status: 'reliable',
				otpPct: 85,
				ban: '85%',
				grain: 'week',
				interval: { lo: 84, hi: 86 },
			});
			expect(automatic.sentence).toContain(verdictCopy[locale].windowPhrase.week);
			const selected = verdictForWindow(
				file,
				{ from: '2026-10-01', to: '2026-10-31', aggregate: h(55, 1000, 550) },
				locale,
			);
			expect(selected).toMatchObject({
				status: 'unreliable',
				otpPct: 55,
				ban: '55%',
				grain: 'day',
				interval: { lo: 52, hi: 58 },
			});
			expect(selected.sentence).toContain(verdictCopy[locale].windowPhrase.range);
			expect(selected.hedge).toBe(selected.sentence);
		},
	);
	it.each(['en', 'fr'] as const)(
		'uses the retained total instead of visible daily rows in %s',
		(locale) => {
			const file = {
				periods: [
					{ grain: 'day', date: '2026-10-01', otp_pct: 100, observation_count: 100, on_time: 100 },
				],
			};
			const aggregate = retainedDelayHeadline({
				otpPct: 55,
				observationCount: 1000,
				onTimeCount: 550,
			});
			const result = verdictForWindow(
				file,
				{ from: '2026-10-01', to: '2026-10-31', aggregate },
				locale,
			);
			expect(result).toMatchObject({
				status: 'unreliable',
				otpPct: 55,
				observationCount: 1000,
				onTime: 550,
			});
			expect(result.sentence).toContain(verdictCopy[locale].windowPhrase.range);
			expect(verdictForWindow(file, { from: '2026-10-01', to: '2026-10-31' }, locale).status).toBe(
				'reliable',
			);
			expect(retainedDelayHeadline(null)).toBeUndefined();
		},
	);
	it.each(['en', 'fr'] as const)(
		'preserves stop prediction wording for every status in %s',
		(locale) => {
			for (const headline of [
				h(null),
				h(85, 12, 10),
				h(85, 1000),
				h(80, 1000, 800),
				h(85, 4000, 3400),
				h(72, 4000, 2880),
				h(48, 4000, 1920),
			]) {
				const result = verdictForWindow(
					reading(headline),
					{},
					locale,
					stopReliabilityCopy[locale].verdict,
				);
				const generic = verdictForWindow(reading(headline), {}, locale);
				expect(result.status).toBe(generic.status);
				expect(result.interval).toEqual(generic.interval);
				if (headline.observationCount != null && headline.observationCount >= 30)
					expect(result.sentence).toMatch(
						locale === 'en' ? /known predictions/ : /prévisions connues/,
					);
			}
		},
	);
	it('preserves displayed-frequency rounding and the snapshot source-percentage Hedge', () => {
		const result = verdictForWindow(reading({ ...h(90.4, 4000), wilsonLo: 89, wilsonHi: 92 }));
		expect(result.otpPct).toBe(90);
		expect(result.sentence).toContain('9 in 10');
		expect(result.sentence).not.toContain('>9 in 10');
		expect(result.hedge).toContain('>9 in 10');
	});
	it.each(['en', 'fr'] as const)('returns a finished absent Verdict in %s', (locale) => {
		expect(verdictForWindow(null, {}, locale)).toMatchObject({
			status: 'absent',
			otpPct: null,
			ban: null,
			interval: null,
			sentence: verdictCopy[locale].absent,
			hedge: verdictCopy[locale].absent,
		});
	});
});

it('ignores a day period after closed-through', async () => {
	const { closedWeek } = await import('#lib/features/lines/reliability/__fixtures__/closedWeek.ts');
	expect(verdictForWindow(closedWeek)).toMatchObject({
		otpPct: 84,
		observationCount: 227378,
		onTime: 190827,
		grain: 'week',
	});
	expect(verdictForWindow(closedWeek, { grain: 'day' })).toMatchObject({
		otpPct: 85,
		observationCount: 43815,
	});
	expect(verdictForWindow({ ...closedWeek, periods_by_grain: [] }).status).toBe('absent');
	expect(verdictForWindow({ id: closedWeek.id, periods: closedWeek.periods }).status).toBe(
		'absent',
	);
});

it('honours an explicit stop kind over route-shaped fields', () => {
	expect(
		verdictForWindow(
			{
				id: 'test',
				periods_by_grain: [],
				periods: [{ grain: 'week', otp_pct: 85, observation_count: 100, on_time: 85 }],
			},
			{ kind: 'stop' },
		),
	).toMatchObject({ otpPct: 85, observationCount: 100 });
});

import { describe, it, expect } from 'vitest';
import { selectVerdict, wilsonInterval, reliabilityVerdict, isProblemVerdict } from './verdict';
import { routeVerdictCopy } from '$lib/features/lines/reliability/routeVerdict.copy';

const en = routeVerdictCopy.en.verdict;
const fr = routeVerdictCopy.fr.verdict;

const h = (
	otpPct: number | null,
	observationCount: number | null = null,
	onTime: number | null = null,
) => ({
	otpPct,
	observationCount,
	onTime,
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

describe('selectVerdict — value bands (with a confident large n)', () => {
	const N = 4000;

	it('≥80% reads reliable, with a Wilson hedge', () => {
		const v = selectVerdict(h(85, N, 3400), 'week', 'en', en);
		expect(v.status).toBe('reliable');
		expect(v.ban).toBe('85%');
		expect(v.sentence).toContain('Ran reliably this week');
		expect(v.sentence).toContain('95% CI:');
	});
	it('60–80% reads patchy', () => {
		expect(selectVerdict(h(72, N, 2880), 'week', 'en', en).status).toBe('patchy');
	});
	it('<60% reads unreliable', () => {
		const v = selectVerdict(h(48, N, 1920), 'week', 'en', en);
		expect(v.status).toBe('unreliable');
		expect(v.sentence).toContain('Ran unreliably');
	});
	it('is two-sided: on-time + late natural frequencies add to ten', () => {
		const v = selectVerdict(h(78, N, 3120), 'week', 'en', en);
		expect(v.sentence).toContain('8 in 10');
		expect(v.sentence).toContain('2 in 10');
	});
	it('does not round a nonzero minority up to one in ten', () => {
		const v = selectVerdict(h(96, 10000, 9600), 'week', 'en', en);
		expect(v.sentence).toContain('>9 in 10');
		expect(v.sentence).toContain('<1 in 10');
	});
	it('a genuinely perfect window still reads "0 in 10 late" (a TRUE zero stays honest)', () => {
		const v = selectVerdict(h(100, 5000, 5000), 'week', 'en', en);
		expect(v.sentence).toContain('10 in 10');
		expect(v.sentence).toContain('0 in 10');
	});
});

describe('selectVerdict — n-aware confidence pipeline', () => {
	it('n<30 is tentative with a hedge and no percentage badge', () => {
		const v = selectVerdict(h(90, 12, 11), 'day', 'en', en);
		expect(v.status).toBe('tentative');
		expect(v.ban).toBeNull();
		expect(v.sentence).toContain('Not enough delay observations');
		expect(v.sentence).toContain('12');
	});
	it('a wide Wilson interval (n≥30 but imprecise) → tentative', () => {
		const v = selectVerdict(h(50, 30, 15), 'week', 'en', en);
		expect(v.status).toBe('tentative');
		expect(v.sentence).toContain('Limited data');
	});
	it('no percentage at all → absent', () => {
		const v = selectVerdict(h(null), 'day', 'en', en);
		expect(v.status).toBe('absent');
		expect(v.ban).toBeNull();
	});
});

describe('selectVerdict — graceful pre-republish degradation (no denominator)', () => {
	it('hedges when the denominator is unknown', () => {
		const v = selectVerdict(h(82, null, null), 'month', 'en', en);
		expect(v.status).toBe('tentative');
		expect(v.ban).toBeNull();
		expect(v.sentence).toContain('Not enough delay observations');
		expect(v.sentence).not.toContain('95% sure');
	});
	it('derives the numerator from otp×n when on_time is null but n is present', () => {
		const v = selectVerdict(h(85, 1000, null), 'week', 'en', en);
		expect(v.status).toBe('reliable');
		expect(v.sentence).toContain('95% CI:');
	});
	it('reads tentative when the Wilson CI straddles a band boundary (80% at n=1000)', () => {
		const v = selectVerdict(h(80, 1000, 800), 'week', 'en', en);
		expect(v.status).toBe('tentative');
	});
});

describe('selectVerdict — FR canonical voice', () => {
	it('renders the FR reliable sentence + hedge', () => {
		const v = selectVerdict(h(85, 4000, 3400), 'week', 'fr', fr);
		expect(v.status).toBe('reliable');
		expect(v.sentence).toContain('Service fiable cette semaine');
		expect(v.sentence).toContain('IC 95 % :');
	});
	it('FR absent voice', () => {
		expect(selectVerdict(h(null), 'day', 'fr', fr).sentence).toContain('Aucun relevé de retard');
	});
});

describe('selectVerdict — natural-frequency boundaries', () => {
	it('uses real counts when the published percentage rounds to an endpoint', () => {
		expect(selectVerdict(h(100, 5000, 4999), 'week', 'en', en).sentence).toContain('<1 in 10');
		expect(selectVerdict(h(0, 5000, 1), 'week', 'en', en).sentence).toContain('<1 in 10');
	});
});

describe('one reliability verdict', () => {
	it('uses the same whole-percent precision for published and exact selected-window figures', () => {
		const published = reliabilityVerdict({
			periods: [{ grain: 'day', otp_pct: 80, observation_count: 1_000_000, on_time: 796_000 }],
		});
		const selected = reliabilityVerdict(
			{},
			{
				from: '2026-10-01',
				to: '2026-10-31',
				aggregate: { otpPct: 79.6, observationCount: 1_000_000, onTime: 796_000 },
			},
		);
		expect(published).toMatchObject({ otpPct: 80, status: 'reliable' });
		expect(selected).toMatchObject({ otpPct: 80, status: 'reliable' });
	});
	it('keeps an explicitly selected grain and never borrows an unavailable window', () => {
		const file = {
			periods: [
				{ grain: 'day', date: '2026-11-02', otp_pct: 85, observation_count: 4000 },
				{ grain: 'week', date: '2026-10-27', otp_pct: 40, observation_count: 29 },
			],
		};
		expect(reliabilityVerdict(file, { grain: 'week' })).toMatchObject({
			status: 'tentative',
			otpPct: 40,
			observationCount: 29,
			grain: 'week',
		});
		expect(reliabilityVerdict(file, { grain: 'month' })).toMatchObject({
			status: 'absent',
			otpPct: null,
		});
		expect(reliabilityVerdict(file, { from: '2026-01-01', to: '2026-01-02' })).toMatchObject({
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
		expect(reliabilityVerdict(file, { from: '2026-10-01', to: '2026-10-02' })).toMatchObject({
			otpPct: 55,
			observationCount: 1000,
			onTime: 550,
			status: 'unreliable',
		});
	});
	it('returns a hedge sentence with the observation count for a tentative day', () => {
		const result = reliabilityVerdict({
			periods: [{ grain: 'day', otp_pct: 85, observation_count: 12 }],
		});
		expect(result.hedge).toEqual(expect.any(String));
		expect(result.hedge).toContain('12');
	});
	it('uses the latest qualifying window at the finest grain, then the latest day when none qualifies', () => {
		const day = { grain: 'day', date: '2026-11-02', otp_pct: 20, observation_count: 12 };
		const week = { grain: 'week', date: '2026-10-27', otp_pct: 85, observation_count: 4000 };
		const month = { grain: 'month', date: '2026-10-01', otp_pct: 72, observation_count: 4000 };
		expect(reliabilityVerdict({ periods: [day, week, month] })).toMatchObject({
			grain: 'week',
			otpPct: 85,
			observationCount: 4000,
			status: 'reliable',
		});
		expect(
			reliabilityVerdict({ periods: [day, { ...week, observation_count: 29 }, month] }),
		).toMatchObject({ grain: 'month', otpPct: 72, observationCount: 4000, status: 'patchy' });
		expect(
			reliabilityVerdict({ periods: [day, { ...week, observation_count: 29 }] }),
		).toMatchObject({ grain: 'day', otpPct: 20, observationCount: 12, status: 'tentative' });
		expect(
			reliabilityVerdict({
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
				const result = reliabilityVerdict(file);
				expect(result.status).toBe(status);
				expect(result.otpPct).toBe(otp);
				expect(result.observationCount).toBe(n);
				expect(selectVerdict(result, 'day', 'en', en).status).toBe(status);
			}
		},
	);
	it('skips an unqualified latest day and uses the qualifying week', () => {
		expect(
			reliabilityVerdict({
				periods: [
					{ grain: 'month', otp_pct: 99 },
					{ grain: 'week', otp_pct: 72, observation_count: 4000 },
					{ grain: 'day', date: '2026-11-02', otp_pct: null },
					{ grain: 'day', date: '2026-11-01', otp_pct: 85 },
				],
			}).otpPct,
		).toBe(72);
		expect(
			reliabilityVerdict({
				periods: [
					{ grain: 'month', otp_pct: 99 },
					{ grain: 'week', otp_pct: 72, observation_count: 4000 },
				],
			}).otpPct,
		).toBe(72);
	});
	it('pools a selected range by counts and never averages percentages', () => {
		const result = reliabilityVerdict(
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

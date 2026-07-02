import { describe, it, expect } from 'vitest';
import { selectVerdict, wilsonInterval } from './verdict';
import { reliabilityCopy } from '../reliability.copy';

const en = reliabilityCopy.en;
const fr = reliabilityCopy.fr;

const h = (
	otpPct: number | null,
	observationCount: number | null = null,
	onTime: number | null = null,
) => ({
	otpPct,
	observationCount,
	onTime,
});

// wilsonInterval now delegates to the shared $lib/v1/stats kernel at z=WILSON_Z=1.96 (was a local
// 1.959963984540054). The ~2e-5 z drift is sub-integer on the CI and never flips a threshold below,
// so these property tests hold unchanged; nothing published changes (the verdict is client display).
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
	const N = 4000; // large n → tight CI, never tentative

	it('≥80% reads reliable, with a Wilson hedge', () => {
		const v = selectVerdict(h(85, N, 3400), 'week', 'en', en);
		expect(v.status).toBe('reliable');
		expect(v.ban).toBe('85%');
		expect(v.sentence).toContain('Ran reliably this week');
		expect(v.sentence).toContain('95% sure between');
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
		// 78% → 8 in 10 on time, 2 in 10 late.
		const v = selectVerdict(h(78, N, 3120), 'week', 'en', en);
		expect(v.sentence).toContain('8 in 10');
		expect(v.sentence).toContain('2 in 10');
	});
	it('a high-OTP window NEVER narrates "0 in 10 late" when trips were actually late (L1)', () => {
		// 96% on-time over n=10000 → 400 real late trips. Rounding 96/10 = 10 used to fabricate
		// "10 in 10 on time, 0 in 10 late". Each side now floors at 1 when its count is > 0.
		const v = selectVerdict(h(96, 10000, 9600), 'week', 'en', en);
		expect(v.sentence).toContain('9 in 10');
		expect(v.sentence).toContain('1 in 10');
		expect(v.sentence).not.toContain('0 in 10');
	});
	it('a genuinely perfect window still reads "0 in 10 late" (a TRUE zero stays honest)', () => {
		const v = selectVerdict(h(100, 5000, 5000), 'week', 'en', en);
		expect(v.sentence).toContain('10 in 10');
		expect(v.sentence).toContain('0 in 10');
	});
});

describe('selectVerdict — n-aware confidence pipeline', () => {
	it('n<30 suppresses the verdict (NCHS small-sample) → absent, no BAN', () => {
		const v = selectVerdict(h(90, 12, 11), 'day', 'en', en);
		expect(v.status).toBe('absent');
		expect(v.ban).toBeNull();
		expect(v.sentence).toContain('Still measuring');
		expect(v.sentence).toContain('12');
	});
	it('a wide Wilson interval (n≥30 but imprecise) → tentative', () => {
		// n=30 at p≈0.5 → width well over 0.30.
		const v = selectVerdict(h(50, 30, 15), 'week', 'en', en);
		expect(v.status).toBe('tentative');
		expect(v.sentence).toContain('Too few trips');
	});
	it('no percentage at all → absent', () => {
		const v = selectVerdict(h(null), 'day', 'en', en);
		expect(v.status).toBe('absent');
		expect(v.ban).toBeNull();
	});
});

describe('selectVerdict — graceful pre-republish degradation (no denominator)', () => {
	it('shows the band sentence WITHOUT a CI hedge or n when observationCount is null', () => {
		const v = selectVerdict(h(82, null, null), 'month', 'en', en);
		expect(v.status).toBe('reliable');
		expect(v.ban).toBe('82%');
		expect(v.sentence).toContain('(82%)');
		expect(v.sentence).not.toContain('95% sure');
	});
	it('derives the numerator from otp×n when on_time is null but n is present', () => {
		// 85% (not 80) so the CI stays inside the reliable band — this test is about the derived
		// numerator + the Wilson hedge, not the band edge.
		const v = selectVerdict(h(85, 1000, null), 'week', 'en', en);
		expect(v.status).toBe('reliable');
		expect(v.sentence).toContain('95% sure between');
	});
	it('reads tentative when the Wilson CI straddles a band boundary (80% at n=1000)', () => {
		// 80% with n=1000 → Wilson CI ≈ [77, 82], crossing the 80 reliable/patchy line: the verdict
		// can't honestly commit to a band, so it hedges as tentative rather than asserting "reliable".
		const v = selectVerdict(h(80, 1000, 800), 'week', 'en', en);
		expect(v.status).toBe('tentative');
	});
});

describe('selectVerdict — FR canonical voice', () => {
	it('renders the FR reliable sentence + hedge', () => {
		const v = selectVerdict(h(85, 4000, 3400), 'week', 'fr', fr);
		expect(v.status).toBe('reliable');
		expect(v.sentence).toContain('Service fiable cette semaine');
		expect(v.sentence).toContain('sûr à 95 %');
	});
	it('FR absent voice', () => {
		expect(selectVerdict(h(null), 'day', 'fr', fr).sentence).toContain('Mesure en cours');
	});
});

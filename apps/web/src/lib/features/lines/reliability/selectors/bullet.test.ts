import { describe, it, expect } from 'vitest';
import { selectBullet, otpTone } from './bullet';

describe('selectBullet', () => {
	it('builds a zero-based bullet spec with the value, target + tone', () => {
		const s = selectBullet(87, 'en', {
			title: 'On-time',
			xLabel: 'On-time %',
			unit: '%',
			domain: [0, 100],
			target: 80,
			tone: 'good',
			n: 4000,
		});
		expect(s.kind).toBe('bullet');
		expect(s.domain).toEqual([0, 100]);
		expect(s.value).toBe(87);
		expect(s.target).toBe(80);
		expect(s.tone).toBe('good');
		expect(s.n).toBe(4000);
		expect(s.absentReason).toBe('no-observations');
	});
	it('carries a null value honestly (no fabricated 0) + neutral default tone', () => {
		const s = selectBullet(null, 'en', { title: 't', xLabel: 'x', unit: ' min', domain: [0, 8] });
		expect(s.value).toBeNull();
		expect(s.target).toBeNull();
		expect(s.tone).toBe('neutral');
	});
});

describe('otpTone', () => {
	it('maps on-time % to a band tone vs the 80/60 cuts (matching the verdict bands)', () => {
		expect(otpTone(85)).toBe('good');
		expect(otpTone(80)).toBe('good');
		expect(otpTone(72)).toBe('warn');
		expect(otpTone(60)).toBe('warn');
		expect(otpTone(48)).toBe('bad');
		expect(otpTone(null)).toBe('neutral');
	});
});

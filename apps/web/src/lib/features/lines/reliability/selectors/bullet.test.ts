import { reliabilityVerdict } from '#lib/v1/verdict.ts';
import { describe, it, expect } from 'vitest';
import { selectBullet, verdictTone } from './bullet';

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

describe('verdictTone', () => {
	it.each([
		['reliable', 'good'],
		['patchy', 'warn'],
		['unreliable', 'bad'],
		['tentative', 'neutral'],
		['absent', 'neutral'],
		[null, 'neutral'],
		[undefined, 'neutral'],
	] as const)('maps %s to %s', (status, tone) => {
		expect(verdictTone(status)).toBe(tone);
	});
	it.each([
		{ label: '29 observations', grain: 'day', otp_pct: 95, observation_count: 29, on_time: 28 },
		{
			label: 'Wilson-straddling window',
			grain: 'week',
			otp_pct: 80,
			observation_count: 1000,
			on_time: 800,
		},
	])('keeps $label neutral even with a strong percentage', (window) => {
		const result = reliabilityVerdict({ periods: [window] }, { grain: window.grain });
		expect(result.status).toBe('tentative');
		expect(verdictTone(result.status)).toBe('neutral');
	});
});

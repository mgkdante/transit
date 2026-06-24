// delayPresentation.test.ts — the shared delay-reading helpers (slice-S6).
import { describe, expect, it } from 'vitest';
import { delayTone, delayColorVar, delaySeverity, delayLabel } from './delayPresentation';

describe('delayTone', () => {
	it('bands a delay to a calm-by-default status tone', () => {
		expect(delayTone(null)).toBe('none');
		expect(delayTone(undefined)).toBe('none');
		expect(delayTone(-3)).toBe('early');
		expect(delayTone(0)).toBe('on-time');
		expect(delayTone(2)).toBe('late');
		expect(delayTone(8)).toBe('severe');
	});
});

describe('delayColorVar', () => {
	it('maps each tone to the dataviz STATUS scale, undefined for no-data', () => {
		expect(delayColorVar(null)).toBeUndefined();
		expect(delayColorVar(-3)).toBe('var(--dataviz-status-early)');
		expect(delayColorVar(0)).toBe('var(--dataviz-status-on-time)');
		expect(delayColorVar(2)).toBe('var(--dataviz-status-late)');
		expect(delayColorVar(8)).toBe('var(--dataviz-status-severe)');
	});
});

describe('delaySeverity', () => {
	it('keys the a11y band off lateness only (early/on-time stay calm)', () => {
		expect(delaySeverity(null)).toBe('watch');
		expect(delaySeverity(-3)).toBe('watch');
		expect(delaySeverity(0)).toBe('watch');
		expect(delaySeverity(2)).toBe('watch');
		expect(delaySeverity(6)).toBe('high');
		expect(delaySeverity(12)).toBe('critical');
	});
});

describe('delayLabel', () => {
	const copy = {
		early: (m: number) => `${Math.abs(m)} min early`,
		late: (m: number) => `${m} min late`,
		onTime: 'On time',
		noDelay: 'No delay',
	};

	it('reads honestly and never fabricates a 0', () => {
		expect(delayLabel(null, copy)).toBe('No delay');
		expect(delayLabel(-3, copy)).toBe('3 min early');
		expect(delayLabel(5, copy)).toBe('5 min late');
		expect(delayLabel(0, copy)).toBe('On time');
	});

	it('falls back to onTime for an absent delay when noDelay copy is omitted', () => {
		// Scheduled-board / known-only surfaces (StopDetail, the map) omit noDelay so
		// an absent delay reads "on time" rather than "no data".
		const noNoDelay = { early: copy.early, late: copy.late, onTime: 'On time' };
		expect(delayLabel(null, noNoDelay)).toBe('On time');
		expect(delayLabel(undefined, noNoDelay)).toBe('On time');
		expect(delayLabel(0, noNoDelay)).toBe('On time');
	});
});

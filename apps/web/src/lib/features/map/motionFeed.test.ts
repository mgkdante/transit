import { describe, expect, it } from 'vitest';
import { motionFeedAnimate } from './motionFeed';

describe('motionFeedAnimate', () => {
	it('RAW mode does not animate (snap to reported positions, no estimation)', () => {
		expect(motionFeedAnimate({ smoothMotion: false, reduceMotion: false })).toBe(false);
	});

	it('SMOOTH mode animates (forward-projection) when motion is allowed', () => {
		expect(motionFeedAnimate({ smoothMotion: true, reduceMotion: false })).toBe(true);
	});

	it('reduced-motion vetoes animation even in SMOOTH mode', () => {
		expect(motionFeedAnimate({ smoothMotion: true, reduceMotion: true })).toBe(false);
	});

	it('RAW under reduced-motion still snaps', () => {
		expect(motionFeedAnimate({ smoothMotion: false, reduceMotion: true })).toBe(false);
	});
});

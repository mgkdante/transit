import { describe, expect, it } from 'vitest';
import { motionFeedAnimate } from './motionFeed';

// The raw/smooth wiring MapHero feeds into vehicleMotion.set. Proven here because
// the GL canvas can't be screenshotted from CI (same rationale as mapRailSizing).
//
// CONTRACT: animate (forward-projection) iff the user chose SMOOTH and OS
// reduced-motion is off. Raw mode OR reduced motion => false => the controller
// snaps to reported positions, never estimating a position the feed did not send.

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

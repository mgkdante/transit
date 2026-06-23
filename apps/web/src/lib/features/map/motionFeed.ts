// motionFeed — the pure "raw vs smooth" feed wiring for the vehicle motion
// controller.
//
// MapHero feeds vehicleMotion.set every ~30s poll (and on filter/selection
// change). HOW the controller draws between feeds is one boolean it computes from
// two inputs:
//   - smoothMotion: the user's motion-mode choice (smooth = forward-projection
//     "almost real-time"; raw = ping-on-load, snap every feed, no estimation).
//   - reduceMotion: the OS prefers-reduced-motion snapshot (an absolute veto).
//
// animate = smooth AND motion allowed. In raw mode (or under reduced motion) the
// controller SNAPS to the reported positions — it never invents a position the
// feed did not report. Pulled out of the .svelte effect so the wiring is proven
// in a unit test (the GL canvas can't be screenshotted from CI), mirroring mapGeo.

export interface MotionFeedInputs {
	/** User chose smooth (forward-projection) over raw (ping-on-load). */
	smoothMotion: boolean;
	/** OS prefers-reduced-motion is on — an absolute veto over animation. */
	reduceMotion: boolean;
}

/**
 * Should the motion controller forward-project (true) or snap to reported
 * positions (false)? Smooth mode AND reduced-motion off. Raw mode or reduced
 * motion both snap — no estimation, the honest ping-on-load.
 */
export function motionFeedAnimate({ smoothMotion, reduceMotion }: MotionFeedInputs): boolean {
	return smoothMotion && !reduceMotion;
}

// map/motion/runtime.ts — the rAF lifecycle resolver for the motion engine.
//
// Resolves the frame scheduler + monotonic clock from an injectable runtime so
// deterministic tests can drive frames by hand. No GL, no projection — purely the
// "how do we schedule a frame / read the clock" seam.

/**
 * Allow injecting the frame scheduler (deterministic tests drive frames by hand).
 * Defaults to requestAnimationFrame in the browser, a no-op server-side.
 */
export interface MotionRuntime {
	requestFrame?: (cb: () => void) => number;
	cancelFrame?: (handle: number) => void;
	now?: () => number;
}

/** The fully-resolved scheduler/clock the controller drives its loop with. */
export interface ResolvedMotionRuntime {
	requestFrame: (cb: () => void) => number;
	cancelFrame: (handle: number) => void;
	now: () => number;
}

/**
 * Resolve a MotionRuntime to concrete functions: the injected hooks win; otherwise
 * fall back to requestAnimationFrame / cancelAnimationFrame / performance.now in the
 * browser, and to no-ops / Date.now server-side.
 */
export function resolveMotionRuntime(runtime: MotionRuntime = {}): ResolvedMotionRuntime {
	const requestFrame =
		runtime.requestFrame ??
		(typeof requestAnimationFrame === 'function'
			? (cb: () => void) => requestAnimationFrame(cb)
			: () => 0);
	const cancelFrame =
		runtime.cancelFrame ??
		(typeof cancelAnimationFrame === 'function'
			? (h: number) => cancelAnimationFrame(h)
			: () => {});
	const now =
		runtime.now ??
		(typeof performance !== 'undefined' && typeof performance.now === 'function'
			? () => performance.now()
			: () => Date.now());
	return { requestFrame, cancelFrame, now };
}

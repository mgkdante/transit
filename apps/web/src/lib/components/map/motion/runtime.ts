export interface MotionRuntime {
	requestFrame?: (cb: () => void) => number;
	cancelFrame?: (handle: number) => void;
	now?: () => number;
}

export interface ResolvedMotionRuntime {
	requestFrame: (cb: () => void) => number;
	cancelFrame: (handle: number) => void;
	now: () => number;
}

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

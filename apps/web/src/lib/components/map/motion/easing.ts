// map/motion/easing.ts — pure math for the kinetic-motion engine.
//
// Coordinate rounding + bearing normalization/blend + the ease-correct curve.
// Side-effect-free and GL-free; the projector + controller compose these.

/** Round a coordinate to 6 dp (≈ 0.1 m) so feature geometry stays stable. */
export function roundCoordinate(value: number): number {
	return Number(value.toFixed(6));
}

/** Normalize a bearing into [0, 360). */
export function normalizeBearing(value: number): number {
	return ((value % 360) + 360) % 360;
}

/** Shortest-arc bearing blend (degrees), matching the old slerp. */
export function blendBearing(from: number, to: number, t: number): number {
	const delta = ((to - from + 540) % 360) - 180;
	return Math.round(normalizeBearing(from + delta * t));
}

/**
 * gsap's `power1.out` easing curve, as pure math so the per-frame blend is
 * deterministic (no tween scheduler): `out` quad = `1 − (1−t)²`. Same shape the
 * backward tween used to settle a bus onto its fix; reused here so the ease-correct
 * decelerates into the corrected position. `t` is clamped to [0,1].
 */
export function power1Out(t: number): number {
	const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
	return 1 - (1 - u) * (1 - u);
}

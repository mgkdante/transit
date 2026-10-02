export function roundCoordinate(value: number): number {
	return Number(value.toFixed(6));
}

export function normalizeBearing(value: number): number {
	return ((value % 360) + 360) % 360;
}

export function blendBearing(from: number, to: number, t: number): number {
	const delta = ((to - from + 540) % 360) - 180;
	return Math.round(normalizeBearing(from + delta * t));
}

export function power1Out(t: number): number {
	const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
	return 1 - (1 - u) * (1 - u);
}

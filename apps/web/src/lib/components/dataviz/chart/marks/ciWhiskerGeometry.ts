import type { MagnitudeDatum } from '../ChartSpec';

export type LinearScale = (v: number) => number;
export type BandScale = ((key: string) => number | undefined) & { bandwidth?: () => number };

export interface CiWhisker {
	readonly key: string;
	readonly x0: number;
	readonly x1: number;
	readonly yc: number;
}

const clampToDomain = (v: number, domain: readonly [number, number]): number => {
	const lo = Math.min(domain[0], domain[1]);
	const hi = Math.max(domain[0], domain[1]);
	return v < lo ? lo : v > hi ? hi : v;
};

export function ciWhiskerGeometry(
	rows: readonly MagnitudeDatum[],
	xScale: LinearScale,
	yScale: BandScale,
	domain: readonly [number, number],
): CiWhisker[] {
	const bw = typeof yScale.bandwidth === 'function' ? yScale.bandwidth() : 0;
	return rows
		.filter((r) => r.wilsonLo != null && r.wilsonHi != null)
		.map((r) => {
			const top = yScale(r.key);
			return {
				key: r.key,
				x0: xScale(clampToDomain(r.wilsonLo as number, domain)),
				x1: xScale(clampToDomain(r.wilsonHi as number, domain)),
				yc: (top ?? 0) + bw / 2,
			};
		})
		.filter((w) => Number.isFinite(w.x0) && Number.isFinite(w.x1) && Number.isFinite(w.yc));
}

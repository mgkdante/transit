// $lib/components/dataviz/lineScale — shared x-positioning for line charts.
//
// THE "week/month trend goes flat" FIX (Chart Doctrine §F). When real timestamps
// are supplied, x is spaced by ELAPSED CALENDAR TIME — x = pad + ((t - tMin) /
// (tMax - tMin)) * innerW — so a coarse grain that collapses to a few points still
// shows true spacing instead of being smeared evenly across the width by array
// INDEX. Without timestamps (or with fewer than 2 distinct ones) it falls back to
// index spacing — x = pad + (i / (n - 1)) * innerW — so existing categorical
// callers render BYTE-IDENTICAL (opt-in change).
//
// The forward map (x) and the inverse (indexAt, for hover/keyboard hit-testing)
// share one scale object so they can NEVER drift — the bug where the plot uses one
// spacing and the hit-test another, targeting the wrong point.
//
// SSR-safe: pure functions, no DOM.

export interface LineScaleX {
	/** Whether this scale is positioning by real time (vs array index). */
	readonly timeBased: boolean;
	/** x in viewBox units for data index `i`. */
	x(i: number): number;
	/** Nearest data index for `frac` in [0,1] (a fraction of the full chart width). */
	indexAt(frac: number): number;
}

export interface LineScaleOptions {
	/** Number of data points (n). */
	count: number;
	/** Chart viewBox width. */
	width: number;
	/** Horizontal padding (inner plot = width - 2*pad). */
	pad: number;
	/**
	 * Optional timestamp per index (epoch ms, Date, or ISO string). One entry per
	 * data point — a gap (null value) still has a real time, so the slot keeps its
	 * calendar position. Time mode engages only with >= 2 DISTINCT finite times;
	 * otherwise the scale falls back to index spacing.
	 */
	times?: ReadonlyArray<number | Date | string | null | undefined>;
}

function toEpoch(t: number | Date | string | null | undefined): number | null {
	if (t == null) return null;
	if (typeof t === 'number') return Number.isFinite(t) ? t : null;
	if (t instanceof Date) {
		const v = t.getTime();
		return Number.isNaN(v) ? null : v;
	}
	const v = Date.parse(t);
	return Number.isNaN(v) ? null : v;
}

/**
 * Build the shared x-scale for a line chart. Returns a {@link LineScaleX} whose
 * forward `x(i)` and inverse `indexAt(frac)` agree by construction.
 */
export function makeXScale(opts: LineScaleOptions): LineScaleX {
	const n = Math.max(opts.count, 1);
	const { width, pad } = opts;
	const innerW = width - pad * 2;

	const epochs = opts.times?.map(toEpoch) ?? null;
	let tMin = Infinity;
	let tMax = -Infinity;
	let distinct = 0;
	if (epochs) {
		const seen = new Set<number>();
		for (const e of epochs) {
			if (e == null) continue;
			if (e < tMin) tMin = e;
			if (e > tMax) tMax = e;
			if (!seen.has(e)) {
				seen.add(e);
				distinct++;
			}
		}
	}
	// Time mode needs a real, non-degenerate span; else fall back to index.
	const timeBased = epochs != null && distinct >= 2 && tMax > tMin;
	const span = tMax - tMin;

	function indexX(i: number): number {
		return n === 1 ? width / 2 : pad + (i / (n - 1)) * innerW;
	}

	if (!timeBased) {
		return {
			timeBased: false,
			x: indexX,
			indexAt(frac) {
				if (n === 1) return 0;
				const vbX = clamp01(frac) * width;
				const raw = ((vbX - pad) / innerW) * (n - 1);
				return clampIdx(Math.round(raw), n);
			},
		};
	}

	// Time mode: an index with a null/missing time falls back to its index x (so a
	// stray undated point never collapses to tMin) — but the common case is every
	// index dated. innerW maps the [tMin, tMax] span.
	function timeX(i: number): number {
		const e = epochs![i];
		if (e == null) return indexX(i);
		return pad + ((e - tMin) / span) * innerW;
	}

	return {
		timeBased: true,
		x: timeX,
		indexAt(frac) {
			const vbX = clamp01(frac) * width;
			const targetT = tMin + ((vbX - pad) / innerW) * span;
			// Nearest dated index to the pointer's time; undated indices are skipped
			// unless none are dated (then fall back to index rounding).
			let best = -1;
			let bestD = Infinity;
			for (let i = 0; i < n; i++) {
				const e = epochs![i];
				if (e == null) continue;
				const d = Math.abs(e - targetT);
				if (d < bestD) {
					bestD = d;
					best = i;
				}
			}
			if (best >= 0) return best;
			const raw = ((vbX - pad) / innerW) * (n - 1);
			return clampIdx(Math.round(raw), n);
		},
	};
}

function clamp01(x: number): number {
	return Math.min(1, Math.max(0, x));
}
function clampIdx(i: number, n: number): number {
	return Math.min(n - 1, Math.max(0, i));
}

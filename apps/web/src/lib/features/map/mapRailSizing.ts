// mapRailSizing — responsive percent sizing for the /map right detail rail.
//
// THE B1 fix lives here. paneforge sizes panes by PERCENT of the group, so a
// rail sized purely as a percent of the hero renders too-wide at every desktop
// width (a ~410px shrunk floor, a ~115px collapsed strip). We instead pin the
// rail to constant REM targets — a real narrow floor, a sane ceiling, and a thin
// icon strip when collapsed — and convert those rems to the PERCENT paneforge
// wants AT THE LIVE HERO WIDTH. The map stage pane keeps the remaining percent,
// so the same rem rail reads identically at 1024 / 1280 / 1600px desktop widths.
//
// Why a pure function: it is the only load-bearing math in the rail, and the GL
// canvas can't be screenshotted from CI — so the responsiveness is proven here
// in a unit test, not by eyeball.
//
// Conflict-avoidance (percent vs px): the CSS on the pane ALSO clamps
// min-width: REM_MIN / max-width: REM_MAX as belt-and-suspenders. Because the
// percent floor/ceiling below are DERIVED from those exact rems at the live
// width, the CSS clamp and the percent clamp agree — paneforge stops the drag at
// the same pixel the CSS would, so they never fight and the map pane never goes
// degenerate (at 1024px the rail max still leaves the map ~47% ≈ 480px).

/** Rail width targets in rem (1rem = 16px), the single source of truth. */
export const RAIL_REM = {
	/** Hard narrow floor for the EXPANDED rail — genuinely narrow, not ~410px. */
	min: 22,
	/** Comfortable default width when a selection first opens. */
	default: 26,
	/** Ceiling so the rail can never eat the map. */
	max: 34,
	/** Collapsed icon-strip — a thin rail, not a wide ~115px strip. */
	collapsed: 3.7,
} as const;

const PX_PER_REM = 16;

/** The percent sizing paneforge consumes for the right rail pane. */
export interface MapRailSizing {
	/** Initial pane size (%) when a selection opens. */
	defaultSize: number;
	/** Lower drag bound (%) — maps to {@link RAIL_REM.min} at the live width. */
	minSize: number;
	/** Upper drag bound (%) — maps to {@link RAIL_REM.max} at the live width. */
	maxSize: number;
	/** Collapsed pane size (%) — maps to {@link RAIL_REM.collapsed}. */
	collapsedSize: number;
}

function clamp(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, value));
}

function remToPercent(rem: number, heroWidthPx: number): number {
	return ((rem * PX_PER_REM) / heroWidthPx) * 100;
}

/**
 * Convert the rem rail targets to paneforge percents for the live hero width.
 *
 * Each percent is rounded to 0.1% (paneforge tolerates fractional percents) and
 * floored at a small epsilon so a degenerate/zero hero width can't yield 0 or
 * Infinity. The ordering invariant `collapsed ≤ min ≤ default ≤ max` is enforced
 * after rounding, so a pathological narrow width can never produce min > max.
 *
 * @param heroWidthPx live clientWidth of the map hero (the pane group). A value
 *   ≤ 0 (pre-measure) falls back to a 1280px desktop default so the first render
 *   is already sane.
 */
export function mapRailSizing(heroWidthPx: number): MapRailSizing {
	const w = heroWidthPx > 0 ? heroWidthPx : 1280;

	const round = (rem: number): number => Math.round(remToPercent(rem, w) * 10) / 10;

	let collapsedSize = clamp(round(RAIL_REM.collapsed), 0.1, 50);
	let minSize = clamp(round(RAIL_REM.min), 0.1, 90);
	let defaultSize = clamp(round(RAIL_REM.default), 0.1, 95);
	const maxSize = clamp(round(RAIL_REM.max), 0.1, 95);

	// Enforce ordering so paneforge never sees min > max etc. at any width.
	if (minSize > maxSize) minSize = maxSize;
	if (defaultSize < minSize) defaultSize = minSize;
	if (defaultSize > maxSize) defaultSize = maxSize;
	if (collapsedSize > minSize) collapsedSize = minSize;

	return { defaultSize, minSize, maxSize, collapsedSize };
}

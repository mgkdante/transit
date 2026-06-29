// directionAsymmetry.ts — the §2 "the wait depends which way you're going" callout.
//
// The contract carries per-direction observed headway for the advanced (per-direction) shift rows,
// but it was buried inside a reveal table. This pure selector finds the shift with the LARGEST
// inbound-vs-outbound wait gap (both directions present) above a minimum, so the section can surface
// the single most useful asymmetry as an always-visible callout: "the ride home waits longer."
//
// HONEST: a row missing either direction is skipped (never a fabricated 0). Returns null when no
// shift clears `minDiffMin`, so a symmetric line shows no callout (nothing to say). No DOM/i18n —
// the direction labels arrive resolved via opts.

export interface DirectionAsymmetryRow {
	/** Resolved shift label (e.g. "PM peak"). */
	readonly label: string;
	/** Observed gap (min) toward direction 0 / direction 1; null = not observed. */
	readonly dir0: number | null;
	readonly dir1: number | null;
}

export interface DirectionAsymmetryOpts {
	readonly dir0Label: string;
	readonly dir1Label: string;
	/** Minimum gap (min) worth flagging. Default 2 — below that it is noise to a rider. */
	readonly minDiffMin?: number;
}

export interface DirectionAsymmetry {
	readonly shiftLabel: string;
	/** The longer-wait (slower) direction + its observed gap. */
	readonly slowerLabel: string;
	readonly slowerMin: number;
	/** The shorter-wait (faster) direction + its observed gap. */
	readonly fasterLabel: string;
	readonly fasterMin: number;
	/** The gap between the two directions (min, 1 dp). */
	readonly diffMin: number;
}

export function selectDirectionAsymmetry(
	rows: readonly DirectionAsymmetryRow[],
	opts: DirectionAsymmetryOpts,
): DirectionAsymmetry | null {
	const minDiff = opts.minDiffMin ?? 2;
	let best: DirectionAsymmetry | null = null;
	for (const r of rows) {
		if (r.dir0 == null || r.dir1 == null) continue;
		const diff = Math.abs(r.dir0 - r.dir1);
		if (diff < minDiff) continue;
		if (best != null && diff <= best.diffMin) continue;
		const dir0Slower = r.dir0 >= r.dir1;
		best = {
			shiftLabel: r.label,
			slowerLabel: dir0Slower ? opts.dir0Label : opts.dir1Label,
			slowerMin: dir0Slower ? r.dir0 : r.dir1,
			fasterLabel: dir0Slower ? opts.dir1Label : opts.dir0Label,
			fasterMin: dir0Slower ? r.dir1 : r.dir0,
			diffMin: Math.round(diff * 10) / 10,
		};
	}
	return best;
}

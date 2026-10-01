export interface DirectionAsymmetryRow {
	readonly label: string;
	readonly dir0: number | null;
	readonly dir1: number | null;
}

export interface DirectionAsymmetryOpts {
	readonly dir0Label: string;
	readonly dir1Label: string;
	readonly minDiffMin?: number;
}

export interface DirectionAsymmetry {
	readonly shiftLabel: string;
	readonly slowerLabel: string;
	readonly slowerMin: number;
	readonly fasterLabel: string;
	readonly fasterMin: number;
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

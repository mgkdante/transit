// chart-doctrine.test.ts — the GUARDRAIL that makes the relative-to-max chart bug a RED
// BUILD, not a silent ship. The S7 failure: magnitude charts normalized every bar to the
// in-view maximum (value / worst, excess / maxExcess, Math.max(...inView)), so the same
// value rendered a different length on every route/grain/refresh. The fix is that every
// magnitude mark renders on an explicit FIXED `domain` literal.
//
// RE-ARCHITECTED FOR THE LAYERCHART ADOPT (S7 P1.3). The original regex bans only saw the
// reliability section files. A LayerChart adapter is a NEW blind spot: it could quietly
// auto-derive a scale via `d3.extent` or round it with `nice()` — neither of which the
// old `/max` regexes catch. So this gate now (1) scans BOTH the reliability sections AND
// the `components/dataviz/chart` renderer, (2) bans the LayerChart auto-scale escape
// hatches (`extent(`, `nice`), and (3) requires every mounted LayerChart chart context
// (`<LcChart`) to be handed an explicit domain. The TYPE-LEVEL half of the invariant —
// "every magnitude ChartSpec carries an absolute domain" — is enforced by the ChartSpec
// union (compile-time) and echoed at runtime by `checkAbsoluteDomain` (see
// components/dataviz/chart/ChartSpec.test.ts). Runs in the node "data" project (reads
// source, no DOM).

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
/** The LayerChart renderer lives in the shared dataviz kit (lib/components/dataviz/chart). */
const CHART_DIR = join(dir, '../../../components/dataviz/chart');

/** Strip comments so the gate scans CODE, not prose (e.g. "no more delay/worst"). */
function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '') // block comments
		.replace(/<!--[\s\S]*?-->/g, '') // svelte/html comments
		.split('\n')
		.map((l) => l.replace(/\/\/.*$/, '')) // line comments
		.join('\n');
}

const BANNED: { re: RegExp; why: string }[] = [
	// The original relative-to-max idioms.
	{ re: /\/\s*worst\b/, why: 'value divided by the in-view worst (relative-to-max bar)' },
	{ re: /\/\s*maxExcess\b/, why: 'excess divided by the in-view max excess' },
	{
		re: /Math\.max\s*\([^)]*\.\.\./,
		why: 'Math.max over a spread set feeding a chart scale (auto-scale to the in-view max)',
	},
	{ re: /\bnorm\b\s*=\s*[^;]*\/\s*max\b/, why: 'norm = value / in-view max' },
	// The LayerChart-adapter escape hatches (the new blind spot).
	{
		re: /\bextent\s*\(/,
		why: 'd3.extent / a domain auto-derived from data — pass the spec’s absolute domain instead',
	},
	{
		re: /\b[xy]Nice\b|\.nice\s*\(/,
		why: 'axis nice() rounding — a pinned magnitude axis must OMIT nice (Chart Doctrine)',
	},
];

type ScanFile = { label: string; path: string };

function filesIn(root: string, match: (f: string) => boolean): ScanFile[] {
	return readdirSync(root)
		.filter(match)
		.map((f) => ({ label: f, path: join(root, f) }));
}

const RELIABILITY_FILES = filesIn(
	dir,
	(f) => (f.endsWith('.svelte') || f === 'clusters.ts') && !f.includes('.test.'),
);
const RENDERER_FILES = filesIn(
	CHART_DIR,
	(f) => (f.endsWith('.svelte') || f.endsWith('.ts')) && !f.includes('.test.'),
);
const SCAN_FILES = [...RELIABILITY_FILES, ...RENDERER_FILES];

describe('chart-doctrine — STABLE ABSOLUTE domains, never relative-to-max or auto-scaled', () => {
	it('scans the reliability sections AND the LayerChart renderer', () => {
		expect(RELIABILITY_FILES.length).toBeGreaterThan(4);
		expect(RENDERER_FILES.length).toBeGreaterThan(1);
	});

	for (const { label, path } of SCAN_FILES) {
		it(`${label}: no relative-to-max / auto-extent / nice normalization`, () => {
			const code = stripComments(readFileSync(path, 'utf8'));
			for (const { re, why } of BANNED) {
				const m = code.match(re);
				expect(m === null, `${label}: banned chart normalization [${why}] -> "${m?.[0]}"`).toBe(
					true,
				);
			}
		});
	}

	// The source backstop for the compile-time invariant: a LayerChart chart context is
	// mounted as `<LcChart` (import { Chart as LcChart } from 'layerchart'); it must be
	// handed an explicit domain so it can never fall back to auto-extent. The ChartSpec
	// type already requires every magnitude spec to carry one; this proves the renderer
	// actually forwards it.
	for (const { label, path } of RENDERER_FILES) {
		const code = stripComments(readFileSync(path, 'utf8'));
		if (!code.includes('<LcChart')) continue;
		it(`${label}: every mounted LayerChart context pins an explicit domain`, () => {
			expect(
				/[xy]Domain\s*=/.test(code),
				`${label}: mounts <LcChart without an xDomain/yDomain — the spec's absolute domain must be forwarded`,
			).toBe(true);
		});
	}
});

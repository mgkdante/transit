// chart-doctrine.test.ts — the GUARDRAIL that makes the relative-to-max chart bug a
// RED BUILD, not a silent ship. The S7 failure: magnitude charts normalized every bar
// to the in-view maximum (value / worst, excess / maxExcess, Math.max(...inView)), so
// the same value rendered a different length on every route/grain/refresh. The fix is
// that every magnitude mark passes an explicit FIXED `domain` literal; this test bans
// the normalization idioms that re-introduce the bug. Runs in the node "data" project
// (reads source, no DOM).

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

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
	{ re: /\/\s*worst\b/, why: 'value divided by the in-view worst (relative-to-max bar)' },
	{ re: /\/\s*maxExcess\b/, why: 'excess divided by the in-view max excess' },
	{
		re: /Math\.max\s*\([^)]*\.\.\./,
		why: 'Math.max over a spread set feeding a chart scale (auto-scale to the in-view max)',
	},
	{ re: /\bnorm\b\s*=\s*[^;]*\/\s*max\b/, why: 'norm = value / in-view max' },
];

const CHART_FILES = readdirSync(dir).filter(
	(f) => (f.endsWith('.svelte') || f === 'clusters.ts') && !f.includes('.test.'),
);

describe('chart-doctrine — reliability charts use a STABLE ABSOLUTE domain, never relative-to-max', () => {
	it('scans a non-empty set of chart files', () => {
		expect(CHART_FILES.length).toBeGreaterThan(4);
	});

	for (const f of CHART_FILES) {
		it(`${f}: no relative-to-max / in-view auto-scale normalization`, () => {
			const code = stripComments(readFileSync(join(dir, f), 'utf8'));
			for (const { re, why } of BANNED) {
				const m = code.match(re);
				expect(m === null, `${f}: banned chart normalization [${why}] -> "${m?.[0]}"`).toBe(true);
			}
		});
	}
});

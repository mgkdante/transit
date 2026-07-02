// chart-doctrine.test.ts — the GUARDRAIL that makes the relative-to-max chart bug a RED
// BUILD, not a silent ship. Every magnitude mark must render on an explicit FIXED
// `domain` literal; a bar normalized to the in-view maximum (value / worst, excess /
// maxExcess, Math.max(...inView), a reduce-derived max fed into a Ceil-domain) renders a
// different length on every route/grain/refresh and is BANNED.
//
// The scan covers BOTH the feature surfaces AND the shared `components/dataviz/chart`
// renderer, because a LayerChart adapter can quietly auto-derive a scale via `d3.extent`
// or round it with `nice()` — escape hatches the `/max` regexes do not catch. So the gate
// also (1) bans the LayerChart auto-scale escape hatches (`extent(`, `nice`), and (2)
// requires every mounted LayerChart chart context (`<LcChart`) to be handed an explicit
// domain. The TYPE-LEVEL half of the invariant — "every magnitude ChartSpec carries an
// absolute domain" — is enforced by the ChartSpec union (compile-time) and echoed at
// runtime by `checkAbsoluteDomain` (see components/dataviz/chart/ChartSpec.test.ts). Runs
// in the node "data" project (reads source, no DOM).

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
/** The LayerChart renderer lives in the shared dataviz kit (lib/components/dataviz/chart). */
const CHART_DIR = join(dir, '../../../components/dataviz/chart');
/** Every magnitude chart under features must obey the doctrine, so the ban scan covers
 *  the whole feature tree (not just lines/reliability). */
const FEATURES_DIR = join(dir, '../..');

// Every non-allowlisted feature file must pass the ban scan. Entries here are files
// that still carry a banned relative-to-max idiom, quarantined so the gate turns RED on
// any NEW violation while these burn down. SHRINKS ONLY — S8–S15 punch list: an entry
// may be removed once fixed, never added. A file absent from this list must not carry a
// banned idiom (NetworkHealth.svelte is deliberately not listed).
const ALLOWLIST: ReadonlySet<string> = new Set([
	// hotspots/HotspotsBoard.svelte — REMOVED S12: re-seated onto MagnitudeBarsSpec on the
	// absolute SEVERE_DOMAIN [0,100] (the DB Wilson-LB worst-N ladder); the /worst idiom is gone.
	'repeat-offenders/RepeatOffenders.svelte', // delay / worst (in-view worst-delay normalization)
]);

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
	// A division by a `worst*` variable (worstSevere / worstDelay / …) is the same
	// relative-to-max normalization, and the bare `/worst\b/ ban does NOT see it: the
	// word boundary fails between `worst` and its camelCase suffix. A within-DISTRIBUTION
	// normalization to a bucket peak is named `max*` (see the AlertHistory by-cause bars
	// and the lines A1 histogram), so the `worst` prefix isolates the cross-entity case.
	{
		re: /\/\s*worst[A-Za-z]/,
		why: 'value divided by a worst* in-view variable (relative-to-max bar; escapes /worst\\b/)',
	},
	// A reduce-derived max rounded up (Math.ceil) and floored to a literal (Math.max(N, …))
	// to build a chart domain endpoint — the auto-scale-to-the-in-view-max idiom expressed
	// as `Math.max(<literal>, Math.ceil(<reduced max>))`. A magnitude axis must pin an
	// ABSOLUTE literal domain, never a data-derived Ceil. (An axis-tick alignment that
	// rounds a real clock/unit endpoint is `Math.ceil(x) * unit`, not `Math.max(N, ceil)`.)
	{
		re: /Math\.max\s*\(\s*\d+\s*,\s*Math\.ceil/,
		why: 'Math.max(literal, Math.ceil(...)) — a reduce-derived max rounded into a chart domain (auto-scale)',
	},
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

/** Walk `root` RECURSIVELY so the gate sees the `sections/` + `marks/` subdirs, not
 *  just the top level — a chart mounted one folder down must still obey the doctrine. */
function filesIn(root: string, match: (basename: string) => boolean): ScanFile[] {
	const out: ScanFile[] = [];
	const walk = (d: string): void => {
		for (const ent of readdirSync(d, { withFileTypes: true })) {
			const full = join(d, ent.name);
			if (ent.isDirectory()) walk(full);
			else if (match(ent.name)) out.push({ label: relative(root, full), path: full });
		}
	};
	walk(root);
	return out;
}

const FEATURE_FILES = filesIn(
	FEATURES_DIR,
	(f) => (f.endsWith('.svelte') || f.endsWith('.ts')) && !f.includes('.test.'),
);
const RENDERER_FILES = filesIn(
	CHART_DIR,
	(f) => (f.endsWith('.svelte') || f.endsWith('.ts')) && !f.includes('.test.'),
);
const SCAN_FILES = [...FEATURE_FILES, ...RENDERER_FILES];

describe('chart-doctrine — STABLE ABSOLUTE domains, never relative-to-max or auto-scaled', () => {
	it('the scan covers every feature surface AND the LayerChart renderer', () => {
		// The ban scan must span the whole feature tree, not a single section.
		expect(FEATURE_FILES.length).toBeGreaterThan(20);
		expect(RENDERER_FILES.length).toBeGreaterThan(1);
	});

	// Regression guard for the exact idioms this gate was widened to catch: the
	// pre-fix NetworkHealth trend/cancel/shift scales (a reduce-derived max fed into a
	// Ceil-domain, and a `/ worstSevere` division) all ESCAPED the original ban set.
	// These fixtures MUST trip the widened BANNED regexes, or the gate is blind to the
	// regression it just fixed.
	it('the widened bans catch the pre-fix reduce-max→domain and /worst* idioms', () => {
		const mustMatch: string[] = [
			'const retardCeil = Math.max(10, Math.ceil(maxRetard / 5) * 5);', // retard reduce → Ceil domain
			'return [0, Math.max(1, Math.ceil(max))];', // cancel reduce → Ceil domain
			'value: sev != null && worstSevere > 0 ? Math.min(1, Math.max(0, sev / worstSevere)) : null,', // / worstSevere
		];
		for (const idiom of mustMatch) {
			const hit = BANNED.some(({ re }) => re.test(idiom));
			expect(hit, `pre-fix idiom escaped the widened ban: "${idiom}"`).toBe(true);
		}
	});

	// The sanctioned within-DISTRIBUTION shape (a histogram bucket scaled to its own
	// peak) must NOT trip the widened bans — it is the lines A1 / NetworkHealth
	// histogram / AlertHistory by-cause pattern, named `max*` (not `worst*`) and never
	// a Ceil-domain.
	it('the widened bans spare the sanctioned within-distribution peak shape', () => {
		const mustNotMatch: string[] = [
			'const maxCount = bins.reduce((m, b) => (b.count > m ? b.count : m), 0);',
			'const countDomain: AbsoluteDomain = [0, Math.max(maxCount, 1)];',
			'value: maxCount > 0 ? count / maxCount : null,',
		];
		for (const ok of mustNotMatch) {
			const hit = BANNED.some(({ re }) => re.test(ok));
			expect(hit, `sanctioned distribution shape wrongly banned: "${ok}"`).toBe(false);
		}
	});

	it('every allowlisted file exists (no stale punch-list entries)', () => {
		const labels = new Set(FEATURE_FILES.map((f) => f.label));
		for (const entry of ALLOWLIST) {
			expect(labels.has(entry), `stale allowlist entry (file gone / renamed): ${entry}`).toBe(true);
		}
	});

	for (const { label, path } of SCAN_FILES) {
		// Allowlisted files are known S8–S15 violators — assert they STILL violate (so a
		// fix must delete the entry, keeping the list shrinking) and skip the ban check.
		if (ALLOWLIST.has(label)) {
			it(`${label}: allowlisted (S8–S15 punch list) — still violates, remove when fixed`, () => {
				const code = stripComments(readFileSync(path, 'utf8'));
				const hit = BANNED.some(({ re }) => re.test(code));
				expect(hit, `${label}: no banned idiom left — remove it from ALLOWLIST`).toBe(true);
			});
			continue;
		}
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

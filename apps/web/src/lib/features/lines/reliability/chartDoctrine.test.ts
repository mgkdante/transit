import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const CHART_DIR = join(dir, '../../../components/dataviz/chart');
const FEATURES_DIR = join(dir, '../..');

const ALLOWLIST: ReadonlySet<string> = new Set([]);

function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.split('\n')
		.map((l) => l.replace(/\/\/.*$/, ''))
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
	{
		re: /\/\s*worst[A-Za-z]/,
		why: 'value divided by a worst* in-view variable (relative-to-max bar; escapes /worst\\b/)',
	},
	{
		re: /Math\.max\s*\(\s*\d+\s*,\s*Math\.ceil/,
		why: 'Math.max(literal, Math.ceil(...)) — a reduce-derived max rounded into a chart domain (auto-scale)',
	},
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
		expect(FEATURE_FILES.length).toBeGreaterThan(20);
		expect(RENDERER_FILES.length).toBeGreaterThan(1);
	});

	it('the widened bans catch the pre-fix reduce-max→domain and /worst* idioms', () => {
		const mustMatch: string[] = [
			'const retardCeil = Math.max(10, Math.ceil(maxRetard / 5) * 5);',
			'return [0, Math.max(1, Math.ceil(max))];',
			'value: sev != null && worstSevere > 0 ? Math.min(1, Math.max(0, sev / worstSevere)) : null,',
		];
		for (const idiom of mustMatch) {
			const hit = BANNED.some(({ re }) => re.test(idiom));
			expect(hit, `pre-fix idiom escaped the widened ban: "${idiom}"`).toBe(true);
		}
	});

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

// Token build — P5.1 (2026-07-02): the local engine fork (tools/tokens/src/,
// ported from yesid.dev pre-turborepo) is RETIRED; generation now runs on the
// vendored @yesid/tokens engine (vendor/design/tokens, pinned by
// tools/design-sync.ts). The fork's only substantive divergence was these
// header strings — the engine is byte-equivalent — so the outputs stay
// byte-identical: the engine emits the design-repo headers and this script
// re-stamps transit's provenance lines (a missing stamp throws loudly).
//
// Run: `bun run tokens:build` (script = `bun tools/tokens/build.ts`).
// Source of truth: tools/tokens/tokens.json (DTCG; value drift vs the vendored
// base is gated by src/tests/design-tokens-drift.test.ts). Emits 3 checked-in
// artifacts; CI `tokens:build && git diff --exit-code` keeps them in sync.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTokens } from '@yesid/tokens/src/parse.ts';
import { generateTokensCss } from '@yesid/tokens/src/generators/tokens-css.ts';
import {
	generateThemeBlock,
	replaceThemeRegion,
} from '@yesid/tokens/src/generators/theme-block.ts';
import { generateMotionTs } from '@yesid/tokens/src/generators/motion-ts.ts';

const here = dirname(fileURLToPath(import.meta.url)); // web/tools/tokens
const webRoot = resolve(here, '../..'); // web/

const TOKENS_JSON = resolve(here, 'tokens.json');
const TOKENS_CSS = resolve(webRoot, 'src/lib/styles/tokens.css');
const APP_CSS = resolve(webRoot, 'src/app.css');
const MOTION_TS = resolve(webRoot, 'src/lib/motion/tokens.ts');

interface BuildTarget {
	path: string;
	content: string;
}

/**
 * Re-stamp the engine's provenance headers with transit's. Each pair must
 * match — if the engine's header text moves, this throws instead of silently
 * shipping a wrong provenance line.
 */
function restamp(content: string, pairs: Array<[string, string]>, label: string): string {
	let out = content;
	for (const [from, to] of pairs) {
		if (!out.includes(from)) {
			throw new Error(`restamp(${label}): engine header not found: ${JSON.stringify(from)}`);
		}
		out = out.replace(from, to);
	}
	return out;
}

const CSS_HEADER: Array<[string, string]> = [
	[
		'/* GENERATED FROM packages/tokens/tokens.json - DO NOT EDIT */',
		'/* GENERATED FROM tools/tokens/tokens.json — DO NOT EDIT */',
	],
	[
		'/* Run `bun run --cwd packages/tokens build` to regenerate. */',
		'/* Run `bun run tokens:build` to regenerate. */',
	],
];

const MOTION_HEADER: Array<[string, string]> = [
	[
		'// GENERATED FROM packages/tokens/tokens.json — DO NOT EDIT',
		'// GENERATED FROM tools/tokens/tokens.json — DO NOT EDIT',
	],
	[
		'// A parity test in apps/web/src/lib/motion/tokens.test.ts keeps this in sync',
		'// A parity test in src/lib/motion/tokens.test.ts keeps this in sync',
	],
	[
		'// with tokens.css. Run `bun run --cwd packages/tokens build` to regenerate.',
		'// with tokens.css. Run `bun run tokens:build` to regenerate.',
	],
];

function buildAll(): BuildTarget[] {
	const tree = parseTokens(JSON.parse(readFileSync(TOKENS_JSON, 'utf-8')));

	const tokensCss = restamp(generateTokensCss(tree), CSS_HEADER, 'tokens.css');
	const themeBlock = restamp(generateThemeBlock(tree), CSS_HEADER, 'theme-block');
	const motionTs = restamp(generateMotionTs(tree), MOTION_HEADER, 'motion tokens.ts');

	// app.css: only the sentinel region (TOKENS:START..TOKENS:END) is generated;
	// everything else is hand-maintained. The file must pre-exist with sentinels.
	if (!existsSync(APP_CSS)) {
		throw new Error(
			`app.css not found at ${APP_CSS} — author it with the TOKENS:START/END sentinels first.`,
		);
	}
	const appCssContent = replaceThemeRegion(readFileSync(APP_CSS, 'utf-8'), themeBlock);

	return [
		{ path: TOKENS_CSS, content: tokensCss },
		{ path: APP_CSS, content: appCssContent },
		{ path: MOTION_TS, content: motionTs },
	];
}

function writeIfChanged(target: BuildTarget): boolean {
	const current = existsSync(target.path) ? readFileSync(target.path, 'utf-8') : null;
	if (current === target.content) return false;
	mkdirSync(dirname(target.path), { recursive: true });
	writeFileSync(target.path, target.content, 'utf-8');
	return true;
}

const targets = buildAll();
let changed = 0;
for (const t of targets) {
	if (writeIfChanged(t)) {
		console.log(`  wrote ${t.path}`);
		changed++;
	}
}
console.log(
	changed === 0
		? '✓ tokens build idempotent (no changes)'
		: `✓ tokens build wrote ${changed} file(s)`,
);
